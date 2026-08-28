import { describe, expect, it } from "vitest";
import { MetadataDatabase } from "../src/main/database.js";
import { ScanTaskManager } from "../src/main/tasks.js";
import { QualityTaskManager } from "../src/main/quality-tasks.js";
import { ExportTaskManager } from "../src/main/export-tasks.js";

describe("persistent task managers", () => {
  it("marks interrupted scans as failed and prevents duplicate source scans", () => {
    const database = new MetadataDatabase(":memory:");
    database.db.exec(
      "INSERT INTO data_sources(id,name,type,created_at,updated_at) VALUES('s','S','sqlite','x','x');INSERT INTO scan_jobs(id,data_source_id,status,started_at) VALUES('old','s','running','2026-01-01')",
    );
    const manager = new ScanTaskManager(database.db, "unused.db");
    expect(manager.list()[0]).toMatchObject({
      id: "old",
      status: "failed",
      progress: 100,
      error: "Interrupted by application restart",
    });
    expect(
      database.db
        .prepare(
          "SELECT status,last_error lastError FROM data_sources WHERE id='s'",
        )
        .get(),
    ).toEqual({
      status: "error",
      lastError: "Interrupted by application restart",
    });
    database.db.exec(
      "INSERT INTO scan_jobs(id,data_source_id,status,started_at) VALUES('active','s','running','2026-01-02')",
    );
    expect(() => manager.start("s")).toThrow("already running");
    expect(() => manager.start("missing")).toThrow("Data source not found");
    database.close();
  });
  it("marks interrupted quality runs as failed and allows only one active run", () => {
    const database = new MetadataDatabase(":memory:");
    database.db.exec(
      "INSERT INTO rule_runs(id,status,started_at) VALUES('old','running','2026-01-01')",
    );
    const manager = new QualityTaskManager(database.db, "unused.db");
    expect(manager.list()[0]).toMatchObject({
      id: "old",
      status: "failed",
      progress: 100,
      error: "Interrupted by application restart",
    });
    database.db.exec(
      "INSERT INTO rule_runs(id,status,started_at) VALUES('active','running','2026-01-02')",
    );
    expect(() => manager.start()).toThrow("already running");
    database.close();
  });
  it("marks interrupted exports as failed and allows only one active export", () => {
    const database = new MetadataDatabase(":memory:");
    database.db.exec(
      "INSERT INTO export_jobs(id,status,started_at) VALUES('old','running','2026-01-01')",
    );
    const manager = new ExportTaskManager(database.db, "unused.db");
    expect(manager.list()[0]).toMatchObject({
      id: "old",
      status: "failed",
      progress: 100,
      error: "Interrupted by application restart",
    });
    database.db.exec(
      "INSERT INTO export_jobs(id,status,started_at) VALUES('active','running','2026-01-02')",
    );
    expect(() => manager.start()).toThrow("already running");
    database.close();
  });
  it("persists active tasks before terminating workers during shutdown", async () => {
    const database = new MetadataDatabase(":memory:");
    database.db.exec(`
      INSERT INTO data_sources(id,name,type,status,created_at,updated_at) VALUES('s','S','sqlite','scanning','x','x');
      INSERT INTO scan_jobs(id,data_source_id,status,summary_json,started_at) VALUES('scan','s','running','{}','x');
      INSERT INTO rule_runs(id,status,summary_json,started_at) VALUES('quality','running','{}','x');
      INSERT INTO export_jobs(id,status,summary_json,started_at) VALUES('export','running','{}','x');
    `);
    const terminated: string[] = [];
    const fakeWorker = (name: string) => ({
      terminate: async () => {
        terminated.push(name);
        return 1;
      },
    });
    const scans = new ScanTaskManager(database.db, "unused.db");
    const quality = new QualityTaskManager(database.db, "unused.db");
    const exports = new ExportTaskManager(database.db, "unused.db");
    // Recreate running rows because construction intentionally recovers stale work.
    database.db.exec(`
      UPDATE data_sources SET status='scanning',last_error=NULL WHERE id='s';
      UPDATE scan_jobs SET status='running',summary_json='{}',finished_at=NULL WHERE id='scan';
      UPDATE rule_runs SET status='running',summary_json='{}',finished_at=NULL WHERE id='quality';
      UPDATE export_jobs SET status='running',summary_json='{}',finished_at=NULL WHERE id='export';
    `);
    (
      scans as unknown as {
        workers: Map<string, ReturnType<typeof fakeWorker>>;
      }
    ).workers.set("scan", fakeWorker("scan"));
    (
      quality as unknown as {
        workers: Map<string, ReturnType<typeof fakeWorker>>;
      }
    ).workers.set("quality", fakeWorker("quality"));
    (
      exports as unknown as {
        workers: Map<string, ReturnType<typeof fakeWorker>>;
      }
    ).workers.set("export", fakeWorker("export"));

    await Promise.all([
      scans.shutdown(),
      quality.shutdown(),
      exports.shutdown(),
    ]);

    expect(terminated.sort()).toEqual(["export", "quality", "scan"]);
    expect(scans.get("scan")).toMatchObject({
      status: "failed",
      error: "Interrupted by application shutdown",
    });
    expect(quality.get("quality")).toMatchObject({
      status: "failed",
      error: "Interrupted by application shutdown",
    });
    expect(exports.get("export")).toMatchObject({
      status: "failed",
      error: "Interrupted by application shutdown",
    });
    expect(
      database.db
        .prepare(
          "SELECT status,last_error lastError FROM data_sources WHERE id='s'",
        )
        .get(),
    ).toEqual({
      status: "error",
      lastError: "Interrupted by application shutdown",
    });
    database.close();
  });
});
