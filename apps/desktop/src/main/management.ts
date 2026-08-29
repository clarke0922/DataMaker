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

const sqlValue = (value: unknown): SQLInputValue =>
  typeof value === "boolean" ? Number(value) : (value as SQLInputValue);

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
  parent_id TEXT REFERENCES managed_data_tables(id) ON DELETE SET NULL, source_table_id TEXT REFERENCES meta_tables(id) ON DELETE SET NULL,
  table_type TEXT NOT NULL DEFAULT 'business', is_tree INTEGER NOT NULL DEFAULT 0 CHECK(is_tree IN (0,1)),
  is_internal INTEGER NOT NULL DEFAULT 1 CHECK(is_internal IN (0,1)), is_public INTEGER NOT NULL DEFAULT 1 CHECK(is_public IN (0,1)),
  owner TEXT, row_count INTEGER NOT NULL DEFAULT 0, is_search_indexed INTEGER NOT NULL DEFAULT 0 CHECK(is_search_indexed IN (0,1)),
  icon TEXT, display_order INTEGER NOT NULL DEFAULT 0, description TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS managed_table_columns (
  id TEXT PRIMARY KEY, table_id TEXT NOT NULL REFERENCES managed_data_tables(id) ON DELETE CASCADE,
  name TEXT NOT NULL, display_name TEXT NOT NULL, data_type TEXT NOT NULL,
  length INTEGER, precision INTEGER, nullable INTEGER NOT NULL DEFAULT 1 CHECK(nullable IN (0,1)),
  is_primary_key INTEGER NOT NULL DEFAULT 0 CHECK(is_primary_key IN (0,1)), is_pinyin INTEGER NOT NULL DEFAULT 0 CHECK(is_pinyin IN (0,1)),
  is_tree_display INTEGER NOT NULL DEFAULT 0 CHECK(is_tree_display IN (0,1)), is_multiple INTEGER NOT NULL DEFAULT 0 CHECK(is_multiple IN (0,1)),
  dictionary_name TEXT, weight INTEGER NOT NULL DEFAULT 0, display_order INTEGER NOT NULL DEFAULT 0,
  show_in_list INTEGER NOT NULL DEFAULT 1 CHECK(show_in_list IN (0,1)), searchable INTEGER NOT NULL DEFAULT 0 CHECK(searchable IN (0,1)),
  title_column INTEGER NOT NULL DEFAULT 0 CHECK(title_column IN (0,1)), group_required INTEGER NOT NULL DEFAULT 0 CHECK(group_required IN (0,1)),
  UNIQUE(table_id,name)
);
CREATE TABLE IF NOT EXISTS daily_table_counts (
  id TEXT PRIMARY KEY, table_id TEXT REFERENCES managed_data_tables(id) ON DELETE CASCADE, table_name TEXT NOT NULL,
  daily_increase INTEGER NOT NULL DEFAULT 0, total_count INTEGER NOT NULL DEFAULT 0, stat_date TEXT NOT NULL, UNIQUE(table_name, stat_date)
);
CREATE TABLE IF NOT EXISTS data_cubes (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT, definition_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS system_types (
  id TEXT PRIMARY KEY, code TEXT NOT NULL COLLATE NOCASE UNIQUE, name TEXT NOT NULL, type_group TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY, code TEXT NOT NULL COLLATE NOCASE UNIQUE, name TEXT NOT NULL,
  full_name TEXT NOT NULL, parent_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT,
  contact TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', postal_code TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '', display_order INTEGER NOT NULL DEFAULT 0,
  registered_by TEXT NOT NULL DEFAULT 'local', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_organizations_parent_order ON organizations(parent_id, display_order, name);
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
  organizations: {
    table: "organizations",
    columns: [
      "code", "name", "full_name", "parent_id", "contact", "address",
      "postal_code", "email", "display_order", "registered_by", "created_at", "updated_at",
    ],
    required: ["code", "name"],
    order: "full_name, display_order, name",
  },
  systemTypes: {
    table: "system_types",
    columns: ["code", "name", "type_group", "created_at", "updated_at"],
    required: ["code", "name"],
    order: "type_group, code COLLATE NOCASE",
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
    const tableColumns = new Set(
      (
        db.prepare("PRAGMA table_info('managed_data_tables')").all() as Array<{
          name: string;
        }>
      ).map((column) => column.name),
    );
    for (const [name, definition] of [
      [
        "parent_id",
        "TEXT REFERENCES managed_data_tables(id) ON DELETE SET NULL",
      ],
      ["source_table_id", "TEXT REFERENCES meta_tables(id) ON DELETE SET NULL"],
      ["icon", "TEXT"],
      ["display_order", "INTEGER NOT NULL DEFAULT 0"],
    ] as const)
      if (!tableColumns.has(name))
        db.exec(
          `ALTER TABLE managed_data_tables ADD COLUMN ${name} ${definition}`,
        );
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
    if (module === "tables" || module === "privateTables")
      return this.listManagedTables(module === "privateTables");
    if (module === "organizations")
      return this.db.prepare(`SELECT organization.*, parent.name parent_name,
        (SELECT COUNT(*) FROM organizations child WHERE child.parent_id = organization.id) child_count
        FROM organizations organization LEFT JOIN organizations parent ON parent.id = organization.parent_id
        ORDER BY organization.full_name, organization.display_order, organization.name`).all() as unknown as ManagementRecordDto[];
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
    if (module === "tables" || module === "privateTables")
      return this.saveManagedTable(input, module === "privateTables");
    if (module === "dailyCounts") return this.saveDailyCount(input);
    if (module === "categories") return this.saveCategory(input);
    if (module === "systemTypes") return this.saveSystemType(input);
    if (module === "organizations") return this.saveOrganization(input);
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

  private saveSystemType(
    input: SaveManagementRecordInput,
  ): ManagementRecordDto {
    const existing = input.id
      ? (this.db
          .prepare("SELECT * FROM system_types WHERE id = ?")
          .get(input.id) as Record<string, unknown> | undefined)
      : undefined;
    if (input.id && !existing) throw new Error("Record not found");
    const code = String(input.values.code ?? existing?.code ?? "")
      .trim()
      .toUpperCase();
    const name = String(input.values.name ?? existing?.name ?? "").trim();
    const group = String(
      input.values.type_group ?? existing?.type_group ?? "",
    ).trim();
    if (!code || !name) throw new Error("Type code and name are required");
    if (code.length > 20 || name.length > 30 || group.length > 20)
      throw new Error("System type field length exceeds the allowed limit");
    const id = input.id ?? randomUUID();
    const now = new Date().toISOString();
    if (existing)
      this.db
        .prepare(
          "UPDATE system_types SET code=?,name=?,type_group=?,updated_at=? WHERE id=?",
        )
        .run(code, name, group, now, id);
    else
      this.db
        .prepare(
          "INSERT INTO system_types(id,code,name,type_group,created_at,updated_at) VALUES(?,?,?,?,?,?)",
        )
        .run(id, code, name, group, now, now);
    return this.db
      .prepare("SELECT * FROM system_types WHERE id=?")
      .get(id) as unknown as ManagementRecordDto;
  }

  private saveCategory(input: SaveManagementRecordInput): ManagementRecordDto {
    const existing = input.id
      ? (this.db
          .prepare("SELECT * FROM table_categories WHERE id = ?")
          .get(input.id) as Record<string, unknown> | undefined)
      : undefined;
    if (input.id && !existing) throw new Error("Record not found");
    const name = String(input.values.name ?? existing?.name ?? "").trim();
    if (!name) throw new Error("Field name is required");
    const parentId = input.id
      ? (existing?.parent_id as string | null)
      : input.values.parent_id
        ? String(input.values.parent_id)
        : null;
    const parent = parentId
      ? (this.db
          .prepare("SELECT id, level_path FROM table_categories WHERE id = ?")
          .get(parentId) as { id: string; level_path: string } | undefined)
      : undefined;
    if (parentId && !parent) throw new Error("Parent category not found");
    const order = Number(
      input.values.display_order ?? existing?.display_order ?? 0,
    );
    if (!Number.isSafeInteger(order))
      throw new Error("Order must be an integer");
    const id = input.id ?? randomUUID();
    if (existing) {
      this.db
        .prepare(
          "UPDATE table_categories SET name = ?, display_order = ? WHERE id = ?",
        )
        .run(name, order, id);
    } else {
      this.db
        .prepare(
          "INSERT INTO table_categories(id,name,parent_id,level_path,display_order,created_at) VALUES(?,?,?,?,?,?)",
        )
        .run(
          id,
          name,
          parentId,
          parent ? `${parent.level_path}${parent.id}/` : "/",
          order,
          new Date().toISOString(),
        );
    }
    return this.db
      .prepare("SELECT * FROM table_categories WHERE id = ?")
      .get(id) as unknown as ManagementRecordDto;
  }

  private saveDailyCount(
    input: SaveManagementRecordInput,
  ): ManagementRecordDto {
    const existing = input.id
      ? (this.db
          .prepare("SELECT * FROM daily_table_counts WHERE id=?")
          .get(input.id) as Record<string, SQLInputValue> | undefined)
      : undefined;
    if (input.id && !existing) throw new Error("Record not found");
    const values = { ...existing, ...input.values };
    const tableId = String(values.table_id ?? "").trim() || null;
    const managed = tableId
      ? (this.db
          .prepare("SELECT name FROM managed_data_tables WHERE id=?")
          .get(tableId) as { name: string } | undefined)
      : undefined;
    if (tableId && !managed) throw new Error("Managed table not found");
    const tableName = managed?.name ?? String(values.table_name ?? "").trim();
    const statDate = String(values.stat_date ?? "").slice(0, 10);
    const increase = Number(values.daily_increase ?? 0);
    const total = Number(values.total_count ?? 0);
    if (!tableName) throw new Error("Table name is required");
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(statDate) ||
      Number.isNaN(Date.parse(statDate))
    )
      throw new Error("Statistics date is invalid");
    if (
      !Number.isSafeInteger(increase) ||
      !Number.isSafeInteger(total) ||
      total < 0
    )
      throw new Error("Count values are invalid");
    const id = input.id ?? randomUUID();
    if (existing)
      this.db
        .prepare(
          "UPDATE daily_table_counts SET table_id=?,table_name=?,daily_increase=?,total_count=?,stat_date=? WHERE id=?",
        )
        .run(tableId, tableName, increase, total, statDate, id);
    else
      this.db
        .prepare(
          "INSERT INTO daily_table_counts(id,table_id,table_name,daily_increase,total_count,stat_date) VALUES(?,?,?,?,?,?)",
        )
        .run(id, tableId, tableName, increase, total, statDate);
    return this.db
      .prepare("SELECT * FROM daily_table_counts WHERE id=?")
      .get(id) as unknown as ManagementRecordDto;
  }

  private listManagedTables(privateOnly: boolean): ManagementRecordDto[] {
    return this.db
      .prepare(
        `SELECT table_object.*,
         category.name category_name, parent.name parent_name,
         COALESCE((SELECT json_group_array(json_object(
           'id',column_object.id,'name',column_object.name,'display_name',column_object.display_name,
           'data_type',column_object.data_type,'length',column_object.length,'precision',column_object.precision,
           'nullable',column_object.nullable,'is_primary_key',column_object.is_primary_key,'is_pinyin',column_object.is_pinyin,
           'is_tree_display',column_object.is_tree_display,'is_multiple',column_object.is_multiple,
           'dictionary_name',column_object.dictionary_name,'weight',column_object.weight,'display_order',column_object.display_order,
           'show_in_list',column_object.show_in_list,'searchable',column_object.searchable,
           'title_column',column_object.title_column,'group_required',column_object.group_required
         )) FROM managed_table_columns column_object WHERE column_object.table_id=table_object.id ORDER BY column_object.display_order),'[]') columns_json
         FROM managed_data_tables table_object
         LEFT JOIN table_categories category ON category.id=table_object.category_id
         LEFT JOIN managed_data_tables parent ON parent.id=table_object.parent_id
         ${privateOnly ? "WHERE table_object.is_public=0" : ""}
         ORDER BY table_object.display_order,table_object.display_name`,
      )
      .all() as unknown as ManagementRecordDto[];
  }

  private saveManagedTable(
    input: SaveManagementRecordInput,
    privateOnly: boolean,
  ): ManagementRecordDto {
    const existing = input.id
      ? (this.db
          .prepare("SELECT * FROM managed_data_tables WHERE id=?")
          .get(input.id) as Record<string, SQLInputValue> | undefined)
      : undefined;
    if (input.id && !existing) throw new Error("Record not found");
    const values = { ...existing, ...input.values };
    const name = String(values.name ?? "").trim();
    const displayName = String(values.display_name ?? "").trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name))
      throw new Error("Physical table name is invalid");
    if (!displayName || displayName.length > 100)
      throw new Error("Display name must contain 1 to 100 characters");
    if (input.id && values.parent_id === input.id)
      throw new Error("A table cannot be its own parent");
    let columns: Array<Record<string, unknown>> | undefined;
    if (input.values.columns_json !== undefined) {
      try {
        const parsed = JSON.parse(String(input.values.columns_json));
        if (!Array.isArray(parsed)) throw new Error();
        columns = parsed;
      } catch {
        throw new Error("Table fields are invalid");
      }
      const names = columns.map((column) => String(column.name ?? "").trim());
      if (
        names.some((column) => !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(column)) ||
        new Set(names.map((column) => column.toLowerCase())).size !==
          names.length
      )
        throw new Error("Field names must be valid and unique");
      if (columns.some((column) => !String(column.display_name ?? "").trim()))
        throw new Error("Field display name is required");
    }
    const id = input.id ?? randomUUID();
    const now = new Date().toISOString();
    this.db.exec("BEGIN");
    try {
      if (existing)
        this.db
          .prepare(
            `UPDATE managed_data_tables SET name=?,display_name=?,category_id=?,parent_id=?,source_table_id=?,table_type=?,is_tree=?,is_internal=?,is_public=?,owner=?,row_count=?,is_search_indexed=?,icon=?,display_order=?,description=?,updated_at=? WHERE id=?`,
          )
          .run(
            ...[
              name,
              displayName,
              values.category_id || null,
              values.parent_id || null,
              values.source_table_id || null,
              values.table_type || "business",
              Number(Boolean(values.is_tree)),
              Number(Boolean(values.is_internal)),
              privateOnly ? 0 : Number(values.is_public ?? 1),
              values.owner || null,
              Number(values.row_count ?? 0),
              Number(Boolean(values.is_search_indexed)),
              values.icon || null,
              Number(values.display_order ?? 0),
              values.description || null,
              now,
              id,
            ].map(sqlValue),
          );
      else
        this.db
          .prepare(
            `INSERT INTO managed_data_tables(id,name,display_name,category_id,parent_id,source_table_id,table_type,is_tree,is_internal,is_public,owner,row_count,is_search_indexed,icon,display_order,description,created_at,updated_at)
             VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            ...[
              id,
              name,
              displayName,
              values.category_id || null,
              values.parent_id || null,
              values.source_table_id || null,
              values.table_type || "business",
              Number(Boolean(values.is_tree)),
              Number(Boolean(values.is_internal ?? 1)),
              privateOnly ? 0 : Number(values.is_public ?? 1),
              values.owner || null,
              Number(values.row_count ?? 0),
              Number(Boolean(values.is_search_indexed)),
              values.icon || null,
              Number(values.display_order ?? 0),
              values.description || null,
              now,
              now,
            ].map(sqlValue),
          );
      if (columns) {
        this.db
          .prepare("DELETE FROM managed_table_columns WHERE table_id=?")
          .run(id);
        const insert = this.db.prepare(
          `INSERT INTO managed_table_columns(id,table_id,name,display_name,data_type,length,precision,nullable,is_primary_key,is_pinyin,is_tree_display,is_multiple,dictionary_name,weight,display_order,show_in_list,searchable,title_column,group_required)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        );
        for (const [index, column] of columns.entries())
          insert.run(
            ...[
              String(column.id ?? randomUUID()),
              id,
              String(column.name).trim(),
              String(column.display_name).trim(),
              String(column.data_type ?? "varchar"),
              column.length === null || column.length === ""
                ? null
                : Number(column.length ?? 32),
              column.precision === null || column.precision === ""
                ? null
                : Number(column.precision ?? 0),
              Number(Boolean(column.nullable ?? 1)),
              Number(Boolean(column.is_primary_key)),
              Number(Boolean(column.is_pinyin)),
              Number(Boolean(column.is_tree_display)),
              Number(Boolean(column.is_multiple)),
              column.dictionary_name || null,
              Number(column.weight ?? 0),
              Number(column.display_order ?? index),
              Number(Boolean(column.show_in_list ?? 1)),
              Number(Boolean(column.searchable)),
              Number(Boolean(column.title_column)),
              Number(Boolean(column.group_required)),
            ].map(sqlValue),
          );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.listManagedTables(privateOnly).find((item) => item.id === id)!;
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

  private saveOrganization(input: SaveManagementRecordInput): ManagementRecordDto {
    const existing = input.id
      ? this.db.prepare("SELECT * FROM organizations WHERE id = ?").get(input.id) as Record<string, unknown> | undefined
      : undefined;
    if (input.id && !existing) throw new Error("Organization not found");
    const values = { ...existing, ...input.values };
    const code = String(values.code ?? "").trim().toUpperCase();
    const name = String(values.name ?? "").trim();
    const parentId = values.parent_id ? String(values.parent_id) : null;
    if (!/^[A-Z0-9_-]{1,3}$/.test(code))
      throw new Error("Organization code must be 1-3 letters, numbers, underscores, or hyphens");
    if (!name || name.length > 100) throw new Error("Organization name must be 1-100 characters");
    if (parentId === input.id) throw new Error("An organization cannot be its own parent");
    const parent = parentId
      ? this.db.prepare("SELECT id, full_name FROM organizations WHERE id = ?").get(parentId) as { id: string; full_name: string } | undefined
      : undefined;
    if (parentId && !parent) throw new Error("Parent organization not found");
    if (input.id && parentId && this.db.prepare(`WITH RECURSIVE descendants(id) AS (
      SELECT id FROM organizations WHERE parent_id = ? UNION ALL
      SELECT child.id FROM organizations child JOIN descendants parent ON child.parent_id = parent.id
    ) SELECT 1 FROM descendants WHERE id = ?`).get(input.id, parentId))
      throw new Error("An organization cannot be moved below its descendant");
    const email = String(values.email ?? "").trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Email address is invalid");
    const postalCode = String(values.postal_code ?? "").trim();
    if (postalCode.length > 6) throw new Error("Postal code cannot exceed 6 characters");
    const fullName = parent ? `${parent.full_name} / ${name}` : name;
    const now = new Date().toISOString();
    const id = input.id ?? randomUUID();
    const params = [
      code, name, fullName, parentId, String(values.contact ?? "").trim(),
      String(values.address ?? "").trim(), postalCode, email,
      Number(values.display_order ?? 0), String(values.registered_by ?? "local"), now,
    ];
    this.db.exec("BEGIN");
    try {
      if (existing)
        this.db.prepare(`UPDATE organizations SET code=?,name=?,full_name=?,parent_id=?,contact=?,address=?,postal_code=?,email=?,display_order=?,registered_by=?,updated_at=? WHERE id=?`).run(...params, id);
      else
        this.db.prepare(`INSERT INTO organizations(code,name,full_name,parent_id,contact,address,postal_code,email,display_order,registered_by,created_at,updated_at,id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(...params.slice(0, 10), now, now, id);
      this.refreshOrganizationChildren(id, fullName, now);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.list("organizations").find((item) => item.id === id)!;
  }

  private refreshOrganizationChildren(parentId: string, parentFullName: string, now: string) {
    const children = this.db.prepare("SELECT id, name FROM organizations WHERE parent_id = ?").all(parentId) as Array<{ id: string; name: string }>;
    for (const child of children) {
      const fullName = `${parentFullName} / ${child.name}`;
      this.db.prepare("UPDATE organizations SET full_name = ?, updated_at = ? WHERE id = ?").run(fullName, now, child.id);
      this.refreshOrganizationChildren(child.id, fullName, now);
    }
  }

  remove(module: ManagementModule, id: string) {
    const config = configFor(module);
    if (module === "categories") {
      if (
        this.db
          .prepare("SELECT 1 FROM table_categories WHERE parent_id = ? LIMIT 1")
          .get(id)
      )
        throw new Error("Categories with child categories cannot be deleted");
      if (
        this.db
          .prepare(
            "SELECT 1 FROM managed_data_tables WHERE category_id = ? LIMIT 1",
          )
          .get(id)
      )
        throw new Error("Categories containing data tables cannot be deleted");
    }
    if (module === "organizations" && this.db
      .prepare("SELECT 1 FROM organizations WHERE parent_id = ? LIMIT 1").get(id))
      throw new Error("Organizations with child organizations cannot be deleted");
    const result = this.db
      .prepare(`DELETE FROM ${config.table} WHERE id = ?`)
      .run(id);
    if (!result.changes) throw new Error("Record not found");
  }
}
