import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { MetadataDatabase } from "../dist/main/database.js";
import { DataSourceRepository } from "../dist/main/sources.js";

const input = process.argv.slice(2).find((argument) => argument !== "--");
if (!input)
  throw new Error("Usage: node scripts/verify-legacy-import.mjs <meta.sql>");
const directory = mkdtempSync(join(tmpdir(), "datamaker-legacy-"));
const database = new MetadataDatabase(join(directory, "metadata.db"));
try {
  const repository = new DataSourceRepository(database.db);
  const source = repository.save({
    name: "Legacy SQL verification",
    type: "sql_file",
    filePath: resolve(input),
  });
  const preview = repository.preview(source.id);
  const summary = repository.scan(source.id);
  const legacyTables = Number(
    database.db
      .prepare(
        `SELECT COUNT(*) count FROM meta_tables table_object
         JOIN schemas schema_object ON schema_object.id=table_object.schema_id
         JOIN catalogs catalog ON catalog.id=schema_object.catalog_id
         WHERE catalog.name='legacy-metadata'`,
      )
      .get().count,
  );
  const legacyColumns = Number(
    database.db
      .prepare(
        `SELECT COUNT(*) count FROM meta_columns column_object
         JOIN meta_tables table_object ON table_object.id=column_object.table_id
         JOIN schemas schema_object ON schema_object.id=table_object.schema_id
         JOIN catalogs catalog ON catalog.id=schema_object.catalog_id
         WHERE catalog.name='legacy-metadata'`,
      )
      .get().count,
  );
  const stable = repository.preview(source.id);
  const primaryKeyTables = Number(
    database.db
      .prepare(
        `SELECT COUNT(DISTINCT table_object.id) count
         FROM meta_tables table_object
         JOIN schemas schema_object ON schema_object.id=table_object.schema_id
         JOIN catalogs catalog ON catalog.id=schema_object.catalog_id
         JOIN meta_columns column_object ON column_object.table_id=table_object.id
         WHERE catalog.name='main' AND column_object.primary_key_ordinal IS NOT NULL`,
      )
      .get().count,
  );
  const uniqueConstraints = Number(
    database.db
      .prepare(
        `SELECT COUNT(*) count FROM meta_indexes index_object
         JOIN meta_tables table_object ON table_object.id=index_object.table_id
         JOIN schemas schema_object ON schema_object.id=table_object.schema_id
         JOIN catalogs catalog ON catalog.id=schema_object.catalog_id
         WHERE catalog.name='main' AND index_object.origin='u'`,
      )
      .get().count,
  );
  const report = {
    previewAdded: preview.added.length,
    summaryTables: summary.tables,
    summaryColumns: summary.columns,
    legacyTables,
    legacyColumns,
    systemTables: summary.tables - legacyTables,
    systemColumns: summary.columns - legacyColumns,
    primaryKeyTables,
    uniqueConstraints,
    conversionWarnings: summary.warnings.filter((warning) =>
      warning.startsWith("Legacy metadata conversion:"),
    ),
    reportOnlyWarnings: summary.warnings.filter((warning) =>
      warning.startsWith("Legacy initialization rows retained"),
    ),
    stableUnchanged: stable.unchanged,
    chineseSearchHits: database.search("政治面貌").length,
  };
  if (
    legacyTables !== 18 ||
    legacyColumns !== 30 ||
    report.systemTables !== 87 ||
    report.systemColumns !== 634 ||
    primaryKeyTables !== 85 ||
    uniqueConstraints !== 5
  )
    throw new Error(
      `Unexpected legacy conversion counts: ${JSON.stringify(report)}`,
    );
  console.log(JSON.stringify(report));
} finally {
  database.close();
  rmSync(directory, { recursive: true, force: true });
}
