import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import type { DatabaseSync } from "node:sqlite";
import type { TaskDto } from "@datamaker/contracts";
type TaskRow = {
  id: string;
  status: TaskDto["status"];
  summary_json: string;
  started_at: string;
  finished_at: string | null;
};
export class ScanTaskManager {
  private workers = new Map<string, Worker>();
  private actors = new Map<string, string | null>();
  private sources = new Map<string, string>();
  constructor(
    private readonly db: DatabaseSync,
    private readonly databasePath: string,
    private readonly onFinished?: (
      id: string,
      sourceId: string,
      result: TaskDto["result"],
      error: string | null,
      actorUserId: string | null,
    ) => void,
  ) {
    this.db
      .prepare(
        "UPDATE data_sources SET status='error',last_error=?,updated_at=? WHERE id IN (SELECT data_source_id FROM scan_jobs WHERE status='running')",
      )
      .run("Interrupted by application restart", new Date().toISOString());
    this.db
      .prepare(
        "UPDATE scan_jobs SET status='failed',summary_json=?,finished_at=? WHERE status='running'",
      )
      .run(
        JSON.stringify({
          progress: 100,
          error: "Interrupted by application restart",
        }),
        new Date().toISOString(),
      );
  }
  private dto(row: TaskRow): TaskDto {
    const data = JSON.parse(row.summary_json || "{}") as {
      progress?: number;
      result?: TaskDto["result"];
      error?: string;
    };
    return {
      id: row.id,
      kind: "scan",
      status: row.status,
      progress: data.progress ?? 0,
      result: data.result ?? null,
      error: data.error ?? null,
      createdAt: row.started_at,
      updatedAt: row.finished_at ?? row.started_at,
    };
  }
  get(id: string) {
    const row = this.db
      .prepare("SELECT * FROM scan_jobs WHERE id=?")
      .get(id) as unknown as TaskRow | undefined;
    if (!row) throw new Error("Task not found");
    return this.dto(row);
  }
  list() {
    return (
      this.db
        .prepare("SELECT * FROM scan_jobs ORDER BY started_at DESC LIMIT 50")
        .all() as unknown as TaskRow[]
    ).map((row) => this.dto(row));
  }
  start(sourceId: string, actorUserId: string | null = null) {
    if (!this.db.prepare("SELECT 1 FROM data_sources WHERE id=?").get(sourceId))
      throw new Error("Data source not found");
    if (
      this.db
        .prepare(
          "SELECT 1 FROM scan_jobs WHERE data_source_id=? AND status='running'",
        )
        .get(sourceId)
    )
      throw new Error("A scan is already running for this data source");
    const id = randomUUID(),
      now = new Date().toISOString();
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare(
          "INSERT INTO scan_jobs(id,data_source_id,status,summary_json,started_at) VALUES(?,?, 'running',?,?)",
        )
        .run(id, sourceId, JSON.stringify({ progress: 5 }), now);
      this.db
        .prepare(
          "UPDATE data_sources SET status='scanning',last_error=NULL,updated_at=? WHERE id=?",
        )
        .run(now, sourceId);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    let worker: Worker;
    try {
      worker = new Worker(new URL("./scan-worker.js", import.meta.url), {
        workerData: { databasePath: this.databasePath, sourceId },
        execArgv: process.execArgv.filter(
          (argument) => !argument.startsWith("--input-type"),
        ),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Worker failed";
      this.db
        .prepare(
          "UPDATE scan_jobs SET status='failed',summary_json=?,finished_at=? WHERE id=?",
        )
        .run(
          JSON.stringify({ progress: 100, error: detail }),
          new Date().toISOString(),
          id,
        );
      this.db
        .prepare(
          "UPDATE data_sources SET status='error',last_error=?,updated_at=? WHERE id=?",
        )
        .run(detail, new Date().toISOString(), sourceId);
      throw error;
    }
    this.workers.set(id, worker);
    this.actors.set(id, actorUserId);
    this.sources.set(id, sourceId);
    worker.on(
      "message",
      (message: {
        ok: boolean;
        result?: TaskDto["result"];
        error?: string;
      }) => {
        const finished = new Date().toISOString();
        const transition = this.db
          .prepare(
            "UPDATE scan_jobs SET status=?,summary_json=?,finished_at=? WHERE id=? AND status='running'",
          )
          .run(
            message.ok ? "completed" : "failed",
            JSON.stringify(
              message.ok
                ? { progress: 100, result: message.result }
                : { progress: 100, error: message.error },
            ),
            finished,
            id,
          );
        if (!transition.changes) {
          this.workers.delete(id);
          this.actors.delete(id);
          this.sources.delete(id);
          return;
        }
        this.db
          .prepare(
            "UPDATE data_sources SET status=?,last_error=?,updated_at=? WHERE id=?",
          )
          .run(
            message.ok ? "active" : "error",
            message.ok ? null : (message.error ?? "Scan failed"),
            finished,
            sourceId,
          );
        this.workers.delete(id);
        this.onFinished?.(
          id,
          sourceId,
          message.ok ? (message.result ?? null) : null,
          message.ok ? null : (message.error ?? "Scan failed"),
          this.actors.get(id) ?? null,
        );
        this.actors.delete(id);
        this.sources.delete(id);
      },
    );
    worker.on("error", (error: unknown) => {
      const detail = error instanceof Error ? error.message : "Worker failed";
      const transition = this.db
        .prepare(
          "UPDATE scan_jobs SET status='failed',summary_json=?,finished_at=? WHERE id=? AND status='running'",
        )
        .run(
          JSON.stringify({ progress: 100, error: detail }),
          new Date().toISOString(),
          id,
        );
      if (!transition.changes) {
        this.workers.delete(id);
        this.actors.delete(id);
        this.sources.delete(id);
        return;
      }
      this.db
        .prepare(
          "UPDATE data_sources SET status='error',last_error=?,updated_at=? WHERE id=?",
        )
        .run(detail, new Date().toISOString(), sourceId);
      this.workers.delete(id);
      this.onFinished?.(
        id,
        this.sources.get(id) ?? sourceId,
        null,
        detail,
        this.actors.get(id) ?? null,
      );
      this.actors.delete(id);
      this.sources.delete(id);
    });
    worker.on("exit", (code) => {
      if (code === 0) return;
      const detail = `Scan worker exited with code ${code}`;
      const finished = new Date().toISOString();
      const transition = this.db
        .prepare(
          "UPDATE scan_jobs SET status='failed',summary_json=?,finished_at=? WHERE id=? AND status='running'",
        )
        .run(JSON.stringify({ progress: 100, error: detail }), finished, id);
      if (!transition.changes) return;
      this.db
        .prepare(
          "UPDATE data_sources SET status='error',last_error=?,updated_at=? WHERE id=?",
        )
        .run(detail, finished, sourceId);
      this.workers.delete(id);
      this.onFinished?.(
        id,
        this.sources.get(id) ?? sourceId,
        null,
        detail,
        this.actors.get(id) ?? null,
      );
      this.actors.delete(id);
      this.sources.delete(id);
    });
    return this.get(id);
  }
  async cancel(id: string) {
    const worker = this.workers.get(id);
    if (!worker) throw new Error("Task is not running");
    const transition = this.db
      .prepare(
        "UPDATE scan_jobs SET status='cancelled',summary_json=?,finished_at=? WHERE id=? AND status='running'",
      )
      .run(
        JSON.stringify({ progress: 100, error: "Cancelled by user" }),
        new Date().toISOString(),
        id,
      );
    if (!transition.changes) throw new Error("Task is no longer running");
    this.db
      .prepare(
        "UPDATE data_sources SET status='active',last_error=NULL,updated_at=? WHERE id=(SELECT data_source_id FROM scan_jobs WHERE id=?)",
      )
      .run(new Date().toISOString(), id);
    this.workers.delete(id);
    this.actors.delete(id);
    this.sources.delete(id);
    await worker.terminate();
    return this.get(id);
  }
  async shutdown() {
    const entries = [...this.workers.entries()];
    if (!entries.length) return;
    const finished = new Date().toISOString();
    const detail = "Interrupted by application shutdown";
    for (const [id] of entries) {
      this.db
        .prepare(
          "UPDATE scan_jobs SET status='failed',summary_json=?,finished_at=? WHERE id=? AND status='running'",
        )
        .run(JSON.stringify({ progress: 100, error: detail }), finished, id);
      this.db
        .prepare(
          "UPDATE data_sources SET status='error',last_error=?,updated_at=? WHERE id=(SELECT data_source_id FROM scan_jobs WHERE id=?)",
        )
        .run(detail, finished, id);
    }
    this.workers.clear();
    this.actors.clear();
    this.sources.clear();
    await Promise.allSettled(entries.map(([, worker]) => worker.terminate()));
  }
}
