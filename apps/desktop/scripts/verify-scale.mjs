import { performance } from "node:perf_hooks";
import { MetadataDatabase } from "../dist/main/database.js";
import { MetadataRepository } from "../dist/main/metadata.js";

const database = new MetadataDatabase(":memory:");
try {
  const now = new Date().toISOString();
  database.db.exec("BEGIN");
  database.db
    .prepare(
      "INSERT INTO data_sources(id,name,type,created_at,updated_at) VALUES('source','Scale','sqlite',?,?)",
    )
    .run(now, now);
  database.db.exec(
    "INSERT INTO catalogs(id,data_source_id,name) VALUES('catalog','source','main'); INSERT INTO schemas(id,catalog_id,name) VALUES('schema','catalog','main');",
  );
  const insertTable = database.db.prepare(
    "INSERT INTO meta_tables(id,schema_id,name,fingerprint,created_at,updated_at) VALUES(?, 'schema', ?, ?, ?, ?)",
  );
  const insertColumn = database.db.prepare(
    "INSERT INTO meta_columns(id,table_id,name,ordinal,raw_type,normalized_type,nullable) VALUES(?,?,?,?, 'TEXT','text',1)",
  );
  const insertFts = database.db.prepare(
    "INSERT INTO metadata_fts(object_id,object_type,name,path,comment) VALUES(?,?,?,?,?)",
  );
  for (let tableIndex = 0; tableIndex < 1000; tableIndex++) {
    const tableId = `table-${tableIndex}`;
    const tableName = `scale_table_${String(tableIndex).padStart(4, "0")}`;
    insertTable.run(tableId, tableName, tableId, now, now);
    insertFts.run(tableId, "table", tableName, `Scale/main/${tableName}`, "");
    for (let columnIndex = 0; columnIndex < 100; columnIndex++) {
      const columnId = `${tableId}-column-${columnIndex}`;
      const columnName =
        columnIndex === 99
          ? `search_target_${tableIndex}`
          : `column_${columnIndex}`;
      insertColumn.run(columnId, tableId, columnName, columnIndex + 1);
      insertFts.run(
        columnId,
        "column",
        columnName,
        `Scale/main/${tableName}/${columnName}`,
        "",
      );
    }
  }
  database.db.exec("COMMIT");
  const repository = new MetadataRepository(database.db);
  const pageStarted = performance.now();
  const page = repository.listTablePage({
    page: 25,
    pageSize: 20,
    search: "scale_table",
  });
  const pageMilliseconds = performance.now() - pageStarted;
  const searchStarted = performance.now();
  const hits = database.search("search_target_999");
  const searchMilliseconds = performance.now() - searchStarted;
  const report = {
    tables: 1000,
    columns: 100000,
    pageItems: page.items.length,
    pageTotal: page.total,
    searchHits: hits.length,
    pageMilliseconds: Number(pageMilliseconds.toFixed(2)),
    searchMilliseconds: Number(searchMilliseconds.toFixed(2)),
  };
  if (
    page.items.length !== 20 ||
    page.total !== 1000 ||
    hits.length < 1 ||
    pageMilliseconds > 3000 ||
    searchMilliseconds > 3000
  )
    throw new Error(`Scale verification failed: ${JSON.stringify(report)}`);
  console.log(JSON.stringify(report));
} finally {
  database.close();
}
