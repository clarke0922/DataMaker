import fs from 'node:fs';
import path from 'node:path';

const input = process.argv[2];
const output = process.argv[3] ?? path.resolve('project-data-dictionary.md');
if (!input) throw new Error('Usage: node scripts/generate-data-dictionary.mjs <meta.sql> [output file]');

const sql = fs.readFileSync(input, 'utf8').replace(/^\uFEFF/, '');
const tableComment = new Map();
const columnComment = new Map();
for (const m of sql.matchAll(/COMMENT\s+ON\s+TABLE\s+"[^"]+"\."([^"]+)"\s+IS\s+'([^']*)'\s*;/gi)) tableComment.set(m[1], m[2]);
for (const m of sql.matchAll(/COMMENT\s+ON\s+COLUMN\s+"[^"]+"\."([^"]+)"\."([^"]+)"\s+IS\s+'([^']*)'\s*;/gi)) columnComment.set(`${m[1]}.${m[2]}`, m[3]);

const pk = new Map();
const unique = new Map();
for (const m of sql.matchAll(/ALTER\s+TABLE\s+"[^"]+"\."([^"]+)"\s+ADD\s+CONSTRAINT(?:\s+"[^"]+")?\s+PRIMARY\s+KEY\s*\(([^)]+)\)/gi)) {
  pk.set(m[1], [...m[2].matchAll(/"([^"]+)"/g)].map(x => x[1]));
}
for (const m of sql.matchAll(/ALTER\s+TABLE\s+"[^"]+"\."([^"]+)"\s+ADD\s+CONSTRAINT\s+"([^"]+)"\s+UNIQUE\s*\(([^)]+)\)/gi)) {
  const list = unique.get(m[1]) ?? [];
  list.push({ name: m[2], columns: [...m[3].matchAll(/"([^"]+)"/g)].map(x => x[1]) });
  unique.set(m[1], list);
}

function splitColumns(body) {
  const lines = body.split(/\r?\n/);
  const chunks = [];
  let current = '';
  let depth = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    current += `${current ? ' ' : ''}${trimmed}`;
    depth += (trimmed.match(/\(/g) ?? []).length - (trimmed.match(/\)/g) ?? []).length;
    if (depth === 0 && /,$/.test(trimmed)) {
      chunks.push(current.replace(/,$/, ''));
      current = '';
    }
  }
  if (current) chunks.push(current.replace(/,$/, ''));
  return chunks;
}

const tables = [];
for (const m of sql.matchAll(/CREATE\s+TABLE\s+"([^"]+)"\."([^"]+)"\s*\(([\s\S]*?)\)\s*;/gi)) {
  const [, schema, name, body] = m;
  const columns = [];
  for (const chunk of splitColumns(body)) {
    const cm = chunk.match(/^"([^"]+)"\s+([A-Z]+(?:\s*\([^)]*\))?)([\s\S]*)$/i);
    if (!cm) continue;
    const [, column, type, rest] = cm;
    const defaultMatch = rest.match(/\bDEFAULT\s+(.+?)(?=\s+(?:NOT\s+NULL|NULL)\b|$)/i);
    columns.push({
      name: column,
      type: type.replace(/\s+/g, ' ').trim(),
      nullable: !/\bNOT\s+NULL\b/i.test(rest),
      defaultValue: defaultMatch ? defaultMatch[1].trim() : '',
      comment: columnComment.get(`${name}.${column}`) ?? '',
    });
  }
  tables.push({ schema, name, comment: tableComment.get(name) ?? '', columns, pk: pk.get(name) ?? [], unique: unique.get(name) ?? [] });
}

const moduleInfo = {
  SYS: ['System and Access Control', 'Users, organizations, jobs, roles, menus, actions, logs, and system settings'],
  META: ['Metadata Management', 'Tables, columns, categories, relationships, partitions, inheritance, and change logs'],
  POWER: ['Data Permissions', 'Job and template permissions at table, row, and column levels'],
  RULE: ['Rule Analysis', 'Rule trees, nodes, rule metadata, execution logs, and result files'],
  QUERY: ['Query and Statistics', 'Query conditions, related views, and statistical objects'],
  JS: ['Search and Indexing', 'Index jobs, directory permissions, document indexes, and keyword statistics'],
  COMPARE: ['Data Comparison', 'Database, file, and Excel comparison'],
  WEB: ['Portal and Messaging', 'Categories, articles, images, navigation, and instant messaging'],
  MSG: ['Message Management', 'Messages, contacts, recipients, and attachments'],
  BUSINESS: ['Business Tasks', 'Task types, decomposition, processing, and feedback'],
  TABLE: ['Import and Column Management', 'Internal table identification and column management'],
};
const prefixOf = name => (name.match(/^([^_]+)_/)?.[1] ?? 'OTHER').toUpperCase();
const grouped = new Map();
for (const table of tables) {
  const prefix = prefixOf(table.name);
  if (!grouped.has(prefix)) grouped.set(prefix, []);
  grouped.get(prefix).push(table);
}
const columnCount = tables.reduce((n, t) => n + t.columns.length, 0);
const esc = value => String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br/>');

const newSchema = [
  ['users', 'Local users', 'id, username, password_hash, display_name, status, created_at, updated_at'],
  ['roles / permissions', 'RBAC roles and permissions', 'Roles, permissions, user_roles, and role_permissions'],
  ['data_sources', 'Metadata sources', 'Type, name, configuration reference, status, and last scan time'],
  ['scan_jobs', 'Scan jobs', 'Status, progress, difference summary, and error information'],
  ['catalogs / schemas', 'Catalog hierarchy', 'Catalogs and schemas under each data source'],
  ['meta_tables / meta_columns', 'Core metadata', 'Tables, views, columns, types, constraints, and raw DDL'],
  ['table_relations / relation_columns', 'Table relationships', 'Physical, inferred, and manual relationships with confidence and mappings'],
  ['tags / object_tags', 'Tags', 'Classification and search tags for metadata objects'],
  ['quality_rules', 'Quality rules', 'Rule type, configuration, severity, and enabled state'],
  ['rule_runs / rule_results', 'Rule execution', 'Run state, statistics, and individual findings'],
  ['saved_queries', 'Saved queries', 'User search conditions and presentation settings'],
  ['audit_logs', 'Audit logs', 'Actor, action, object, result, time, and context'],
  ['app_settings', 'Application settings', 'Non-sensitive settings; secrets remain in the operating-system keychain'],
  ['schema_migrations', 'Schema versions', 'SQLite migration versions and checksums'],
];

let out = `# Project Data Dictionary\n\n`;
out += `> Generated from \`${path.basename(input)}\`. This document distinguishes **SQL facts**, **design inferences**, and **target-state design**. The legacy schema declares no foreign keys; inferred relationships are not implemented database constraints.\n\n`;
out += `## 1. Data Overview\n\n| Metric | Count |\n|---|---:|\n| Legacy tables | ${tables.length} |\n| Columns | ${columnCount} |\n| Tables with primary keys | ${tables.filter(t => t.pk.length).length} |\n| Tables without primary keys | ${tables.filter(t => !t.pk.length).length} |\n| Unique constraints | ${[...unique.values()].reduce((n, x) => n + x.length, 0)} |\n| Explicit foreign keys | 0 |\n\n`;
out += `## 2. Target SQLite Core Model\n\n> **Target-state design:** the following normalized model groups are implemented through versioned SQLite migrations.\n\n| Table or group | Purpose | Core content |\n|---|---|---|\n`;
for (const row of newSchema) out += `| ${row.map(esc).join(' | ')} |\n`;
out += `\n### 2.1 Common Constraints\n\n- Primary keys use UUID text; timestamps use UTC ISO-8601.\n- Enable \`PRAGMA foreign_keys = ON\`, WAL, and transactions; booleans use CHECK-constrained 0/1 integers.\n- FTS5 indexes table names, column names, comments, and tags within the same write transaction.\n- Store external source secrets in the operating-system keychain, never as plaintext database values.\n- Preserve raw types, defaults, and DDL separately from normalized values.\n\n`;
out += `## 3. Legacy Module Inventory\n\n| Prefix | Module | Tables | Columns | Description |\n|---|---|---:|---:|---|\n`;
for (const [prefix, list] of grouped) {
  const info = moduleInfo[prefix] ?? ['Other', 'Unclassified legacy tables'];
  out += `| ${prefix} | ${info[0]} | ${list.length} | ${list.reduce((n, t) => n + t.columns.length, 0)} | ${info[1]} |\n`;
}
out += `\n## 4. Legacy Table and Column Dictionary\n\n`;
for (const [prefix, list] of grouped) {
  const info = moduleInfo[prefix] ?? ['Other', 'Unclassified legacy tables'];
  out += `### 4.${[...grouped.keys()].indexOf(prefix) + 1} ${info[0]}（${prefix}）\n\n`;
  for (const table of list) {
    out += `#### ${table.name}\n\n`;
    out += `- Description: ${table.comment || 'No table comment in SQL'}\n`;
    out += `- Primary key: ${table.pk.length ? table.pk.map(x => `\`${x}\``).join(' + ') : '**None**'}\n`;
    out += `- Unique constraints: ${table.unique.length ? table.unique.map(x => `${x.name}(${x.columns.join(', ')})`).join('; ') : 'None'}\n`;
    out += `- Migration guidance: ${prefix === 'META' ? 'Map into the target core metadata model' : prefix === 'SYS' ? 'Migrate only local RBAC identity, role, and permission semantics' : prefix === 'RULE' ? 'Migrate only rules that map to metadata quality checks' : 'Retain as legacy analysis and migrate only when required'}\n\n`;
    out += `| Column | Type | Nullable | Default | Primary key | Comment |\n|---|---|:---:|---|:---:|---|\n`;
    for (const col of table.columns) out += `| ${esc(col.name)} | ${esc(col.type)} | ${col.nullable ? 'Yes' : 'No'} | ${esc(col.defaultValue) || '-'} | ${table.pk.includes(col.name) ? 'Yes' : ''} | ${esc(col.comment) || '-'} |\n`;
    out += `\n`;
  }
}
out += `## 5. Legacy-to-Target Mapping\n\n| Legacy module | Initial handling | Target |\n|---|---|---|\n| META_* | Selective migration | catalogs, schemas, meta_tables, meta_columns, relations, and tags |\n| SYS_* | Semantic migration | users, roles, permissions, and join tables; never reuse legacy password hashes |\n| RULE_* | Transform | Convertible metadata quality rules only; report unsupported rules |\n| QUERY_* | On demand | Convertible personal filters become saved_queries |\n| POWER_* | Do not migrate directly | Initial release uses functional permissions; row and column permissions are deferred |\n| JS_* | Replace | SQLite FTS5 and new scan jobs |\n| COMPARE_* | Deferred | Future data comparison module |\n| WEB_* / MSG_* / BUSINESS_* | Deferred | Outside the initial metadata-management scope |\n\n`;
out += `## 6. Data Quality and Structural Risks\n\n- The legacy schema has no explicit foreign keys; relationships are inferred from matching IDs, comments, and seed data.\n- Some tables lack primary keys; imports must create stable object identifiers and preserve source-row location.\n- Mixed \`DEC\`, \`NUMBER\`, \`INT\`, \`INTEGER\`, \`CLOB\`, and \`BLOB\` types require both raw and normalized representations.\n- Many status columns use unconstrained strings or integers; derive candidate enums from seed data and require review.\n- Legacy naming has case and spelling inconsistencies; parsing must be case-insensitive while display preserves original names.\n- Seed data may contain identities, organizations, and business information; reports should contain counts rather than sensitive values.\n`;

fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
fs.writeFileSync(output, out, 'utf8');
console.log(JSON.stringify({ output: path.resolve(output), tables: tables.length, columns: columnCount }, null, 2));
