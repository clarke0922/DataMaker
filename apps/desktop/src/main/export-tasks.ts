import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import type { DatabaseSync } from "node:sqlite";
import type {
  ExportDictionaryDto,
  ExportDictionaryInput,
  ExportTaskDto,
} from "@datamaker/contracts";

type Row = {
  id: string;
  status: ExportTaskDto["status"];
  summary_json: string;
  started_at: string;
  finished_at: string | null;
};

export class ExportTaskManager {
  private workers = new Map<string, Worker>();
  private results = new Map<string, ExportDictionaryDto>();
  private actors = new Map<string, string | null>();
  constructor(
    private readonly db: DatabaseSync,
    private readonly databasePath: string,
    private readonly onFinished?: (
      id: string,
      result: ExportDictionaryDto | null,
      error: string | null,
      actorUserId: string | null,
    ) => void,
  ) {
    this.db
      .prepare(
        "UPDATE export_jobs SET status='failed',summary_json=?,finished_at=? WHERE status='running'",
      )
      .run(
        JSON.stringify({
          progress: 100,
          error: "Interrupted by application restart",
        }),
        new Date().toISOString(),
      );
  }
  private dto(row: Row): ExportTaskDto {
    const data = JSON.parse(row.summary_json || "{}") as {
      progress?: number;
      result?: ExportDictionaryDto;
      error?: string;
    };
    return {
      id: row.id,
      kind: "export",
      status: row.status,
      progress: data.progress ?? 0,
      result: this.results.get(row.id) ?? data.result ?? null,
      error: data.error ?? null,
      createdAt: row.started_at,
      updatedAt: row.finished_at ?? row.started_at,
    };
  }
  get(id: string) {
    const row = this.db
      .prepare("SELECT * FROM export_jobs WHERE id=?")
      .get(id) as unknown as Row | undefined;
    if (!row) throw new Error("Export task not found");
    return this.dto(row);
  }
  list() {
    return (
      this.db
        .prepare("SELECT * FROM export_jobs ORDER BY started_at DESC LIMIT 50")
        .all() as unknown as Row[]
    ).map((row) => this.dto(row));
  }
  start(input: ExportDictionaryInput = {}, actorUserId: string | null = null) {
    if (
      this.db.prepare("SELECT 1 FROM export_jobs WHERE status='running'").get()
    )
      throw new Error("An export is already running");
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO export_jobs(id,status,request_json,summary_json,started_at) VALUES(?,'running',?,?,?)",
      )
      .run(id, JSON.stringify(input), JSON.stringify({ progress: 5 }), now);
    let worker: Worker;
    try {
      worker = new Worker(new URL("./export-worker.js", import.meta.url), {
        workerData: { databasePath: this.databasePath, input },
        execArgv: process.execArgv.filter(
          (value) => !value.startsWith("--input-type"),
        ),
      });
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : "Export worker failed";
      this.db
        .prepare(
          "UPDATE export_jobs SET status='failed',summary_json=?,finished_at=? WHERE id=?",
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
        result?: ExportDictionaryDto;
        error?: string;
      }) => {
        if (message.ok && message.result) this.results.set(id, message.result);
        const persistedResult = message.result
          ? { ...message.result, content: "" }
          : undefined;
        const transition = this.db
          .prepare(
            "UPDATE export_jobs SET status=?,summary_json=?,finished_at=? WHERE id=? AND status='running'",
          )
          .run(
            message.ok ? "completed" : "failed",
            JSON.stringify(
              message.ok
                ? { progress: 100, result: persistedResult }
                : { progress: 100, error: message.error },
            ),
            new Date().toISOString(),
            id,
          );
        if (!transition.changes) {
          this.results.delete(id);
          this.workers.delete(id);
          this.actors.delete(id);
          return;
        }
        this.workers.delete(id);
        this.onFinished?.(
          id,
          message.ok ? (message.result ?? null) : null,
          message.ok ? null : (message.error ?? "Export failed"),
          this.actors.get(id) ?? null,
        );
        this.actors.delete(id);
      },
    );
    worker.on("error", (error) => {
      const message =
        error instanceof Error ? error.message : "Export worker failed";
      const transition = this.db
        .prepare(
          "UPDATE export_jobs SET status='failed',summary_json=?,finished_at=? WHERE id=? AND status='running'",
        )
        .run(
          JSON.stringify({ progress: 100, error: message }),
          new Date().toISOString(),
          id,
        );
      if (!transition.changes) {
        this.workers.delete(id);
        this.actors.delete(id);
        return;
      }
      this.workers.delete(id);
      this.onFinished?.(id, null, message, this.actors.get(id) ?? null);
      this.actors.delete(id);
    });
    worker.on("exit", (code) => {
      if (code === 0) return;
      const detail = `Export worker exited with code ${code}`;
      const transition = this.db
        .prepare(
          "UPDATE export_jobs SET status='failed',summary_json=?,finished_at=? WHERE id=? AND status='running'",
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
    if (!worker) throw new Error("Export task is not running");
    const transition = this.db
      .prepare(
        "UPDATE export_jobs SET status='cancelled',summary_json=?,finished_at=? WHERE id=? AND status='running'",
      )
      .run(
        JSON.stringify({ progress: 100, error: "Cancelled by user" }),
        new Date().toISOString(),
        id,
      );
    if (!transition.changes)
      throw new Error("Export task is no longer running");
    this.workers.delete(id);
    this.actors.delete(id);
    this.results.delete(id);
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
          "UPDATE export_jobs SET status='failed',summary_json=?,finished_at=? WHERE id=? AND status='running'",
        )
        .run(JSON.stringify({ progress: 100, error: detail }), finished, id);
    this.workers.clear();
    this.actors.clear();
    this.results.clear();
    await Promise.allSettled(entries.map(([, worker]) => worker.terminate()));
  }
}
