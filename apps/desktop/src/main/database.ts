import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import type { SearchHitDto } from "@datamaker/contracts";

const MIGRATION = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','locked','disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  built_in INTEGER NOT NULL DEFAULT 0 CHECK(built_in IN (0,1))
);
CREATE TABLE IF NOT EXISTS permissions (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  domain TEXT NOT NULL,
  action TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS user_roles (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY(user_id, role_id)
);
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY(role_id, permission_id)
);
CREATE TABLE IF NOT EXISTS data_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  type TEXT NOT NULL CHECK(type IN ('sqlite','sql_file')),
  config_json TEXT NOT NULL DEFAULT '{}',
  secret_ref TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  last_scanned_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS catalogs (
  id TEXT PRIMARY KEY,
  data_source_id TEXT NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  UNIQUE(data_source_id, name)
);
CREATE TABLE IF NOT EXISTS schemas (
  id TEXT PRIMARY KEY,
  catalog_id TEXT NOT NULL REFERENCES catalogs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  UNIQUE(catalog_id, name)
);
CREATE TABLE IF NOT EXISTS meta_tables (
  id TEXT PRIMARY KEY,
  schema_id TEXT NOT NULL REFERENCES schemas(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  object_type TEXT NOT NULL DEFAULT 'table' CHECK(object_type IN ('table','view')),
  comment TEXT,
  raw_ddl TEXT,
  fingerprint TEXT NOT NULL,
  retired INTEGER NOT NULL DEFAULT 0 CHECK(retired IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(schema_id, name)
);
CREATE TABLE IF NOT EXISTS meta_columns (
  id TEXT PRIMARY KEY,
  table_id TEXT NOT NULL REFERENCES meta_tables(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  raw_type TEXT NOT NULL,
  normalized_type TEXT NOT NULL,
  nullable INTEGER NOT NULL CHECK(nullable IN (0,1)),
  default_value TEXT,
  comment TEXT,
  primary_key_ordinal INTEGER,
  UNIQUE(table_id, name), UNIQUE(table_id, ordinal)
);
CREATE TABLE IF NOT EXISTS table_relations (
  id TEXT PRIMARY KEY,
  source_table_id TEXT NOT NULL REFERENCES meta_tables(id) ON DELETE CASCADE,
  target_table_id TEXT NOT NULL REFERENCES meta_tables(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL DEFAULT 'many_to_one',
  origin TEXT NOT NULL CHECK(origin IN ('physical','inferred','manual')),
  confidence REAL,
  status TEXT NOT NULL CHECK(status IN ('candidate','confirmed','rejected')),
  evidence TEXT
);
CREATE TABLE IF NOT EXISTS quality_rules (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  rule_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK(severity IN ('info','warning','error')),
  config_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1))
);
CREATE TABLE IF NOT EXISTS rule_results (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL REFERENCES quality_rules(id),
  object_type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  severity TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  object_type TEXT,
  object_id TEXT,
  result TEXT NOT NULL,
  context_json TEXT NOT NULL DEFAULT '{}',
  occurred_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS relation_columns (relation_id TEXT NOT NULL REFERENCES table_relations(id) ON DELETE CASCADE,source_column_id TEXT NOT NULL REFERENCES meta_columns(id) ON DELETE CASCADE,target_column_id TEXT NOT NULL REFERENCES meta_columns(id) ON DELETE CASCADE,ordinal INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(relation_id,source_column_id,target_column_id));
CREATE TABLE IF NOT EXISTS meta_indexes (id TEXT PRIMARY KEY,table_id TEXT NOT NULL REFERENCES meta_tables(id) ON DELETE CASCADE,name TEXT NOT NULL,unique_flag INTEGER NOT NULL DEFAULT 0 CHECK(unique_flag IN (0,1)),origin TEXT NOT NULL DEFAULT 'created',columns_json TEXT NOT NULL DEFAULT '[]',raw_ddl TEXT,UNIQUE(table_id,name));
CREATE TABLE IF NOT EXISTS tags (id TEXT PRIMARY KEY,name TEXT NOT NULL COLLATE NOCASE UNIQUE,color TEXT);
CREATE TABLE IF NOT EXISTS object_tags (object_type TEXT NOT NULL,object_id TEXT NOT NULL,tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,PRIMARY KEY(object_type,object_id,tag_id));
CREATE TABLE IF NOT EXISTS saved_queries (id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id) ON DELETE CASCADE,name TEXT NOT NULL,query_text TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(user_id,name));
CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY,value_json TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS scan_jobs (id TEXT PRIMARY KEY,data_source_id TEXT NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,status TEXT NOT NULL,summary_json TEXT NOT NULL DEFAULT '{}',started_at TEXT NOT NULL,finished_at TEXT);
CREATE TABLE IF NOT EXISTS rule_runs (id TEXT PRIMARY KEY,status TEXT NOT NULL,summary_json TEXT NOT NULL DEFAULT '{}',started_at TEXT NOT NULL,finished_at TEXT);
CREATE VIRTUAL TABLE IF NOT EXISTS metadata_fts USING fts5(object_id UNINDEXED, object_type UNINDEXED, name, path, comment);
`;

const MIGRATION_V4 = `
CREATE TABLE IF NOT EXISTS export_jobs (id TEXT PRIMARY KEY,status TEXT NOT NULL,request_json TEXT NOT NULL DEFAULT '{}',summary_json TEXT NOT NULL DEFAULT '{}',started_at TEXT NOT NULL,finished_at TEXT);
CREATE INDEX IF NOT EXISTS idx_meta_tables_schema_retired_name ON meta_tables(schema_id,retired,name);
CREATE INDEX IF NOT EXISTS idx_meta_columns_table_ordinal ON meta_columns(table_id,ordinal);
CREATE INDEX IF NOT EXISTS idx_relations_source_status ON table_relations(source_table_id,status);
CREATE INDEX IF NOT EXISTS idx_relations_target_status ON table_relations(target_table_id,status);
CREATE INDEX IF NOT EXISTS idx_rule_results_rule_created ON rule_results(rule_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rule_results_severity_created ON rule_results(severity,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_occurred ON audit_logs(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_result_occurred ON audit_logs(result,occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_occurred ON audit_logs(actor_user_id,occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_scan_jobs_source_status ON scan_jobs(data_source_id,status,started_at DESC);
CREATE INDEX IF NOT EXISTS idx_rule_runs_status_started ON rule_runs(status,started_at DESC);
CREATE INDEX IF NOT EXISTS idx_export_jobs_status_started ON export_jobs(status,started_at DESC);
`;

const MIGRATION_V5 = `
ALTER TABLE users ADD COLUMN failed_login_count INTEGER NOT NULL DEFAULT 0 CHECK(failed_login_count >= 0);
ALTER TABLE users ADD COLUMN locked_until TEXT;
CREATE INDEX IF NOT EXISTS idx_users_locked_until ON users(locked_until);
`;

const MIGRATION_V6 = `
ALTER TABLE data_sources ADD COLUMN last_error TEXT;
CREATE INDEX IF NOT EXISTS idx_data_sources_status ON data_sources(status);
`;
const MIGRATION_V7 = `
ALTER TABLE rule_results ADD COLUMN status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved','ignored'));
ALTER TABLE rule_results ADD COLUMN resolution_note TEXT;
ALTER TABLE rule_results ADD COLUMN resolved_at TEXT;
ALTER TABLE rule_results ADD COLUMN resolved_by TEXT REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_rule_results_status_created ON rule_results(status,created_at DESC);
`;
const MIGRATION_V8 = `
ALTER TABLE rule_results ADD COLUMN run_id TEXT REFERENCES rule_runs(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_rule_results_run_created ON rule_results(run_id,created_at DESC);
`;
const MIGRATION_V9 = `
ALTER TABLE users ADD COLUMN gender TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN contact TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN email TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN notes TEXT NOT NULL DEFAULT '';
`;
export const CURRENT_SCHEMA_VERSION = 9;

export class MetadataDatabase {
  readonly db: DatabaseSync;

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    try {
      this.db.exec("PRAGMA foreign_keys = ON");
      this.db.exec("PRAGMA journal_mode = WAL");
      this.db.exec("PRAGMA synchronous = NORMAL");
      this.db.exec("PRAGMA busy_timeout = 5000");
      const quickCheck = this.db.prepare("PRAGMA quick_check").get() as
        { quick_check: string } | undefined;
      if (quickCheck?.quick_check !== "ok")
        throw new Error(
          `Database integrity check failed: ${quickCheck?.quick_check ?? "no result"}`,
        );
      this.db.exec(MIGRATION);
      const exists = this.db
        .prepare("SELECT 1 FROM schema_migrations WHERE version = 1")
        .get();
      if (!exists)
        this.db
          .prepare("INSERT INTO schema_migrations VALUES (?, ?, ?)")
          .run(1, "bootstrap-v1", new Date().toISOString());
      this.db
        .prepare(
          "INSERT OR IGNORE INTO schema_migrations VALUES(2,'governance-v2',?)",
        )
        .run(new Date().toISOString());
      this.db
        .prepare(
          "INSERT OR IGNORE INTO schema_migrations VALUES(3,'indexes-v3',?)",
        )
        .run(new Date().toISOString());
      this.validateHistoricalMigration(1, "bootstrap-v1");
      this.validateHistoricalMigration(2, "governance-v2");
      this.validateHistoricalMigration(3, "indexes-v3");
      this.applyMigration(4, "lifecycle-v4", MIGRATION_V4);
      this.applyMigration(5, "authentication-v5", MIGRATION_V5);
      this.applyMigration(6, "source-status-v6", MIGRATION_V6);
      this.applyMigration(7, "quality-resolution-v7", MIGRATION_V7);
      this.applyMigration(8, "quality-result-history-v8", MIGRATION_V8);
      this.applyMigration(9, "user-profile-v9", MIGRATION_V9);
      this.seedRules();
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  private validateHistoricalMigration(version: number, checksum: string) {
    const row = this.db
      .prepare("SELECT checksum FROM schema_migrations WHERE version=?")
      .get(version) as { checksum: string } | undefined;
    if (!row || row.checksum !== checksum)
      throw new Error(`Schema migration ${version} checksum mismatch`);
  }

  private applyMigration(version: number, name: string, sql: string) {
    const checksum = `${name}:${createHash("sha256").update(sql).digest("hex")}`;
    const row = this.db
      .prepare("SELECT checksum FROM schema_migrations WHERE version=?")
      .get(version) as { checksum: string } | undefined;
    if (row) {
      if (row.checksum !== checksum)
        throw new Error(`Schema migration ${version} checksum mismatch`);
      return;
    }
    this.db.exec("BEGIN");
    try {
      this.db.exec(sql);
      this.db
        .prepare(
          "INSERT INTO schema_migrations(version,checksum,applied_at) VALUES(?,?,?)",
        )
        .run(version, checksum, new Date().toISOString());
      this.db
        .prepare(
          "INSERT OR IGNORE INTO app_settings(key,value_json,updated_at) VALUES('metadata.revision','0',?)",
        )
        .run(new Date().toISOString());
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private seedRules() {
    const rows: Array<[string, string, string, string]> = [
      [
        "table-primary-key",
        "Tables must define a primary key",
        "primary_key",
        "error",
      ],
      ["table-comment", "Tables must include a comment", "comment", "warning"],
      [
        "column-comment",
        "Columns must include a comment",
        "comment",
        "warning",
      ],
      ["column-type", "Column types must be normalizable", "type", "warning"],
      [
        "column-required",
        "Identifier fields must be required",
        "required",
        "warning",
      ],
      ["object-naming", "Object naming convention", "naming", "warning"],
      [
        "relation-integrity",
        "Relationship fields must be complete",
        "relation",
        "error",
      ],
    ];
    const insert = this.db.prepare(
      "INSERT OR IGNORE INTO quality_rules(id,code,name,rule_type,severity) VALUES(?,?,?,?,?)",
    );
    this.db.exec("BEGIN");
    try {
      rows.forEach((row) => insert.run(randomUUID(), ...row));
      const rename = this.db.prepare(
        "UPDATE quality_rules SET name = ? WHERE code = ?",
      );
      rows.forEach((row) => rename.run(row[1], row[0]));
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  initialized() {
    return Boolean(this.db.prepare("SELECT 1 FROM users LIMIT 1").get());
  }

  stats() {
    const count = (table: string) =>
      Number(
        (
          this.db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as {
            n: number;
          }
        ).n,
      );
    return {
      sources: count("data_sources"),
      tables: count("meta_tables"),
      columns: count("meta_columns"),
      relations: count("table_relations"),
      qualityIssues: count("rule_results"),
    };
  }

  search(query: string): SearchHitDto[] {
    const tokens = query
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((token) => `"${token.replace(/"/g, '""')}"*`);
    if (!tokens.length) return [];
    return this.db
      .prepare(
        "SELECT object_id AS id, object_type AS objectType, name, path, comment FROM metadata_fts WHERE metadata_fts MATCH ? ORDER BY rank LIMIT 50",
      )
      .all(tokens.join(" AND ")) as unknown as SearchHitDto[];
  }

  rebuildSearchIndex() {
    this.db.exec("BEGIN");
    try {
      this.db.exec("DELETE FROM metadata_fts");
      this.db.exec(`
        INSERT INTO metadata_fts(object_id,object_type,name,path,comment)
        SELECT table_object.id,'table',table_object.name,
          source.name || '/' || schema_object.name || '/' || table_object.name,
          TRIM(COALESCE(table_object.comment,'') || ' ' || COALESCE((SELECT GROUP_CONCAT(tag.name,' ') FROM object_tags assignment JOIN tags tag ON tag.id=assignment.tag_id WHERE assignment.object_type='table' AND assignment.object_id=table_object.id),''))
        FROM meta_tables table_object
        JOIN schemas schema_object ON schema_object.id=table_object.schema_id
        JOIN catalogs catalog ON catalog.id=schema_object.catalog_id
        JOIN data_sources source ON source.id=catalog.data_source_id;
        INSERT INTO metadata_fts(object_id,object_type,name,path,comment)
        SELECT column_object.id,'column',column_object.name,
          source.name || '/' || schema_object.name || '/' || table_object.name || '/' || column_object.name,
          TRIM(COALESCE(column_object.comment,'') || ' ' || COALESCE((SELECT GROUP_CONCAT(tag.name,' ') FROM object_tags assignment JOIN tags tag ON tag.id=assignment.tag_id WHERE assignment.object_type='column' AND assignment.object_id=column_object.id),''))
        FROM meta_columns column_object
        JOIN meta_tables table_object ON table_object.id=column_object.table_id
        JOIN schemas schema_object ON schema_object.id=table_object.schema_id
        JOIN catalogs catalog ON catalog.id=schema_object.catalog_id
        JOIN data_sources source ON source.id=catalog.data_source_id;
      `);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  close() {
    this.db.close();
  }
}
