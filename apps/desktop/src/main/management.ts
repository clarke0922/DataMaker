import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { SQLInputValue } from 'node:sqlite';
import type { ManagementModule, ManagementRecordDto, SaveManagementRecordInput } from '@datamaker/contracts';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS column_weights (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, score INTEGER NOT NULL CHECK(score BETWEEN 0 AND 100), display_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS dictionary_items (
  id TEXT PRIMARY KEY, code TEXT NOT NULL, description TEXT NOT NULL, parent_id TEXT REFERENCES dictionary_items(id) ON DELETE SET NULL,
  path TEXT NOT NULL DEFAULT '', display_order INTEGER NOT NULL DEFAULT 0, UNIQUE(parent_id, code)
);
CREATE TABLE IF NOT EXISTS metadata_factors (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT, owner TEXT, created_at TEXT NOT NULL
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

type Config = { table: string; columns: string[]; required: string[]; order: string; fixed?: Record<string, unknown> };
const configs: Record<ManagementModule, Config> = {
  weights: { table: 'column_weights', columns: ['name', 'score', 'display_order'], required: ['name', 'score'], order: 'display_order, name' },
  dictionaries: { table: 'dictionary_items', columns: ['code', 'description', 'parent_id', 'path', 'display_order'], required: ['code', 'description'], order: 'display_order, code' },
  dictionaryTree: { table: 'dictionary_items', columns: ['code', 'description', 'parent_id', 'path', 'display_order'], required: ['code', 'description'], order: 'path, display_order, code' },
  factors: { table: 'metadata_factors', columns: ['name', 'description', 'owner', 'created_at'], required: ['name'], order: 'name' },
  imports: { table: 'import_jobs', columns: ['source_name', 'source_type', 'target_name', 'status', 'imported_rows', 'error_message', 'created_at'], required: ['source_name', 'source_type'], order: 'created_at DESC' },
  tables: { table: 'managed_data_tables', columns: ['name', 'display_name', 'category_id', 'table_type', 'is_tree', 'is_internal', 'is_public', 'owner', 'row_count', 'is_search_indexed', 'description', 'created_at', 'updated_at'], required: ['name', 'display_name'], order: 'display_name' },
  privateTables: { table: 'managed_data_tables', columns: ['name', 'display_name', 'category_id', 'table_type', 'is_tree', 'is_internal', 'is_public', 'owner', 'row_count', 'is_search_indexed', 'description', 'created_at', 'updated_at'], required: ['name', 'display_name'], order: 'display_name', fixed: { is_public: 0 } },
  dailyCounts: { table: 'daily_table_counts', columns: ['table_id', 'table_name', 'daily_increase', 'total_count', 'stat_date'], required: ['table_name', 'stat_date'], order: 'stat_date DESC, table_name' },
  cubes: { table: 'data_cubes', columns: ['name', 'description', 'definition_json', 'created_at', 'updated_at'], required: ['name'], order: 'name' },
  categories: { table: 'table_categories', columns: ['name', 'parent_id', 'level_path', 'display_order', 'created_at'], required: ['name'], order: 'level_path, display_order, name' }
};

export class MetadataManagementRepository {
  constructor(private readonly db: DatabaseSync) {
    db.exec(SCHEMA);
    this.seed();
  }

  private seed() {
    const insert = this.db.prepare('INSERT OR IGNORE INTO column_weights(id,name,score,display_order) VALUES(?,?,?,?)');
    insert.run(randomUUID(), '必填', 80, 1);
    insert.run(randomUUID(), '重要', 50, 2);
    insert.run(randomUUID(), '一般', 20, 3);
  }

  list(module: ManagementModule): ManagementRecordDto[] {
    const config = configs[module];
    const where = config.fixed ? ` WHERE ${Object.keys(config.fixed).map(key => `${key} = ?`).join(' AND ')}` : '';
    const values = config.fixed ? Object.values(config.fixed) as SQLInputValue[] : [];
    return this.db.prepare(`SELECT * FROM ${config.table}${where} ORDER BY ${config.order}`).all(...values) as unknown as ManagementRecordDto[];
  }

  save(module: ManagementModule, input: SaveManagementRecordInput): ManagementRecordDto {
    const config = configs[module];
    const now = new Date().toISOString();
    const values: Record<string, unknown> = { ...input.values, ...config.fixed };
    if (config.columns.includes('created_at') && !values.created_at) values.created_at = now;
    if (config.columns.includes('updated_at')) values.updated_at = now;
    if (module === 'imports' && !values.status) values.status = 'pending';
    if (module === 'cubes' && !values.definition_json) values.definition_json = '{}';
    for (const field of config.required) {
      if (values[field] === undefined || values[field] === null || values[field] === '') throw new Error(`字段 ${field} 不能为空`);
    }
    const selected = config.columns.filter(column => values[column] !== undefined);
    const id = input.id ?? randomUUID();
    if (input.id) {
      if (!this.db.prepare(`SELECT 1 FROM ${config.table} WHERE id = ?`).get(id)) throw new Error('记录不存在');
      this.db.prepare(`UPDATE ${config.table} SET ${selected.map(column => `${column} = ?`).join(', ')} WHERE id = ?`).run(...selected.map(column => values[column] as never), id);
    } else {
      this.db.prepare(`INSERT INTO ${config.table}(id,${selected.join(',')}) VALUES(?${selected.map(() => ',?').join('')})`).run(id, ...selected.map(column => values[column] as never));
    }
    if (module === 'imports' && !input.id) this.executeImport(id, values);
    return this.db.prepare(`SELECT * FROM ${config.table} WHERE id = ?`).get(id) as unknown as ManagementRecordDto;
  }

  private executeImport(jobId: string, values: Record<string, unknown>) {
    const file = String(values.source_name ?? '');
    const type = String(values.source_type ?? '');
    this.db.prepare("UPDATE import_jobs SET status = 'running' WHERE id = ?").run(jobId);
    try {
      let tableNames: string[] = [];
      if (type === 'sql') {
        const bytes = fs.readFileSync(file);
        let text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
        if (text.includes('\uFFFD')) text = new TextDecoder('gbk').decode(bytes);
        tableNames = [...text.matchAll(/CREATE\s+TABLE\s+(?:(?:"[^"]+"|[\w\u4e00-\u9fa5]+)\.)?["`\[]?([\w\u4e00-\u9fa5]+)["`\]]?/gi)].map(match => match[1]!).filter(Boolean);
      } else if (type === 'sqlite') {
        const source = new DatabaseSync(file, { readOnly: true });
        tableNames = (source.prepare("SELECT name FROM sqlite_schema WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>).map(row => row.name);
        source.close();
      } else {
        throw new Error('Excel 数据行导入将在下一迭代提供；当前请使用 SQL 或 SQLite 文件');
      }
      const now = new Date().toISOString();
      const insert = this.db.prepare(`INSERT OR IGNORE INTO managed_data_tables(
        id,name,display_name,table_type,is_tree,is_internal,is_public,row_count,is_search_indexed,description,created_at,updated_at
      ) VALUES(?,?,?,?,0,0,1,0,0,?,?,?)`);
      this.db.exec('BEGIN');
      try {
        for (const name of [...new Set(tableNames)]) insert.run(randomUUID(), name, name, 'imported', `由外部${type.toUpperCase()}导入`, now, now);
        this.db.prepare("UPDATE import_jobs SET status = 'completed', imported_rows = ?, error_message = NULL WHERE id = ?").run(new Set(tableNames).size, jobId);
        this.db.exec('COMMIT');
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
    } catch (error) {
      this.db.prepare("UPDATE import_jobs SET status = 'failed', error_message = ? WHERE id = ?").run(error instanceof Error ? error.message : '导入失败', jobId);
    }
  }

  remove(module: ManagementModule, id: string) {
    const config = configs[module];
    const result = this.db.prepare(`DELETE FROM ${config.table} WHERE id = ?`).run(id);
    if (!result.changes) throw new Error('记录不存在');
  }
}
