import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type {
  DataSourceDto,
  SaveDataSourceInput,
  ScanSummaryDto,
} from "@datamaker/contracts";
import { bumpMetadataRevision } from "./revisions.js";

type SourceRow = {
  id: string;
  name: string;
  type: "sqlite" | "sql_file";
  config_json: string;
  status: string;
  last_error: string | null;
  last_scanned_at: string | null;
  created_at: string;
  updated_at: string;
};
const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;
const MAX_SQL_FILE_BYTES = 100 * 1024 * 1024;

function validateSourceFile(
  filePath: string,
  type: SaveDataSourceInput["type"],
) {
  const resolved = fs.realpathSync.native(filePath);
  const stat = fs.statSync(resolved);
  if (!stat.isFile())
    throw new Error("Data source path must be a regular file");
  if (type === "sql_file") {
    if (stat.size > MAX_SQL_FILE_BYTES)
      throw new Error("SQL source file must not exceed 100 MiB");
    return resolved;
  }
  let source: DatabaseSync | undefined;
  try {
    source = new DatabaseSync(resolved, { readOnly: true });
    const result = source.prepare("PRAGMA quick_check").get() as
      { quick_check: string } | undefined;
    if (result?.quick_check !== "ok")
      throw new Error(
        result?.quick_check ?? "integrity check returned no result",
      );
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown error";
    throw new Error(`SQLite source is invalid: ${detail}`);
  } finally {
    source?.close();
  }
  return resolved;
}
const normalizeType = (raw: string) => {
  const value = raw.toUpperCase();
  if (/INT/.test(value)) return "integer";
  if (/CHAR|CLOB|TEXT/.test(value)) return "text";
  if (/BLOB/.test(value)) return "blob";
  if (/REAL|FLOA|DOUB|DEC|NUM/.test(value)) return "number";
  if (/DATE|TIME/.test(value)) return "datetime";
  if (/BOOL/.test(value)) return "boolean";
  return value ? "unknown" : "unknown";
};
function splitSqlColumns(body: string) {
  const parts: string[] = [];
  let depth = 0,
    start = 0,
    quoteChar = "";
  for (let index = 0; index < body.length; index++) {
    const char = body[index]!;
    if (quoteChar) {
      if (char === quoteChar && body[index - 1] !== "\\") quoteChar = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quoteChar = char;
      continue;
    }
    if (char === "(") depth++;
    else if (char === ")") depth--;
    else if (char === "," && depth === 0) {
      parts.push(body.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(body.slice(start).trim());
  return parts.filter(Boolean);
}
type ParsedSqlSource = {
  database: DatabaseSync;
  rawDdl: Map<string, string>;
  tableComments: Map<string, string>;
  columnComments: Map<string, string>;
  warnings: string[];
  legacyTables: LegacyTable[];
};
type LegacyColumn = {
  name: string;
  comment: string | null;
  rawType: string;
  nullable: boolean;
  ordinal: number;
};
type LegacyTable = {
  name: string;
  comment: string | null;
  columns: LegacyColumn[];
};
function sqlValue(value: string) {
  const trimmed = value.trim();
  if (/^null$/i.test(trimmed)) return null;
  if (trimmed.startsWith("'") && trimmed.endsWith("'"))
    return trimmed.slice(1, -1).replace(/''/g, "'");
  return trimmed;
}
function legacyRows(text: string, table: string) {
  const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `^\\s*INSERT\\s+INTO\\s+(?:"[^"]+"\\.)?"${escaped}"\\s*\\(([^)]*)\\)\\s*VALUES\\s*\\((.*)\\)\\s*;\\s*$`,
    "gim",
  );
  return [...text.matchAll(pattern)].map((match) => {
    const names = splitSqlColumns(match[1]!).map((name) =>
      name
        .replace(/["`\[\]]/g, "")
        .trim()
        .toUpperCase(),
    );
    const values = splitSqlColumns(match[2]!).map(sqlValue);
    return Object.fromEntries(
      names.map((name, index) => [name, values[index]]),
    );
  });
}
function parseLegacyMetadata(text: string, warnings: string[]) {
  const tables = legacyRows(text, "META_TABLE");
  const columns = legacyRows(text, "META_COLUMN");
  const initializationByModule = new Map<string, number>();
  for (const match of text.matchAll(
    /^\s*INSERT\s+INTO\s+(?:"[^"]+"\.)?"([^"]+)"\s*\(/gim,
  )) {
    const module = match[1]!.split("_", 1)[0]!.toUpperCase();
    initializationByModule.set(
      module,
      (initializationByModule.get(module) ?? 0) + 1,
    );
  }
  const byName = new Map<string, LegacyTable>();
  for (const row of tables) {
    const name = String(row.MT_NAME ?? "").trim();
    if (!name) continue;
    byName.set(name.toLowerCase(), {
      name,
      comment: row.MT_NAME_CN == null ? null : String(row.MT_NAME_CN),
      columns: [],
    });
  }
  let orphanColumns = 0;
  for (const row of columns) {
    const owner = byName.get(
      String(row.MT_NAME ?? "")
        .trim()
        .toLowerCase(),
    );
    const name = String(row.MC_NAME ?? "").trim();
    if (!owner || !name) {
      orphanColumns++;
      continue;
    }
    const baseType = String(row.MC_TYPE ?? "").trim() || "UNKNOWN";
    const length = Number(row.MC_LENGTH ?? 0);
    const precision = Number(row.MC_PRECISION ?? 0);
    const rawType =
      length > 0
        ? `${baseType}(${length}${precision > 0 ? `,${precision}` : ""})`
        : baseType;
    owner.columns.push({
      name,
      comment: row.MC_NAME_CN == null ? null : String(row.MC_NAME_CN),
      rawType,
      nullable: Number(row.MC_IS_REQUIRED ?? 0) !== 1,
      ordinal: Math.max(1, Number(row.MC_ORDER ?? owner.columns.length + 1)),
    });
  }
  if (tables.length || columns.length)
    warnings.push(
      `Legacy metadata conversion: ${byName.size} tables, ${columns.length - orphanColumns} columns, ${orphanColumns} orphan columns.`,
    );
  initializationByModule.set(
    "META",
    Math.max(
      0,
      (initializationByModule.get("META") ?? 0) -
        tables.length -
        columns.length,
    ),
  );
  const unconverted = [...initializationByModule.entries()]
    .filter(([, count]) => count > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([module, count]) => `${module}_*=${count}`)
    .join(", ");
  if (unconverted)
    warnings.push(
      `Legacy initialization rows retained as migration-report-only data: ${unconverted}.`,
    );
  return [...byName.values()];
}
function sqlFileDatabase(filePath: string): ParsedSqlSource {
  const bytes = fs.readFileSync(filePath);
  let text = new TextDecoder("utf-8").decode(bytes);
  if (text.includes("\uFFFD")) text = new TextDecoder("gbk").decode(bytes);
  const target = new DatabaseSync(":memory:"),
    rawDdl = new Map<string, string>(),
    tableComments = new Map<string, string>(),
    columnComments = new Map<string, string>(),
    warnings: string[] = [];
  const alteredConstraints = new Map<
    string,
    { primaryKey?: string[]; unique: string[][]; raw: string[] }
  >();
  const altered = (table: string) => {
    const key = table.toLowerCase();
    const value = alteredConstraints.get(key) ?? { unique: [], raw: [] };
    alteredConstraints.set(key, value);
    return value;
  };
  const alterTablePrefix = String.raw`ALTER\s+TABLE\s+(?:(?:["\x60\[]?[\w$]+["\x60\]]?)\.)?["\x60\[]?([\w$\u4e00-\u9fa5]+)["\x60\]]?\s+ADD\s+CONSTRAINT`;
  for (const match of text.matchAll(
    new RegExp(
      `${alterTablePrefix}(?:\\s+(?!PRIMARY\\b)(?:"[^"]+"|[\\w$]+))?\\s+PRIMARY\\s+KEY\\s*\\(([^)]+)\\)\\s*;`,
      "gi",
    ),
  )) {
    const constraint = altered(match[1]!);
    constraint.primaryKey = match[2]!
      .split(",")
      .map((name) => name.replace(/["`\[\]\s]/g, ""));
    constraint.raw.push(match[0]!);
  }
  for (const match of text.matchAll(
    new RegExp(
      `${alterTablePrefix}(?:\\s+(?!UNIQUE\\b)(?:"[^"]+"|[\\w$]+))?\\s+UNIQUE\\s*\\(([^)]+)\\)\\s*;`,
      "gi",
    ),
  )) {
    const constraint = altered(match[1]!);
    constraint.unique.push(
      match[2]!.split(",").map((name) => name.replace(/["`\[\]\s]/g, "")),
    );
    constraint.raw.push(match[0]!);
  }
  for (const comment of text.matchAll(
    /COMMENT\s+ON\s+TABLE\s+(?:(?:["`\[]?[\w$]+["`\]]?)\.)?["`\[]?([\w$\u4e00-\u9fa5]+)["`\]]?\s+IS\s+'((?:''|[^'])*)'\s*;/gi,
  ))
    tableComments.set(
      comment[1]!.toLowerCase(),
      comment[2]!.replace(/''/g, "'"),
    );
  for (const comment of text.matchAll(
    /COMMENT\s+ON\s+COLUMN\s+(?:(?:["`\[]?[\w$]+["`\]]?)\.)?["`\[]?([\w$\u4e00-\u9fa5]+)["`\]]?\.["`\[]?([\w$\u4e00-\u9fa5]+)["`\]]?\s+IS\s+'((?:''|[^'])*)'\s*;/gi,
  ))
    columnComments.set(
      `${comment[1]!.toLowerCase()}.${comment[2]!.toLowerCase()}`,
      comment[3]!.replace(/''/g, "'"),
    );
  const pattern =
    /CREATE\s+TABLE\s+(?:(?:["`\[]?[\w$]+["`\]]?)\.)?["`\[]?([\w$\u4e00-\u9fa5]+)["`\]]?\s*\(([\s\S]*?)\)\s*(?:;|TABLESPACE|COMMENT|$)/gi;
  for (const match of text.matchAll(pattern)) {
    const table = match[1]!;
    const externalConstraints = alteredConstraints.get(table.toLowerCase());
    rawDdl.set(
      table,
      [match[0]!.trim(), ...(externalConstraints?.raw ?? [])].join("\n"),
    );
    const definitions = splitSqlColumns(match[2]!);
    const columns: string[] = [];
    let tablePrimaryKey: string[] = [];
    const constraints: string[] = [];
    for (const definition of definitions) {
      const normalized = definition.replace(
        /^CONSTRAINT\s+["`\[]?[\w$]+["`\]]?\s+/i,
        "",
      );
      const pk = normalized.match(/^PRIMARY\s+KEY\s*\(([^)]+)\)/i);
      if (pk) {
        tablePrimaryKey = pk[1]!
          .split(",")
          .map((name) => name.replace(/["`\[\]\s]/g, ""));
        continue;
      }
      const unique = normalized.match(/^UNIQUE\s*\(([^)]+)\)/i);
      if (unique) {
        constraints.push(
          `UNIQUE(${unique[1]!
            .split(",")
            .map((name) => quote(name.replace(/["`\[\]\s]/g, "")))
            .join(",")})`,
        );
        continue;
      }
      const fk = normalized.match(
        /^FOREIGN\s+KEY\s*\(([^)]+)\)\s+REFERENCES\s+["`\[]?([\w$\u4e00-\u9fa5]+)["`\]]?\s*\(([^)]+)\)/i,
      );
      if (fk) {
        const from = fk[1]!
          .split(",")
          .map((name) => quote(name.replace(/["`\[\]\s]/g, "")))
          .join(",");
        const to = fk[3]!
          .split(",")
          .map((name) => quote(name.replace(/["`\[\]\s]/g, "")))
          .join(",");
        constraints.push(
          `FOREIGN KEY(${from}) REFERENCES ${quote(fk[2]!)}(${to})`,
        );
        continue;
      }
      if (/^CHECK\b/i.test(normalized)) {
        warnings.push(
          `CHECK constraint in ${table} was preserved only in raw DDL: ${definition.slice(0, 160)}`,
        );
        continue;
      }
      const column = definition.match(
        /^["`\[]?([\w$\u4e00-\u9fa5]+)["`\]]?\s+([\w]+(?:\s*\([^)]*\))?)([\s\S]*)$/i,
      );
      if (!column) {
        warnings.push(
          `Unrecognized definition in ${table}: ${definition.slice(0, 160)}`,
        );
        continue;
      }
      const name = column[1]!,
        rawType = column[2]!,
        tail = column[3]!;
      let rendered = `${quote(name)} ${rawType}`;
      if (/NOT\s+NULL/i.test(tail)) rendered += " NOT NULL";
      if (/PRIMARY\s+KEY/i.test(tail)) rendered += " PRIMARY KEY";
      if (/\bUNIQUE\b/i.test(tail)) rendered += " UNIQUE";
      const defaultValue = tail.match(
        /\bDEFAULT\s+('(?:''|[^'])*'|"(?:""|[^"])*"|\([^)]*\)|[^\s,]+)/i,
      );
      if (defaultValue) {
        const value = defaultValue[1]!;
        if (
          /^['"]/.test(value) ||
          /^[-+]?\d+(?:\.\d+)?$/.test(value) ||
          /^(?:NULL|CURRENT_DATE|CURRENT_TIME|CURRENT_TIMESTAMP)$/i.test(
            value,
          ) ||
          /^\([^;]*\)$/.test(value)
        )
          rendered += ` DEFAULT ${value}`;
        else
          warnings.push(
            `Unsupported default in ${table}.${name} was preserved only in raw DDL: ${value}`,
          );
      }
      const inlineComment = tail.match(/\bCOMMENT\s+'((?:''|[^'])*)'/i);
      if (inlineComment)
        columnComments.set(
          `${table.toLowerCase()}.${name.toLowerCase()}`,
          inlineComment[1]!.replace(/''/g, "'"),
        );
      const references = tail.match(
        /REFERENCES\s+["`\[]?([\w$\u4e00-\u9fa5]+)["`\]]?\s*\(["`\[]?([\w$\u4e00-\u9fa5]+)["`\]]?\)/i,
      );
      if (references)
        rendered += ` REFERENCES ${quote(references[1]!)}(${quote(references[2]!)})`;
      columns.push(rendered);
    }
    if (!tablePrimaryKey.length && externalConstraints?.primaryKey)
      tablePrimaryKey = externalConstraints.primaryKey;
    for (const columns of externalConstraints?.unique ?? [])
      constraints.push(`UNIQUE(${columns.map(quote).join(",")})`);
    if (tablePrimaryKey.length)
      constraints.push(`PRIMARY KEY(${tablePrimaryKey.map(quote).join(",")})`);
    if (columns.length)
      target.exec(
        `CREATE TABLE ${quote(table)}(${[...columns, ...constraints].join(",")})`,
      );
  }
  if (!rawDdl.size)
    warnings.push("No supported CREATE TABLE statements were found.");
  const legacyTables = parseLegacyMetadata(text, warnings);
  return {
    database: target,
    rawDdl,
    tableComments,
    columnComments,
    warnings,
    legacyTables,
  };
}

export class DataSourceRepository {
  constructor(private readonly db: DatabaseSync) {}
  private dto(row: SourceRow): DataSourceDto {
    let filePath = "";
    try {
      filePath = String(
        (JSON.parse(row.config_json) as { filePath?: string }).filePath ?? "",
      );
    } catch {
      /* invalid legacy config */
    }
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      filePath,
      status: row.status,
      lastError: row.last_error,
      lastScannedAt: row.last_scanned_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
  list() {
    return (
      this.db
        .prepare("SELECT * FROM data_sources ORDER BY name")
        .all() as unknown as SourceRow[]
    ).map((row) => this.dto(row));
  }
  save(input: SaveDataSourceInput): DataSourceDto {
    if (!input.name.trim()) throw new Error("Data source name is required");
    if (!input.filePath.trim()) throw new Error("Data source file is required");
    if (!fs.existsSync(input.filePath))
      throw new Error("Data source file does not exist");
    const filePath = validateSourceFile(input.filePath, input.type);
    const now = new Date().toISOString();
    const config = JSON.stringify({ filePath });
    const id = input.id ?? randomUUID();
    if (input.id) {
      if (
        this.db
          .prepare(
            "SELECT 1 FROM scan_jobs WHERE data_source_id=? AND status='running'",
          )
          .get(id)
      )
        throw new Error("A running data source cannot be modified");
      const result = this.db
        .prepare(
          "UPDATE data_sources SET name=?,type=?,config_json=?,updated_at=? WHERE id=?",
        )
        .run(input.name.trim(), input.type, config, now, id);
      if (!result.changes) throw new Error("Data source not found");
    } else
      this.db
        .prepare(
          "INSERT INTO data_sources(id,name,type,config_json,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
        )
        .run(id, input.name.trim(), input.type, config, "active", now, now);
    return this.dto(
      this.db
        .prepare("SELECT * FROM data_sources WHERE id=?")
        .get(id) as unknown as SourceRow,
    );
  }
  remove(id: string) {
    if (
      this.db
        .prepare(
          "SELECT 1 FROM scan_jobs WHERE data_source_id=? AND status='running'",
        )
        .get(id)
    )
      throw new Error("A running data source cannot be deleted");
    this.db.exec("BEGIN");
    try {
      const result = this.db
        .prepare("DELETE FROM data_sources WHERE id=?")
        .run(id);
      if (!result.changes) throw new Error("Data source not found");
      bumpMetadataRevision(this.db);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  private syncLegacyMetadata(
    sourceId: string,
    tables: LegacyTable[],
    scannedAt: string,
  ) {
    const catalogId = String(
      (
        this.db
          .prepare("SELECT id FROM catalogs WHERE data_source_id=? AND name=?")
          .get(sourceId, "legacy-metadata") as { id?: string } | undefined
      )?.id ?? randomUUID(),
    );
    this.db
      .prepare(
        "INSERT OR IGNORE INTO catalogs(id,data_source_id,name) VALUES(?,?,?)",
      )
      .run(catalogId, sourceId, "legacy-metadata");
    const schemaId = String(
      (
        this.db
          .prepare(
            "SELECT id FROM schemas WHERE catalog_id=? AND name='legacy'",
          )
          .get(catalogId) as { id?: string } | undefined
      )?.id ?? randomUUID(),
    );
    this.db
      .prepare(
        "INSERT OR IGNORE INTO schemas(id,catalog_id,name) VALUES(?,?,'legacy')",
      )
      .run(schemaId, catalogId);
    const previous = this.db
      .prepare("SELECT id,name,fingerprint FROM meta_tables WHERE schema_id=?")
      .all(schemaId) as Array<{
      id: string;
      name: string;
      fingerprint: string;
    }>;
    const previousByName = new Map(previous.map((row) => [row.name, row]));
    let added = 0,
      updated = 0,
      retired = 0,
      columns = 0;
    for (const table of tables) {
      const fingerprint = createHash("sha256")
        .update(JSON.stringify(table))
        .digest("hex");
      const prior = previousByName.get(table.name);
      const tableId = prior?.id ?? randomUUID();
      if (!prior) {
        added++;
        this.db
          .prepare(
            "INSERT INTO meta_tables(id,schema_id,name,object_type,comment,fingerprint,created_at,updated_at) VALUES(?,?,?,'table',?,?,?,?)",
          )
          .run(
            tableId,
            schemaId,
            table.name,
            table.comment,
            fingerprint,
            scannedAt,
            scannedAt,
          );
      } else {
        if (prior.fingerprint !== fingerprint) updated++;
        this.db
          .prepare(
            "UPDATE meta_tables SET comment=COALESCE(comment,?),fingerprint=?,retired=0,updated_at=? WHERE id=?",
          )
          .run(table.comment, fingerprint, scannedAt, tableId);
      }
      previousByName.delete(table.name);
      const existing = this.db
        .prepare("SELECT id,name FROM meta_columns WHERE table_id=?")
        .all(tableId) as Array<{ id: string; name: string }>;
      const existingByName = new Map(
        existing.map((column) => [column.name, column.id]),
      );
      const retained = new Set<string>();
      for (const column of table.columns) {
        const columnId = existingByName.get(column.name) ?? randomUUID();
        if (existingByName.has(column.name))
          this.db
            .prepare(
              "UPDATE meta_columns SET ordinal=?,raw_type=?,normalized_type=?,nullable=?,comment=COALESCE(comment,?) WHERE id=?",
            )
            .run(
              column.ordinal,
              column.rawType,
              normalizeType(column.rawType),
              column.nullable ? 1 : 0,
              column.comment,
              columnId,
            );
        else
          this.db
            .prepare(
              "INSERT INTO meta_columns(id,table_id,name,ordinal,raw_type,normalized_type,nullable,comment) VALUES(?,?,?,?,?,?,?,?)",
            )
            .run(
              columnId,
              tableId,
              column.name,
              column.ordinal,
              column.rawType,
              normalizeType(column.rawType),
              column.nullable ? 1 : 0,
              column.comment,
            );
        retained.add(columnId);
        columns++;
      }
      for (const column of existing)
        if (!retained.has(column.id))
          this.db.prepare("DELETE FROM meta_columns WHERE id=?").run(column.id);
    }
    for (const prior of previousByName.values()) {
      this.db
        .prepare("UPDATE meta_tables SET retired=1,updated_at=? WHERE id=?")
        .run(scannedAt, prior.id);
      retired++;
    }
    return { added, updated, retired, columns };
  }
  preview(id: string) {
    const source = this.list().find((item) => item.id === id);
    if (!source) throw new Error("Data source not found");
    const parsed =
      source.type === "sql_file" ? sqlFileDatabase(source.filePath) : null;
    const external =
      parsed?.database ?? new DatabaseSync(source.filePath, { readOnly: true });
    try {
      const objects = external
        .prepare(
          "SELECT name,type,sql FROM sqlite_schema WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all() as Array<{ name: string; type: string; sql: string | null }>;
      const previous = this.db
        .prepare(
          `SELECT table_object.name,table_object.fingerprint,catalog.name catalogName FROM meta_tables table_object JOIN schemas schema_object ON schema_object.id=table_object.schema_id JOIN catalogs catalog ON catalog.id=schema_object.catalog_id WHERE catalog.data_source_id=?`,
        )
        .all(id) as Array<{
        name: string;
        fingerprint: string;
        catalogName: string;
      }>;
      const prior = new Map(
        previous
          .filter((item) => item.catalogName === "main")
          .map((item) => [item.name, item.fingerprint]),
      );
      const added: string[] = [],
        updated: string[] = [];
      let unchanged = 0;
      for (const object of objects) {
        const columns = external
          .prepare(`PRAGMA table_info(${quote(object.name)})`)
          .all();
        const ddl = parsed?.rawDdl.get(object.name) ?? object.sql;
        const fingerprint = createHash("sha256")
          .update(JSON.stringify({ object: { ...object, sql: ddl }, columns }))
          .digest("hex");
        if (!prior.has(object.name)) added.push(object.name);
        else if (prior.get(object.name) !== fingerprint)
          updated.push(object.name);
        else unchanged++;
        prior.delete(object.name);
      }
      const legacyPrior = new Map(
        previous
          .filter((item) => item.catalogName === "legacy-metadata")
          .map((item) => [item.name, item.fingerprint]),
      );
      for (const table of parsed?.legacyTables ?? []) {
        const fingerprint = createHash("sha256")
          .update(JSON.stringify(table))
          .digest("hex");
        const label = `[legacy] ${table.name}`;
        if (!legacyPrior.has(table.name)) added.push(label);
        else if (legacyPrior.get(table.name) !== fingerprint)
          updated.push(label);
        else unchanged++;
        legacyPrior.delete(table.name);
      }
      return {
        sourceId: id,
        added,
        updated,
        retired: [
          ...prior.keys(),
          ...[...legacyPrior.keys()].map((name) => `[legacy] ${name}`),
        ],
        unchanged,
      };
    } finally {
      external.close();
    }
  }
  scan(id: string): ScanSummaryDto {
    const source = this.list().find((item) => item.id === id);
    if (!source) throw new Error("Data source not found");
    const parsed =
      source.type === "sql_file" ? sqlFileDatabase(source.filePath) : null;
    const external =
      parsed?.database ?? new DatabaseSync(source.filePath, { readOnly: true });
    try {
      const objects = external
        .prepare(
          "SELECT name,type,sql FROM sqlite_schema WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all() as Array<{
        name: string;
        type: "table" | "view";
        sql: string | null;
      }>;
      const scannedAt = new Date().toISOString();
      let added = 0,
        updated = 0,
        retired = 0,
        columnCount = 0,
        relationCount = 0;
      this.db.exec("BEGIN");
      try {
        const catalogId = String(
          (
            this.db
              .prepare(
                "SELECT id FROM catalogs WHERE data_source_id=? AND name=?",
              )
              .get(id, "main") as { id?: string } | undefined
          )?.id ?? randomUUID(),
        );
        this.db
          .prepare(
            "INSERT OR IGNORE INTO catalogs(id,data_source_id,name) VALUES(?,?,?)",
          )
          .run(catalogId, id, "main");
        const schemaId = String(
          (
            this.db
              .prepare("SELECT id FROM schemas WHERE catalog_id=? AND name=?")
              .get(catalogId, "main") as { id?: string } | undefined
          )?.id ?? randomUUID(),
        );
        this.db
          .prepare(
            "INSERT OR IGNORE INTO schemas(id,catalog_id,name) VALUES(?,?,?)",
          )
          .run(schemaId, catalogId, "main");
        const previous = this.db
          .prepare(
            "SELECT id,name,fingerprint FROM meta_tables WHERE schema_id=?",
          )
          .all(schemaId) as Array<{
          id: string;
          name: string;
          fingerprint: string;
        }>;
        const previousByName = new Map(previous.map((row) => [row.name, row]));
        const tableIds = new Map<string, string>();
        for (const object of objects) {
          const columns = external
            .prepare(`PRAGMA table_info(${quote(object.name)})`)
            .all() as Array<{
            cid: number;
            name: string;
            type: string;
            notnull: number;
            dflt_value: unknown;
            pk: number;
          }>;
          const originalDdl = parsed?.rawDdl.get(object.name) ?? object.sql;
          const importedTableComment =
            parsed?.tableComments.get(object.name.toLowerCase()) ?? null;
          const fingerprint = createHash("sha256")
            .update(
              JSON.stringify({
                object: { ...object, sql: originalDdl },
                columns,
              }),
            )
            .digest("hex");
          const prior = previousByName.get(object.name);
          const tableId = prior?.id ?? randomUUID();
          tableIds.set(object.name, tableId);
          if (!prior) {
            added++;
            this.db
              .prepare(
                "INSERT INTO meta_tables(id,schema_id,name,object_type,comment,raw_ddl,fingerprint,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
              )
              .run(
                tableId,
                schemaId,
                object.name,
                object.type,
                importedTableComment,
                originalDdl,
                fingerprint,
                scannedAt,
                scannedAt,
              );
          } else {
            if (prior.fingerprint !== fingerprint) updated++;
            this.db
              .prepare(
                "UPDATE meta_tables SET object_type=?,comment=COALESCE(comment,?),raw_ddl=?,fingerprint=?,retired=0,updated_at=? WHERE id=?",
              )
              .run(
                object.type,
                importedTableComment,
                originalDdl,
                fingerprint,
                scannedAt,
                tableId,
              );
          }
          const existingColumns = this.db
            .prepare("SELECT id,name FROM meta_columns WHERE table_id=?")
            .all(tableId) as Array<{ id: string; name: string }>;
          const existingByName = new Map(
            existingColumns.map((column) => [column.name, column]),
          );
          if (existingColumns.length)
            this.db
              .prepare(
                "UPDATE meta_columns SET ordinal=-ordinal WHERE table_id=?",
              )
              .run(tableId);
          const retained = new Set<string>();
          const insertColumn = this.db.prepare(
            "INSERT INTO meta_columns(id,table_id,name,ordinal,raw_type,normalized_type,nullable,default_value,comment,primary_key_ordinal) VALUES(?,?,?,?,?,?,?,?,?,?)",
          );
          const updateColumn = this.db.prepare(
            "UPDATE meta_columns SET ordinal=?,raw_type=?,normalized_type=?,nullable=?,default_value=?,comment=COALESCE(comment,?),primary_key_ordinal=? WHERE id=?",
          );
          for (const column of columns) {
            const existing = existingByName.get(column.name);
            const importedColumnComment =
              parsed?.columnComments.get(
                `${object.name.toLowerCase()}.${column.name.toLowerCase()}`,
              ) ?? null;
            const values = [
              column.cid + 1,
              column.type || "",
              normalizeType(column.type || ""),
              column.notnull ? 0 : 1,
              column.dflt_value == null ? null : String(column.dflt_value),
              importedColumnComment,
              column.pk || null,
            ] as const;
            if (existing) {
              updateColumn.run(...values, existing.id);
              retained.add(existing.id);
            } else {
              const columnId = randomUUID();
              insertColumn.run(columnId, tableId, column.name, ...values);
              retained.add(columnId);
            }
            columnCount++;
          }
          for (const existing of existingColumns)
            if (!retained.has(existing.id))
              this.db
                .prepare("DELETE FROM meta_columns WHERE id=?")
                .run(existing.id);
          this.db
            .prepare("DELETE FROM meta_indexes WHERE table_id=?")
            .run(tableId);
          const insertIndex = this.db.prepare(
            "INSERT INTO meta_indexes(id,table_id,name,unique_flag,origin,columns_json,raw_ddl) VALUES(?,?,?,?,?,?,?)",
          );
          for (const index of external
            .prepare(`PRAGMA index_list(${quote(object.name)})`)
            .all() as Array<{ name: string; unique: number; origin: string }>) {
            const indexColumns = (
              external
                .prepare(`PRAGMA index_info(${quote(index.name)})`)
                .all() as Array<{ seqno: number; name: string | null }>
            )
              .sort((left, right) => left.seqno - right.seqno)
              .map((item) => item.name ?? "<expression>");
            const indexDdl =
              (
                external
                  .prepare(
                    "SELECT sql FROM sqlite_schema WHERE type='index' AND name=?",
                  )
                  .get(index.name) as { sql: string | null } | undefined
              )?.sql ?? null;
            insertIndex.run(
              randomUUID(),
              tableId,
              index.name,
              index.unique ? 1 : 0,
              index.origin,
              JSON.stringify(indexColumns),
              indexDdl,
            );
          }
        }
        const names = new Set(objects.map((object) => object.name));
        for (const prior of previous)
          if (!names.has(prior.name)) {
            this.db
              .prepare(
                "UPDATE meta_tables SET retired=1,updated_at=? WHERE id=?",
              )
              .run(scannedAt, prior.id);
            retired++;
          }
        if (parsed?.legacyTables.length) {
          const legacy = this.syncLegacyMetadata(
            id,
            parsed.legacyTables,
            scannedAt,
          );
          added += legacy.added;
          updated += legacy.updated;
          retired += legacy.retired;
          columnCount += legacy.columns;
        }
        this.db
          .prepare(
            "DELETE FROM table_relations WHERE (origin='physical' OR (origin='inferred' AND status!='rejected')) AND source_table_id IN (SELECT table_object.id FROM meta_tables table_object JOIN schemas schema_object ON schema_object.id=table_object.schema_id JOIN catalogs catalog ON catalog.id=schema_object.catalog_id WHERE catalog.data_source_id=?)",
          )
          .run(id);
        const insertRelation = this.db.prepare(
          "INSERT INTO table_relations(id,source_table_id,target_table_id,relation_type,origin,confidence,status,evidence) VALUES(?,?,?,'many_to_one',?,?,?,?)",
        );
        const insertMapping = this.db.prepare(
          "INSERT INTO relation_columns(relation_id,source_column_id,target_column_id,ordinal) VALUES(?,?,?,?)",
        );
        const findColumn = this.db.prepare(
          "SELECT id FROM meta_columns WHERE table_id=? AND name=? COLLATE NOCASE",
        );
        const physicalColumns = new Set<string>();
        const rejectedInference = new Set(
          (
            this.db
              .prepare(
                "SELECT relation.source_table_id sourceTableId,relation.target_table_id targetTableId,mapping.source_column_id sourceColumnId FROM table_relations relation JOIN relation_columns mapping ON mapping.relation_id=relation.id WHERE relation.origin='inferred' AND relation.status='rejected'",
              )
              .all() as Array<{
              sourceTableId: string;
              targetTableId: string;
              sourceColumnId: string;
            }>
          ).map(
            (item) =>
              `${item.sourceTableId}|${item.targetTableId}|${item.sourceColumnId}`,
          ),
        );
        for (const object of objects.filter(
          (value) => value.type === "table",
        )) {
          const foreignKeys = external
            .prepare(`PRAGMA foreign_key_list(${quote(object.name)})`)
            .all() as Array<{
            id: number;
            seq: number;
            table: string;
            from: string;
            to: string;
          }>;
          const groups = new Map<number, typeof foreignKeys>();
          for (const fk of foreignKeys)
            groups.set(fk.id, [...(groups.get(fk.id) ?? []), fk]);
          for (const mappings of groups.values()) {
            const first = mappings[0]!;
            const target = tableIds.get(first.table);
            const sourceId = tableIds.get(object.name);
            if (!target || !sourceId) continue;
            const relationId = randomUUID();
            const evidence = mappings
              .map((fk) => `${fk.from} -> ${fk.table}.${fk.to}`)
              .join(", ");
            insertRelation.run(
              relationId,
              sourceId,
              target,
              "physical",
              1,
              "confirmed",
              evidence,
            );
            for (const fk of mappings.sort(
              (left, right) => left.seq - right.seq,
            )) {
              const sourceColumn = findColumn.get(sourceId, fk.from) as
                { id: string } | undefined;
              const targetColumn = findColumn.get(target, fk.to) as
                { id: string } | undefined;
              if (sourceColumn && targetColumn) {
                insertMapping.run(
                  relationId,
                  sourceColumn.id,
                  targetColumn.id,
                  fk.seq + 1,
                );
                physicalColumns.add(sourceColumn.id);
              }
            }
            relationCount++;
          }
        }
        for (const object of objects.filter(
          (value) => value.type === "table",
        )) {
          const sourceId = tableIds.get(object.name)!;
          const columns = this.db
            .prepare("SELECT id,name FROM meta_columns WHERE table_id=?")
            .all(sourceId) as Array<{ id: string; name: string }>;
          for (const column of columns) {
            const match = column.name.match(/^(.+)_id$/i);
            if (!match || physicalColumns.has(column.id)) continue;
            const prefix = match[1]!.toLowerCase();
            const targetEntry = [...tableIds.entries()].find(([name]) => {
              const normalized = name.toLowerCase();
              return (
                normalized === prefix ||
                normalized === `${prefix}s` ||
                normalized === `${prefix}es`
              );
            });
            if (!targetEntry || targetEntry[1] === sourceId) continue;
            if (
              rejectedInference.has(
                `${sourceId}|${targetEntry[1]}|${column.id}`,
              )
            ) {
              relationCount++;
              continue;
            }
            const targetColumn = this.db
              .prepare(
                "SELECT id FROM meta_columns WHERE table_id=? ORDER BY CASE WHEN primary_key_ordinal IS NULL THEN 1 ELSE 0 END,primary_key_ordinal,ordinal LIMIT 1",
              )
              .get(targetEntry[1]) as { id: string } | undefined;
            if (!targetColumn) continue;
            const relationId = randomUUID();
            insertRelation.run(
              relationId,
              sourceId,
              targetEntry[1],
              "inferred",
              0.7,
              "candidate",
              `Naming convention: ${column.name}`,
            );
            insertMapping.run(relationId, column.id, targetColumn.id, 1);
            relationCount++;
          }
        }
        this.db
          .prepare(
            "DELETE FROM metadata_fts WHERE object_id IN (SELECT table_object.id FROM meta_tables table_object JOIN schemas schema_object ON schema_object.id=table_object.schema_id JOIN catalogs catalog ON catalog.id=schema_object.catalog_id WHERE catalog.data_source_id=?)",
          )
          .run(id);
        this.db
          .prepare(
            "DELETE FROM metadata_fts WHERE object_id IN (SELECT column_object.id FROM meta_columns column_object JOIN meta_tables table_object ON table_object.id=column_object.table_id JOIN schemas schema_object ON schema_object.id=table_object.schema_id JOIN catalogs catalog ON catalog.id=schema_object.catalog_id WHERE catalog.data_source_id=?)",
          )
          .run(id);
        const insertFts = this.db.prepare(
          "INSERT INTO metadata_fts(object_id,object_type,name,path,comment) VALUES(?,?,?,?,?)",
        );
        const tagText = this.db.prepare(
          "SELECT GROUP_CONCAT(tag.name,' ') text FROM object_tags assignment JOIN tags tag ON tag.id=assignment.tag_id WHERE assignment.object_type=? AND assignment.object_id=?",
        );
        for (const object of objects) {
          const tableId = tableIds.get(object.name)!;
          const tableComment = (
            this.db
              .prepare("SELECT comment FROM meta_tables WHERE id=?")
              .get(tableId) as { comment: string | null }
          ).comment;
          const tableTags = (
            tagText.get("table", tableId) as { text: string | null }
          ).text;
          insertFts.run(
            tableId,
            "table",
            object.name,
            `${source.name}/main/${object.name}`,
            `${tableComment ?? ""} ${tableTags ?? ""}`.trim(),
          );
          const cols = this.db
            .prepare(
              "SELECT id,name,comment FROM meta_columns WHERE table_id=?",
            )
            .all(tableId) as Array<{
            id: string;
            name: string;
            comment: string | null;
          }>;
          for (const col of cols) {
            const columnTags = (
              tagText.get("column", col.id) as { text: string | null }
            ).text;
            insertFts.run(
              col.id,
              "column",
              col.name,
              `${source.name}/main/${object.name}/${col.name}`,
              `${col.comment ?? ""} ${columnTags ?? ""}`.trim(),
            );
          }
        }
        const legacyObjects = this.db
          .prepare(
            "SELECT table_object.id,table_object.name,table_object.comment FROM meta_tables table_object JOIN schemas schema_object ON schema_object.id=table_object.schema_id JOIN catalogs catalog ON catalog.id=schema_object.catalog_id WHERE catalog.data_source_id=? AND catalog.name='legacy-metadata' AND table_object.retired=0",
          )
          .all(id) as Array<{
          id: string;
          name: string;
          comment: string | null;
        }>;
        for (const table of legacyObjects) {
          const tableTags = (
            tagText.get("table", table.id) as { text: string | null }
          ).text;
          insertFts.run(
            table.id,
            "table",
            table.name,
            `${source.name}/legacy/${table.name}`,
            `${table.comment ?? ""} ${tableTags ?? ""}`.trim(),
          );
          const columns = this.db
            .prepare(
              "SELECT id,name,comment FROM meta_columns WHERE table_id=?",
            )
            .all(table.id) as Array<{
            id: string;
            name: string;
            comment: string | null;
          }>;
          for (const column of columns) {
            const columnTags = (
              tagText.get("column", column.id) as { text: string | null }
            ).text;
            insertFts.run(
              column.id,
              "column",
              column.name,
              `${source.name}/legacy/${table.name}/${column.name}`,
              `${column.comment ?? ""} ${columnTags ?? ""}`.trim(),
            );
          }
        }
        this.db
          .prepare(
            "UPDATE data_sources SET status='active',last_error=NULL,last_scanned_at=?,updated_at=? WHERE id=?",
          )
          .run(scannedAt, scannedAt, id);
        bumpMetadataRevision(this.db);
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
      return {
        sourceId: id,
        tables: objects.length + (parsed?.legacyTables.length ?? 0),
        columns: columnCount,
        relations: relationCount,
        added,
        updated,
        retired,
        scannedAt,
        warnings: parsed?.warnings ?? [],
      };
    } finally {
      external.close();
    }
  }
}
