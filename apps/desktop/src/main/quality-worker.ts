import { parentPort, workerData } from "node:worker_threads";
import { MetadataDatabase } from "./database.js";
import { QualityRepository } from "./quality.js";
try {
  const database = new MetadataDatabase(workerData.databasePath);
  const result = new QualityRepository(database.db).run(workerData.runId);
  database.close();
  parentPort?.postMessage({ ok: true, result });
} catch (error) {
  parentPort?.postMessage({
    ok: false,
    error: error instanceof Error ? error.message : "Quality check failed",
  });
}
