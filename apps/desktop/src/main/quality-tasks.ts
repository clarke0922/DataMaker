import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import type { DatabaseSync } from "node:sqlite";
import type { QualityTaskDto } from "@datamaker/contracts";
type Row = {
  id: string;
  status: QualityTaskDto["status"];
  summary_json: string;
  started_at: string;
  finished_at: string | null;
};
export class QualityTaskManager {
  private workers = new Map<string, Worker>();
  private actors = new Map<string, string | null>();
  constructor(
    private readonly db: DatabaseSync,
    private readonly databasePath: string,
    private readonly onFinished?: (
      id: string,
      result: QualityTaskDto["result"],
      error: string | null,
      actorUserId: string | null,
    ) => void,
  ) {
    this.db
      .prepare(
        "UPDATE rule_runs SET status='failed',summary_json=?,finished_at=? WHERE status='running'",
      )
      .run(
        JSON.stringify({
          progress: 100,
          error: "Interrupted by application restart",
        }),
        new Date().toISOString(),
      );
  }
  private dto(row: Row): QualityTaskDto {
    const data = JSON.parse(row.summary_json || "{}");
    return {
      id: row.id,
      kind: "quality",
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
      .prepare("SELECT * FROM rule_runs WHERE id=?")
      .get(id) as unknown as Row | undefined;
    if (!row) throw new Error("Task not found");
    return this.dto(row);
  }
  list() {
    return (
      this.db
        .prepare("SELECT * FROM rule_runs ORDER BY started_at DESC LIMIT 50")
        .all() as unknown as Row[]
    ).map((row) => this.dto(row));
  }
  start(actorUserId: string | null = null) {
    if (this.db.prepare("SELECT 1 FROM rule_runs WHERE status='running'").get())
      throw new Error("A quality check is already running");
    const id = randomUUID(),
      now = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO rule_runs(id,status,summary_json,started_at) VALUES(?,'running',?,?)",
      )
      .run(id, JSON.stringify({ progress: 5 }), now);
    let worker: Worker;
    try {
      worker = new Worker(new URL("./quality-worker.js", import.meta.url), {
        workerData: { databasePath: this.databasePath, runId: id },
        execArgv: process.execArgv.filter(
          (value) => !value.startsWith("--input-type"),
        ),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Worker failed";
      this.db
        .prepare(
          "UPDATE rule_runs SET status='failed',summary_json=?,finished_at=? WHERE id=?",
        )
        .run(
          JSON.stringify({ progress: 100, error: detail }),
          new Date().toISOString(),
          id,
        );
      throw error;
    }
    this.workers.set(id, worker);
    this.actors.set(id, actorUserId);
    worker.on(
      "message",
      (message: {
        ok: boolean;
        result?: QualityTaskDto["result"];
        error?: string;
      }) => {
        const transition = this.db
          .prepare(
            "UPDATE rule_runs SET status=?,summary_json=?,finished_at=? WHERE id=? AND status='running'",
          )
          .run(
            message.ok ? "completed" : "failed",
            JSON.stringify(
              message.ok
                ? { progress: 100, result: message.result }
                : { progress: 100, error: message.error },
            ),
            new Date().toISOString(),
            id,
          );
        if (!transition.changes) {
          this.workers.delete(id);
          this.actors.delete(id);
          return;
        }
        this.workers.delete(id);
        this.onFinished?.(
          id,
          message.ok ? (message.result ?? null) : null,
          message.ok ? null : (message.error ?? "Quality check failed"),
          this.actors.get(id) ?? null,
        );
        this.actors.delete(id);
      },
    );
    worker.on("error", (error: unknown) => {
      const detail = error instanceof Error ? error.message : "Worker failed";
      const transition = this.db
        .prepare(
          "UPDATE rule_runs SET status='failed',summary_json=?,finished_at=? WHERE id=? AND status='running'",
        )
        .run(
          JSON.stringify({
            progress: 100,
            error: detail,
          }),
          new Date().toISOString(),
          id,
        );
      if (!transition.changes) {
        this.workers.delete(id);
        this.actors.delete(id);
        return;
      }
      this.workers.delete(id);
      this.onFinished?.(id, null, detail, this.actors.get(id) ?? null);
      this.actors.delete(id);
    });
    worker.on("exit", (code) => {
      if (code === 0) return;
      const detail = `Quality worker exited with code ${code}`;
      const transition = this.db
        .prepare(
          "UPDATE rule_runs SET status='failed',summary_json=?,finished_at=? WHERE id=? AND status='running'",
        )
        .run(
          JSON.stringify({ progress: 100, error: detail }),
          new Date().toISOString(),
          id,
        );
      if (!transition.changes) return;
      this.workers.delete(id);
      this.onFinished?.(id, null, detail, this.actors.get(id) ?? null);
      this.actors.delete(id);
    });
    return this.get(id);
  }
  async cancel(id: string) {
    const worker = this.workers.get(id);
    if (!worker) throw new Error("Task is not running");
    const transition = this.db
      .prepare(
        "UPDATE rule_runs SET status='cancelled',summary_json=?,finished_at=? WHERE id=? AND status='running'",
      )
      .run(
        JSON.stringify({ progress: 100, error: "Cancelled by user" }),
        new Date().toISOString(),
        id,
      );
    if (!transition.changes) throw new Error("Task is no longer running");
    this.workers.delete(id);
    this.actors.delete(id);
    await worker.terminate();
    return this.get(id);
  }
  async shutdown() {
    const entries = [...this.workers.entries()];
    if (!entries.length) return;
    const finished = new Date().toISOString();
    const detail = "Interrupted by application shutdown";
    for (const [id] of entries)
      this.db
        .prepare(
          "UPDATE rule_runs SET status='failed',summary_json=?,finished_at=? WHERE id=? AND status='running'",
        )
        .run(JSON.stringify({ progress: 100, error: detail }), finished, id);
    this.workers.clear();
    this.actors.clear();
    await Promise.allSettled(entries.map(([, worker]) => worker.terminate()));
  }
}
