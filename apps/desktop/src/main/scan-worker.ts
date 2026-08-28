import { parentPort, workerData } from "node:worker_threads";
import { MetadataDatabase } from "./database.js";
import { DataSourceRepository } from "./sources.js";
try {
  const database = new MetadataDatabase(workerData.databasePath);
  const result = new DataSourceRepository(database.db).scan(
    workerData.sourceId,
  );
  database.close();
  parentPort?.postMessage({ ok: true, result });
} catch (error) {
  parentPort?.postMessage({
    ok: false,
    error: error instanceof Error ? error.message : "Scan failed",
  });
}
