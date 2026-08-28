import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { SQLInputValue } from "node:sqlite";
import type {
  ManagementModule,
  ManagementRecordDto,
  SaveManagementRecordInput,
} from "@datamaker/contracts";
import * as XLSX from "xlsx";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS column_weights (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, score INTEGER NOT NULL CHECK(score BETWEEN 0 AND 100), display_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS dictionary_items (
  id TEXT PRIMARY KEY, code TEXT NOT NULL, description TEXT NOT NULL, parent_id TEXT REFERENCES dictionary_items(id) ON DELETE SET NULL,
  path TEXT NOT NULL DEFAULT '', display_order INTEGER NOT NULL DEFAULT 0, UNIQUE(parent_id, code)
);
CREATE TABLE IF NOT EXISTS dictionary_definitions (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, code TEXT NOT NULL UNIQUE,
  dictionary_type TEXT NOT NULL DEFAULT 'list' CHECK(dictionary_type IN ('list','tree')),
  created_by TEXT NOT NULL DEFAULT 'local', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS dictionary_values (
  id TEXT PRIMARY KEY, dictionary_id TEXT NOT NULL REFERENCES dictionary_definitions(id) ON DELETE CASCADE,
  value TEXT NOT NULL, parent_id TEXT REFERENCES dictionary_values(id) ON DELETE CASCADE,
  weight INTEGER CHECK(weight IS NULL OR weight BETWEEN 1 AND 100), display_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(dictionary_id, parent_id, value)
);
CREATE INDEX IF NOT EXISTS idx_dictionary_values_dictionary ON dictionary_values(dictionary_id, parent_id, display_order);
CREATE UNIQUE INDEX IF NOT EXISTS uq_dictionary_values_sibling_value ON dictionary_values(dictionary_id, IFNULL(parent_id, ''), value);
CREATE TABLE IF NOT EXISTS metadata_factors (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT, owner TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS metadata_factor_columns (
  factor_id TEXT NOT NULL REFERENCES metadata_factors(id) ON DELETE CASCADE,
  column_id TEXT NOT NULL REFERENCES meta_columns(id) ON DELETE CASCADE,
  PRIMARY KEY(factor_id, column_id)
);
CREATE TABLE IF NOT EXISTS import_jobs (
  id TEXT PRIMARY KEY, source_name TEXT NOT NULL, source_type TEXT NOT NULL CHECK(source_type IN ('sql','sqlite','excel')),
  target_name TEXT, status TEXT NOT NULL CHECK(status IN ('pending','running','completed','failed')), imported_rows INTEGER NOT NULL DEFAULT 0,
  error_message TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS table_categories (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, parent_id TEXT REFERENCES table_categories(id) ON DELETE SET NULL,
  level_path TEXT NOT NULL DEFAULT '', display_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, UNIQUE(parent_id, name)
);
CREATE TABLE IF NOT EXISTS managed_data_tables (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, category_id TEXT REFERENCES table_categories(id) ON DELETE SET NULL,
  table_type TEXT NOT NULL DEFAULT 'business', is_tree INTEGER NOT NULL DEFAULT 0 CHECK(is_tree IN (0,1)),
  is_internal INTEGER NOT NULL DEFAULT 1 CHECK(is_internal IN (0,1)), is_public INTEGER NOT NULL DEFAULT 1 CHECK(is_public IN (0,1)),
  owner TEXT, row_count INTEGER NOT NULL DEFAULT 0, is_search_indexed INTEGER NOT NULL DEFAULT 0 CHECK(is_search_indexed IN (0,1)),
  description TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS daily_table_counts (
  id TEXT PRIMARY KEY, table_id TEXT REFERENCES managed_data_tables(id) ON DELETE CASCADE, table_name TEXT NOT NULL,
  daily_increase INTEGER NOT NULL DEFAULT 0, total_count INTEGER NOT NULL DEFAULT 0, stat_date TEXT NOT NULL, UNIQUE(table_name, stat_date)
);
CREATE TABLE IF NOT EXISTS data_cubes (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT, definition_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
`;

type Config = {
  table: string;
  columns: string[];
  required: string[];
  order: string;
  fixed?: Record<string, unknown>;
};
const configs: Record<ManagementModule, Config> = {
  weights: {
    table: "column_weights",
    columns: ["name", "score", "display_order"],
    required: ["name", "score"],
    order: "display_order, name",
  },
  dictionaries: {
    table: "dictionary_items",
    columns: ["code", "description", "parent_id", "path", "display_order"],
    required: ["code", "description"],
    order: "display_order, code",
  },
  dictionaryTree: {
    table: "dictionary_items",
    columns: ["code", "description", "parent_id", "path", "display_order"],
    required: ["code", "description"],
    order: "path, display_order, code",
  },
  factors: {
    table: "metadata_factors",
    columns: ["name", "description", "owner", "created_at"],
    required: ["name"],
    order: "name",
  },
  imports: {
    table: "import_jobs",
    columns: [
      "source_name",
      "source_type",
      "target_name",
      "status",
      "imported_rows",
      "error_message",
      "created_at",
    ],
    required: ["source_name", "source_type"],
    order: "created_at DESC",
  },
  tables: {
    table: "managed_data_tables",
    columns: [
      "name",
      "display_name",
      "category_id",
      "table_type",
      "is_tree",
      "is_internal",
      "is_public",
      "owner",
      "row_count",
      "is_search_indexed",
      "description",
      "created_at",
      "updated_at",
    ],
    required: ["name", "display_name"],
    order: "display_name",
  },
  privateTables: {
    table: "managed_data_tables",
    columns: [
      "name",
      "display_name",
      "category_id",
      "table_type",
      "is_tree",
      "is_internal",
      "is_public",
      "owner",
      "row_count",
      "is_search_indexed",
      "description",
      "created_at",
      "updated_at",
    ],
    required: ["name", "display_name"],
    order: "display_name",
    fixed: { is_public: 0 },
  },
  dailyCounts: {
    table: "daily_table_counts",
    columns: [
      "table_id",
      "table_name",
      "daily_increase",
      "total_count",
      "stat_date",
    ],
    required: ["table_name", "stat_date"],
    order: "stat_date DESC, table_name",
  },
  cubes: {
    table: "data_cubes",
    columns: [
      "name",
      "description",
      "definition_json",
      "created_at",
      "updated_at",
    ],
    required: ["name"],
    order: "name",
  },
  categories: {
    table: "table_categories",
    columns: ["name", "parent_id", "level_path", "display_order", "created_at"],
    required: ["name"],
    order: "level_path, display_order, name",
  },
  dictionaryDefinitions: {
    table: "dictionary_definitions",
    columns: [
      "name",
      "code",
      "dictionary_type",
      "created_by",
      "created_at",
      "updated_at",
    ],
    required: ["name", "code", "dictionary_type"],
    order: "created_at DESC, name",
  },
  dictionaryValues: {
    table: "dictionary_values",
    columns: [
      "dictionary_id",
      "value",
      "parent_id",
      "weight",
      "display_order",
      "created_at",
      "updated_at",
    ],
    required: ["dictionary_id", "value"],
    order: "dictionary_id, parent_id, display_order, value",
  },
};
const configFor = (module: ManagementModule) => {
  const config = configs[module];
  if (!config) throw new Error("Management module is invalid");
  return config;
};

export class MetadataManagementRepository {
  constructor(private readonly db: DatabaseSync) {
    db.exec(SCHEMA);
    this.seed();
  }

  private seed() {
    // Normalize the three legacy built-in Chinese labels without making them canonical source strings.
    this.db
      .prepare(
        "UPDATE column_weights SET name = 'Required' WHERE name = '\u5fc5\u586b' AND score = 80",
      )
      .run();
    this.db
      .prepare(
        "UPDATE column_weights SET name = 'Important' WHERE name = '\u91cd\u8981' AND score = 50",
      )
      .run();
    this.db
      .prepare(
        "UPDATE column_weights SET name = 'Standard' WHERE name = '\u4e00\u822c' AND score = 20",
      )
      .run();
    const insert = this.db.prepare(
      "INSERT OR IGNORE INTO column_weights(id,name,score,display_order) VALUES(?,?,?,?)",
    );
    insert.run(randomUUID(), "Required", 80, 1);
    insert.run(randomUUID(), "Important", 50, 2);
    insert.run(randomUUID(), "Standard", 20, 3);
  }

  list(module: ManagementModule): ManagementRecordDto[] {
    const config = configFor(module);
    if (module === "factors")
      return this.db
        .prepare(
          `SELECT factor.*,
           COALESCE((SELECT json_group_array(column_id) FROM metadata_factor_columns WHERE factor_id=factor.id),'[]') field_ids_json,
           COALESCE((SELECT json_group_array(json_object('id',column_object.id,'name',column_object.name,'comment',column_object.comment,'tableId',table_object.id,'tableName',table_object.name))
             FROM metadata_factor_columns assignment
             JOIN meta_columns column_object ON column_object.id=assignment.column_id
             JOIN meta_tables table_object ON table_object.id=column_object.table_id
             WHERE assignment.factor_id=factor.id),'[]') field_details_json
           FROM metadata_factors factor ORDER BY factor.name`,
        )
        .all() as unknown as ManagementRecordDto[];
    const where = config.fixed
      ? ` WHERE ${Object.keys(config.fixed)
          .map((key) => `${key} = ?`)
          .join(" AND ")}`
      : "";
    const values = config.fixed
      ? (Object.values(config.fixed) as SQLInputValue[])
      : [];
    return this.db
      .prepare(`SELECT * FROM ${config.table}${where} ORDER BY ${config.order}`)
      .all(...values) as unknown as ManagementRecordDto[];
  }

  save(
    module: ManagementModule,
    input: SaveManagementRecordInput,
  ): ManagementRecordDto {
    if (module === "factors") return this.saveFactor(input);
    const config = configFor(module);
    const now = new Date().toISOString();
    const existing = input.id
      ? (this.db
          .prepare(`SELECT * FROM ${config.table} WHERE id = ?`)
          .get(input.id) as Record<string, unknown> | undefined)
      : undefined;
    const values: Record<string, unknown> = {
      ...(module === "dictionaryValues" ? existing : undefined),
      ...input.values,
      ...config.fixed,
    };
    if (config.columns.includes("created_at") && !values.created_at)
      values.created_at = now;
    if (config.columns.includes("updated_at")) values.updated_at = now;
    if (module === "imports" && !values.status) values.status = "pending";
    if (module === "cubes" && !values.definition_json)
      values.definition_json = "{}";
    if (module === "dictionaryDefinitions") {
      values.code = String(values.code ?? "")
        .trim()
        .toUpperCase();
      values.dictionary_type =
        values.dictionary_type === "tree" ? "tree" : "list";
      if (existing && existing.dictionary_type !== values.dictionary_type) {
        const count = this.db
          .prepare(
            "SELECT COUNT(*) AS count FROM dictionary_values WHERE dictionary_id = ?",
          )
          .get(input.id!) as { count: number };
        if (count.count)
          throw new Error(
            "Dictionary type cannot be changed after data has been added",
          );
      }
    }
    if (module === "dictionaryValues") {
      values.parent_id = values.parent_id || null;
      values.weight =
        values.weight === "" || values.weight === undefined
          ? null
          : values.weight;
      if (values.parent_id === input.id)
        throw new Error("A dictionary item cannot be its own parent");
      const definition = this.db
        .prepare(
          "SELECT dictionary_type FROM dictionary_definitions WHERE id = ?",
        )
        .get(values.dictionary_id as string) as
        { dictionary_type: string } | undefined;
      if (!definition) throw new Error("Dictionary definition not found");
      if (definition.dictionary_type === "list") values.parent_id = null;
      if (values.parent_id) {
        const parent = this.db
          .prepare("SELECT dictionary_id FROM dictionary_values WHERE id = ?")
          .get(values.parent_id as string) as
          { dictionary_id: string } | undefined;
        if (!parent || parent.dictionary_id !== values.dictionary_id)
          throw new Error("Parent item must belong to the same dictionary");
        if (input.id) {
          const cycle = this.db
            .prepare(
              `WITH RECURSIVE descendants(id) AS (
            SELECT id FROM dictionary_values WHERE parent_id = ? UNION ALL
            SELECT value.id FROM dictionary_values value JOIN descendants ON value.parent_id = descendants.id
          ) SELECT 1 FROM descendants WHERE id = ?`,
            )
            .get(input.id, values.parent_id as string);
          if (cycle)
            throw new Error(
              "A dictionary item cannot be moved below one of its descendants",
            );
        }
      }
    }
    for (const field of config.required) {
      if (
        values[field] === undefined ||
        values[field] === null ||
        values[field] === ""
      )
        throw new Error(`Field ${field} is required`);
    }
    const selected = config.columns.filter(
      (column) => values[column] !== undefined,
    );
    const id = input.id ?? randomUUID();
    if (input.id) {
      if (
        !this.db.prepare(`SELECT 1 FROM ${config.table} WHERE id = ?`).get(id)
      )
        throw new Error("Record not found");
      this.db
        .prepare(
          `UPDATE ${config.table} SET ${selected.map((column) => `${column} = ?`).join(", ")} WHERE id = ?`,
        )
        .run(...selected.map((column) => values[column] as never), id);
    } else {
      this.db
        .prepare(
          `INSERT INTO ${config.table}(id,${selected.join(",")}) VALUES(?${selected.map(() => ",?").join("")})`,
        )
        .run(id, ...selected.map((column) => values[column] as never));
    }
    if (module === "imports" && !input.id) this.executeImport(id, values);
    return this.db
      .prepare(`SELECT * FROM ${config.table} WHERE id = ?`)
      .get(id) as unknown as ManagementRecordDto;
  }

  private saveFactor(input: SaveManagementRecordInput): ManagementRecordDto {
    const existing = input.id
      ? (this.db
          .prepare("SELECT * FROM metadata_factors WHERE id=?")
          .get(input.id) as Record<string, unknown> | undefined)
      : undefined;
    if (input.id && !existing) throw new Error("Record not found");
    const name = String(input.values.name ?? existing?.name ?? "").trim();
    if (!name || name.length > 64)
      throw new Error("Factor name must contain 1 to 64 characters");
    let fieldIds: string[];
    try {
      const parsed = JSON.parse(String(input.values.field_ids_json ?? "[]"));
      if (!Array.isArray(parsed)) throw new Error();
      fieldIds = [...new Set(parsed.map(String).filter(Boolean))];
    } catch {
      throw new Error("Factor fields are invalid");
    }
    if (!fieldIds.length) throw new Error("Select at least one factor field");
    if (fieldIds.length > 10_000) throw new Error("Too many factor fields");
    const placeholders = fieldIds.map(() => "?").join(",");
    const existingFields = Number(
      (
        this.db
          .prepare(
            `SELECT COUNT(*) count FROM meta_columns WHERE id IN (${placeholders})`,
          )
          .get(...fieldIds) as { count: number }
      ).count,
    );
    if (existingFields !== fieldIds.length)
      throw new Error("One or more factor fields no longer exist");
    const id = input.id ?? randomUUID();
    const now = new Date().toISOString();
    this.db.exec("BEGIN");
    try {
      if (existing)
        this.db
          .prepare(
            "UPDATE metadata_factors SET name=?,description=?,owner=? WHERE id=?",
          )
          .run(
            name,
            (input.values.description ??
              existing.description ??
              null) as SQLInputValue,
            (input.values.owner ?? existing.owner ?? null) as SQLInputValue,
            id,
          );
      else
        this.db
          .prepare(
            "INSERT INTO metadata_factors(id,name,description,owner,created_at) VALUES(?,?,?,?,?)",
          )
          .run(
            id,
            name,
            (input.values.description ?? null) as SQLInputValue,
            (input.values.owner ?? null) as SQLInputValue,
            now,
          );
      this.db
        .prepare("DELETE FROM metadata_factor_columns WHERE factor_id=?")
        .run(id);
      const assign = this.db.prepare(
        "INSERT INTO metadata_factor_columns(factor_id,column_id) VALUES(?,?)",
      );
      for (const fieldId of fieldIds) assign.run(id, fieldId);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.list("factors").find((item) => item.id === id)!;
  }

  private executeImport(jobId: string, values: Record<string, unknown>) {
    const file = String(values.source_name ?? "");
    const type = String(values.source_type ?? "");
    this.db
      .prepare("UPDATE import_jobs SET status = 'running' WHERE id = ?")
      .run(jobId);
    try {
      let importedTables: Array<{
        name: string;
        displayName: string;
        rowCount: number;
      }> = [];
      if (type === "sql") {
        const bytes = fs.readFileSync(file);
        let text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
        if (text.includes("\uFFFD"))
          text = new TextDecoder("gbk").decode(bytes);
        importedTables = [
          ...text.matchAll(
            /CREATE\s+TABLE\s+(?:(?:"[^"]+"|[\w\u4e00-\u9fa5]+)\.)?["`\[]?([\w\u4e00-\u9fa5]+)["`\]]?/gi,
          ),
        ]
          .map((match) => ({
            name: match[1]!,
            displayName: match[1]!,
            rowCount: 0,
          }))
          .filter((item) => Boolean(item.name));
      } else if (type === "sqlite") {
        const source = new DatabaseSync(file, { readOnly: true });
        importedTables = (
          source
            .prepare(
              "SELECT name FROM sqlite_schema WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'",
            )
            .all() as Array<{ name: string }>
        ).map((row) => ({
          name: row.name,
          displayName: row.name,
          rowCount: 0,
        }));
        source.close();
      } else if (type === "excel") {
        const workbook = XLSX.readFile(file, { dense: true });
        const prefix = String(values.target_name ?? "").trim();
        importedTables = workbook.SheetNames.map((sheetName) => {
          const sheet = workbook.Sheets[sheetName]!;
          const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
            header: 1,
            blankrows: false,
          });
          const normalized = `${prefix}${prefix ? "_" : ""}${sheetName}`
            .trim()
            .replace(/[^A-Za-z0-9_\u4e00-\u9fa5]+/g, "_");
          return {
            name: normalized || `SHEET_${randomUUID().slice(0, 8)}`,
            displayName: sheetName,
            rowCount: Math.max(0, rows.length - 1),
          };
        });
      } else throw new Error(`Unsupported import type: ${type}`);
      const now = new Date().toISOString();
      const insert = this.db.prepare(`INSERT INTO managed_data_tables(
        id,name,display_name,table_type,is_tree,is_internal,is_public,row_count,is_search_indexed,description,created_at,updated_at
      ) VALUES(?,?,?,?,0,0,1,?,0,?,?,?) ON CONFLICT(name) DO UPDATE SET row_count=excluded.row_count,updated_at=excluded.updated_at`);
      this.db.exec("BEGIN");
      try {
        const unique = [
          ...new Map(importedTables.map((item) => [item.name, item])).values(),
        ];
        for (const item of unique)
          insert.run(
            randomUUID(),
            item.name,
            item.displayName,
            "imported",
            item.rowCount,
            `Imported from external ${type.toUpperCase()}`,
            now,
            now,
          );
        const importedCount =
          type === "excel"
            ? unique.reduce((total, item) => total + item.rowCount, 0)
            : unique.length;
        this.db
          .prepare(
            "UPDATE import_jobs SET status = 'completed', imported_rows = ?, error_message = NULL WHERE id = ?",
          )
          .run(importedCount, jobId);
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    } catch (error) {
      this.db
        .prepare(
          "UPDATE import_jobs SET status = 'failed', error_message = ? WHERE id = ?",
        )
        .run(error instanceof Error ? error.message : "Import failed", jobId);
    }
  }

  remove(module: ManagementModule, id: string) {
    const config = configFor(module);
    const result = this.db
      .prepare(`DELETE FROM ${config.table} WHERE id = ?`)
      .run(id);
    if (!result.changes) throw new Error("Record not found");
  }
}
