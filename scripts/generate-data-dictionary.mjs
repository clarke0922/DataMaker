import fs from 'node:fs';
import path from 'node:path';

const input = process.argv[2];
const output = process.argv[3] ?? path.resolve('项目数据字典.md');
if (!input) throw new Error('用法: node scripts/generate-data-dictionary.mjs <meta.sql> [输出文件]');

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
  SYS: ['系统与权限', '用户、组织、岗位、角色、菜单、操作、日志及系统配置'],
  META: ['元数据管理', '元数据表、字段、分类、关系、分表、继承及变更记录'],
  POWER: ['数据权限', '岗位及模板的表、行、列级权限'],
  RULE: ['规则分析', '规则树、节点、规则元数据、运行日志及结果文件'],
  QUERY: ['查询统计', '查询条件、关联视图及统计对象'],
  JS: ['检索与索引', '索引任务、目录授权、文档索引及关键词统计'],
  COMPARE: ['数据比对', '库间、文件及 Excel 数据比对'],
  WEB: ['门户与即时通信', '栏目、文章、图片、导航和即时通信'],
  MSG: ['消息管理', '收发消息、联系人和附件'],
  BUSINESS: ['业务任务', '任务类型、任务分解、处理及反馈'],
  TABLE: ['导入与字段管理', '内部表识别任务和字段管理'],
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
  ['users', '本地用户', 'id, username, password_hash, display_name, status, created_at, updated_at'],
  ['roles / permissions', 'RBAC 角色与权限', '角色、权限及 user_roles、role_permissions 关联'],
  ['data_sources', '采集数据源', '类型、名称、配置引用、状态、最近采集时间'],
  ['scan_jobs', '采集任务', '任务状态、进度、差异摘要、错误信息'],
  ['catalogs / schemas', '数据目录层级', '数据源下的 catalog 与 schema'],
  ['meta_tables / meta_columns', '核心元数据', '表、视图、字段、类型、约束、原始 DDL'],
  ['table_relations / relation_columns', '表关系', '物理/推断/人工关系、置信度及字段映射'],
  ['tags / object_tags', '标签', '元数据对象的分类与检索标签'],
  ['quality_rules', '质量规则', '规则类型、配置、严重级别和启用状态'],
  ['rule_runs / rule_results', '规则执行', '运行状态、统计结果及逐项问题'],
  ['saved_queries', '保存的查询', '用户检索条件和展示配置'],
  ['audit_logs', '审计日志', '用户、动作、对象、结果、时间和上下文'],
  ['app_settings', '应用设置', '非敏感应用配置；密钥保存至系统密钥链'],
  ['schema_migrations', '模式版本', 'SQLite 数据库迁移版本和校验信息'],
];

let out = `# 项目数据字典\n\n`;
out += `> 生成依据：\`${path.basename(input)}\`。本文区分 **SQL 事实**、**设计推断** 与 **目标态设计**。旧库未声明外键，任何跨表关系均不能视为数据库已实施约束。\n\n`;
out += `## 1. 数据概览\n\n| 指标 | 数量 |\n|---|---:|\n| 旧库表 | ${tables.length} |\n| 字段 | ${columnCount} |\n| 有主键的表 | ${tables.filter(t => t.pk.length).length} |\n| 无主键的表 | ${tables.filter(t => !t.pk.length).length} |\n| 唯一约束 | ${[...unique.values()].reduce((n, x) => n + x.length, 0)} |\n| 显式外键 | 0 |\n\n`;
out += `## 2. 目标态 SQLite 核心模型\n\n> **目标态设计**：以下为新桌面应用的规范化模型分组，具体建表 DDL 在实施阶段通过 Drizzle migration 固化。\n\n| 表/表组 | 用途 | 核心内容 |\n|---|---|---|\n`;
for (const row of newSchema) out += `| ${row.map(esc).join(' | ')} |\n`;
out += `\n### 2.1 通用约束\n\n- 主键统一为 UUID 文本；时间统一保存 UTC ISO-8601。\n- 启用 \`PRAGMA foreign_keys = ON\`、WAL 和事务；布尔字段使用带 CHECK 的 0/1。\n- FTS5 索引表名、字段名、注释和标签；FTS 索引由事务内同步逻辑维护。\n- 外部数据源密钥仅保存系统密钥链引用，不保存明文。\n- 原始类型、默认值和 DDL单独保留，标准化结果不可覆盖原始证据。\n\n`;
out += `## 3. 旧库模块清单\n\n| 前缀 | 模块 | 表数 | 字段数 | 说明 |\n|---|---|---:|---:|---|\n`;
for (const [prefix, list] of grouped) {
  const info = moduleInfo[prefix] ?? ['其他', '未归类旧表'];
  out += `| ${prefix} | ${info[0]} | ${list.length} | ${list.reduce((n, t) => n + t.columns.length, 0)} | ${info[1]} |\n`;
}
out += `\n## 4. 旧库逐表字段字典\n\n`;
for (const [prefix, list] of grouped) {
  const info = moduleInfo[prefix] ?? ['其他', '未归类旧表'];
  out += `### 4.${[...grouped.keys()].indexOf(prefix) + 1} ${info[0]}（${prefix}）\n\n`;
  for (const table of list) {
    out += `#### ${table.name}\n\n`;
    out += `- 表说明：${table.comment || 'SQL 未提供表注释'}\n`;
    out += `- 主键：${table.pk.length ? table.pk.map(x => `\`${x}\``).join(' + ') : '**无主键**'}\n`;
    out += `- 唯一约束：${table.unique.length ? table.unique.map(x => `${x.name}(${x.columns.join(', ')})`).join('；') : '无'}\n`;
    out += `- 迁移建议：${prefix === 'META' ? '映射至目标态核心元数据模型' : prefix === 'SYS' ? '仅迁移本地 RBAC 所需账号、角色和权限语义' : prefix === 'RULE' ? '仅迁移可转换的元数据质量规则' : '首期作为历史数据分析依据，按需迁移'}\n\n`;
    out += `| 字段 | 类型 | 可空 | 默认值 | 主键 | 注释 |\n|---|---|:---:|---|:---:|---|\n`;
    for (const col of table.columns) out += `| ${esc(col.name)} | ${esc(col.type)} | ${col.nullable ? '是' : '否'} | ${esc(col.defaultValue) || '-'} | ${table.pk.includes(col.name) ? '是' : ''} | ${esc(col.comment) || '-'} |\n`;
    out += `\n`;
  }
}
out += `## 5. 旧新模型映射原则\n\n| 旧模块 | 首期处理 | 目标态去向 |\n|---|---|---|\n| META_* | 选择性迁移 | catalogs、schemas、meta_tables、meta_columns、relations、tags |\n| SYS_* | 语义迁移 | users、roles、permissions 及关联表；密码不得原样迁移 |\n| RULE_* | 转换迁移 | 可表达为质量检查的规则进入 quality_rules，其余形成未迁移报告 |\n| QUERY_* | 按需迁移 | 可转换的个人查询进入 saved_queries |\n| POWER_* | 不直接迁移 | 首期仅保留功能权限；复杂行列权限列入后续版本 |\n| JS_* | 不直接迁移 | 由 SQLite FTS5 与新采集任务替代 |\n| COMPARE_* | 暂不迁移 | 后续数据比对模块扩展 |\n| WEB_* / MSG_* / BUSINESS_* | 暂不迁移 | 不属于首期元数据核心闭环 |\n\n`;
out += `## 6. 数据质量与结构风险\n\n- 旧库无显式外键，引用完整性只能通过同名 ID、注释和种子数据推断。\n- 个别表缺少主键，导入时必须生成稳定对象标识并记录来源行定位。\n- 类型混用 \`DEC\`、\`NUMBER\`、\`INT\`、\`INTEGER\`、\`CLOB\`、\`BLOB\`，必须同时保存原始类型和标准化类型。\n- 大量状态字段使用字符串或整数但缺少 CHECK 约束，迁移前需从种子数据归纳枚举并人工确认。\n- 旧表命名存在大小写和拼写不一致，解析及映射必须大小写不敏感，展示时保留原名。\n- 初始化数据可能包含账号、组织及业务信息；导入报告默认只输出统计，不复制敏感值。\n`;

fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
fs.writeFileSync(output, out, 'utf8');
console.log(JSON.stringify({ output: path.resolve(output), tables: tables.length, columns: columnCount }, null, 2));
