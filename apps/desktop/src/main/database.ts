import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type { SearchHitDto } from '@datamaker/contracts';

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
CREATE VIRTUAL TABLE IF NOT EXISTS metadata_fts USING fts5(object_id UNINDEXED, object_type UNINDEXED, name, path, comment);
`;

export class MetadataDatabase {
  readonly db: DatabaseSync;

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA synchronous = NORMAL');
    this.db.exec('PRAGMA busy_timeout = 5000');
    this.db.exec(MIGRATION);
    const exists = this.db.prepare('SELECT 1 FROM schema_migrations WHERE version = 1').get();
    if (!exists) this.db.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(1, 'bootstrap-v1', new Date().toISOString());
    this.seedRules();
  }

  private seedRules() {
    const rows = [
      ['table-primary-key', '表必须定义主键', 'primary_key', 'error'],
      ['table-comment', '表必须填写注释', 'comment', 'warning'],
      ['column-comment', '字段必须填写注释', 'comment', 'warning'],
      ['column-type', '字段类型应可标准化', 'type', 'warning'],
      ['object-naming', '对象命名规范', 'naming', 'warning'],
      ['relation-integrity', '关系字段必须完整', 'relation', 'error']
    ];
    const insert = this.db.prepare('INSERT OR IGNORE INTO quality_rules(id,code,name,rule_type,severity) VALUES(?,?,?,?,?)');
    this.db.exec('BEGIN');
    try {
      rows.forEach(row => insert.run(randomUUID(), ...row));
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  initialized() { return Boolean(this.db.prepare('SELECT 1 FROM users LIMIT 1').get()); }

  stats() {
    const count = (table: string) => Number((this.db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n);
    return { sources: count('data_sources'), tables: count('meta_tables'), columns: count('meta_columns'), relations: count('table_relations'), qualityIssues: count('rule_results') };
  }

  search(query: string): SearchHitDto[] {
    if (!query.trim()) return [];
    return this.db.prepare('SELECT object_id AS id, object_type AS objectType, name, path, comment FROM metadata_fts WHERE metadata_fts MATCH ? ORDER BY rank LIMIT 50').all(`${query.replace(/["']/g, '')}*`) as unknown as SearchHitDto[];
  }

  close() { this.db.close(); }
}
