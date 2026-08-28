import { parentPort, workerData } from "node:worker_threads";
import type { ExportDictionaryInput } from "@datamaker/contracts";
import { MetadataDatabase } from "./database.js";
import { MetadataRepository } from "./metadata.js";
import { QualityRepository } from "./quality.js";
import { ExportRepository } from "./exports.js";

const database = new MetadataDatabase(workerData.databasePath as string);
try {
  const metadata = new MetadataRepository(database.db);
  const quality = new QualityRepository(database.db);
  const result = new ExportRepository(metadata, quality).metadataDictionary(
    workerData.input as ExportDictionaryInput,
  );
  parentPort?.postMessage({ ok: true, result });
} catch (error) {
  parentPort?.postMessage({
    ok: false,
    error: error instanceof Error ? error.message : "Export failed",
  });
} finally {
  database.close();
}
