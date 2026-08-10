import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

export type Locale = 'en-US' | 'zh-CN';
type Params = Record<string, string | number>;

const zh: Record<string, string> = {
  'Dashboard': '工作台', 'Metadata Management': '元数据管理', 'Weight Scores': '权重分数表',
  'Dictionary Data': '字典数据', 'Tree Dictionary': '树形字典数据', 'Factors': '要素表',
  'External Import': '外部数据导入', 'Data Tables': '数据表', 'Private Tables': '私有数据表',
  'Daily Counts': '每日增量总数', 'Data Cubes': '数据立方', 'Table Categories': '表分类',
  'Quality Center': '质量中心', 'System Management': '系统管理', 'Metadata Workspace': '元数据工作台',
  'Local mode': '本地模式', 'English': 'English', 'Chinese': '中文', 'Language': '语言',
  'Unable to connect to the main process service': '无法连接主进程服务',
  'The administrator account has not been initialized': '系统尚未初始化管理员账户',
  'Administrator initialization will be completed in System Management.': '管理员初始化将在系统管理模块完成。',
  'Data Sources': '数据源', 'Fields': '字段', 'Relations': '关系', 'Quality Issues': '质量问题',
  'Global Search': '全局搜索', 'Search': '搜索', 'Search tables, fields, comments, or tags': '搜索表、字段、注释或标签',
  'Type': '类型', 'Table': '表', 'Field': '字段', 'Name': '名称', 'Path': '路径', 'Comment': '注释',
  'Weight Score Management': '权重分数表管理', 'Maintain field importance levels and scores.': '维护字段重要程度及对应分值。',
  'Weight Name': '权重名称', 'Weight Score': '权重分值', 'Order': '排序',
  'Dictionary Data Management': '字典数据管理', 'Maintain codes, descriptions, and order in a list.': '以列表方式维护编码、含义和排序。',
  'Dictionary Code': '字典编码', 'Dictionary Description': '字典含义', 'Parent Dictionary': '上级字典',
  'Tree Dictionary Management': '树形字典数据管理', 'Maintain hierarchical dictionary data using parent-child relationships.': '按父子关系维护层级字典数据。',
  'Node Code': '节点编码', 'Node Name': '节点名称', 'Parent Node': '父节点', 'Hierarchy Path': '层级路径',
  'Factor Management': '要素表管理', 'Maintain business factors and groups of equivalent fields.': '维护同类字段集合和业务要素定义。',
  'Factor Name': '要素名称', 'Description': '说明', 'Owner': '所有者', 'Created By': '创建人',
  'External Data Import': '外部数据导入', 'Import table metadata from SQL or SQLite files and track each job.': '从 SQL 或 SQLite 文件导入表元数据并跟踪任务。',
  'Source File': '来源文件', 'Source Type': '来源类型', 'SQL File': 'SQL 文件', 'Target Prefix': '目标表前缀',
  'Status': '状态', 'Pending': '待处理', 'Running': '执行中', 'Completed': '已完成', 'Failed': '失败',
  'Imported Objects': '导入对象数', 'Error Message': '错误信息',
  'Data Table Management': '数据表管理', 'Maintain business tables and their visibility, hierarchy, and indexing metadata.': '维护业务数据表及公开、树形、索引等元属性。',
  'Physical Name': '英文表名', 'Display Name': '显示名称', 'Category': '表分类', 'Table Type': '表类型',
  'Tree Table': '树形表', 'Internal Table': '内部表', 'Public Table': '公开表', 'Row Count': '记录数', 'Full-text Index': '全文索引',
  'Private Table Management': '私有数据表管理', 'Display and maintain non-public data tables only.': '只显示和维护非公开数据表。',
  'Daily Table Count Management': '每日增量总数表管理', 'Track daily increments and cumulative totals for each table.': '记录各数据表每日增量及累计总数。',
  'Table Name': '表名称', 'Daily Increase': '当日增量', 'Total Count': '累计总数', 'Statistics Date': '统计日期',
  'Data Cube Management': '数据立方管理', 'Maintain analytical relationship models between data tables.': '维护数据表之间的关联分析模型。',
  'Cube Name': '立方名称', 'Relationship Definition JSON': '关系定义 JSON',
  'Table Category Management': '表分类管理', 'Maintain the table category tree and display order.': '维护数据表分类树和显示顺序。',
  'Category Name': '分类名称', 'Parent Category': '上级分类',
  'Yes': '是', 'No': '否', 'Saved': '已保存', 'Created': '已创建', 'Deleted': '已删除',
  'Actions': '操作', 'Delete this record?': '确认删除这条记录？', 'Refresh': '刷新', 'New': '新建',
  'Edit {title}': '编辑{title}', 'New {title}': '新建{title}', 'Choose External Data File': '选择外部数据文件',
  'Please enter {field}': '请填写{field}'
};

function format(message: string, params?: Params) {
  return params ? message.replace(/\{(\w+)\}/g, (_, key: string) => String(params[key] ?? `{${key}}`)) : message;
}

type I18nValue = { locale: Locale; setLocale(locale: Locale): void; t(key: string, params?: Params): string };
const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => localStorage.getItem('datamaker.locale') === 'zh-CN' ? 'zh-CN' : 'en-US');
  const value = useMemo<I18nValue>(() => ({
    locale,
    setLocale(next) { localStorage.setItem('datamaker.locale', next); setLocaleState(next); },
    t(key, params) { return format(locale === 'zh-CN' ? zh[key] ?? key : key, params); }
  }), [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside I18nProvider');
  return value;
}
