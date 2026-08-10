import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Form, Input, InputNumber, message, Modal, Popconfirm, Select, Space, Switch, Table, Tag, Typography } from 'antd';
import { DeleteOutlined, EditOutlined, FolderOpenOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import type { ManagementModule, ManagementRecordDto } from '@datamaker/contracts';

type Field = { key: string; label: string; type?: 'text' | 'number' | 'boolean' | 'select' | 'parent' | 'category'; required?: boolean; options?: Array<{ label: string; value: string }> };
type Spec = { title: string; description: string; fields: Field[]; readonly?: string[] };

export const managementSpecs: Record<ManagementModule, Spec> = {
  weights: { title: '权重分数表管理', description: '维护字段重要程度及对应分值。', fields: [
    { key: 'name', label: '权重名称', required: true }, { key: 'score', label: '权重分值', type: 'number', required: true }, { key: 'display_order', label: '排序', type: 'number' }
  ] },
  dictionaries: { title: '字典数据管理', description: '以列表方式维护编码、含义和排序。', fields: [
    { key: 'code', label: '字典编码', required: true }, { key: 'description', label: '字典含义', required: true }, { key: 'parent_id', label: '上级字典', type: 'parent' }, { key: 'path', label: '路径' }, { key: 'display_order', label: '排序', type: 'number' }
  ] },
  dictionaryTree: { title: '树形字典数据管理', description: '按父子关系维护层级字典数据。', fields: [
    { key: 'code', label: '节点编码', required: true }, { key: 'description', label: '节点名称', required: true }, { key: 'parent_id', label: '父节点', type: 'parent' }, { key: 'path', label: '层级路径' }, { key: 'display_order', label: '排序', type: 'number' }
  ] },
  factors: { title: '要素表管理', description: '维护同类字段集合和业务要素定义。', fields: [
    { key: 'name', label: '要素名称', required: true }, { key: 'description', label: '说明' }, { key: 'owner', label: '创建人' }
  ], readonly: ['created_at'] },
  imports: { title: '外部数据导入', description: '登记 SQL、SQLite 或 Excel 外部数据导入任务。', fields: [
    { key: 'source_name', label: '来源文件', required: true }, { key: 'source_type', label: '来源类型', type: 'select', required: true, options: [{ label: 'SQL 文件', value: 'sql' }, { label: 'SQLite', value: 'sqlite' }, { label: 'Excel', value: 'excel' }] },
    { key: 'target_name', label: '目标表前缀' }, { key: 'status', label: '状态', type: 'select', options: [{ label: '待处理', value: 'pending' }, { label: '执行中', value: 'running' }, { label: '已完成', value: 'completed' }, { label: '失败', value: 'failed' }] }, { key: 'imported_rows', label: '导入对象数', type: 'number' }, { key: 'error_message', label: '错误信息' }
  ], readonly: ['created_at'] },
  tables: { title: '数据表管理', description: '维护业务数据表及公开、树形、索引等元属性。', fields: [
    { key: 'name', label: '英文表名', required: true }, { key: 'display_name', label: '中文名称', required: true }, { key: 'category_id', label: '表分类', type: 'category' }, { key: 'table_type', label: '表类型' },
    { key: 'is_tree', label: '树形表', type: 'boolean' }, { key: 'is_internal', label: '内部表', type: 'boolean' }, { key: 'is_public', label: '公开表', type: 'boolean' }, { key: 'owner', label: '所有者' },
    { key: 'row_count', label: '记录数', type: 'number' }, { key: 'is_search_indexed', label: '全文索引', type: 'boolean' }, { key: 'description', label: '说明' }
  ] },
  privateTables: { title: '私有数据表管理', description: '只显示和维护非公开数据表。', fields: [
    { key: 'name', label: '英文表名', required: true }, { key: 'display_name', label: '中文名称', required: true }, { key: 'category_id', label: '表分类', type: 'category' }, { key: 'table_type', label: '表类型' },
    { key: 'is_tree', label: '树形表', type: 'boolean' }, { key: 'is_internal', label: '内部表', type: 'boolean' }, { key: 'owner', label: '所有者' }, { key: 'row_count', label: '记录数', type: 'number' }, { key: 'is_search_indexed', label: '全文索引', type: 'boolean' }, { key: 'description', label: '说明' }
  ] },
  dailyCounts: { title: '每日增量总数表管理', description: '记录各数据表每日增量及累计总数。', fields: [
    { key: 'table_name', label: '表名称', required: true }, { key: 'daily_increase', label: '当日增量', type: 'number' }, { key: 'total_count', label: '累计总数', type: 'number' }, { key: 'stat_date', label: '统计日期', required: true }
  ] },
  cubes: { title: '数据立方管理', description: '维护数据表之间的关联分析模型。', fields: [
    { key: 'name', label: '立方名称', required: true }, { key: 'description', label: '说明' }, { key: 'definition_json', label: '关系定义 JSON' }
  ], readonly: ['created_at', 'updated_at'] },
  categories: { title: '表分类管理', description: '维护数据表分类树和显示顺序。', fields: [
    { key: 'name', label: '分类名称', required: true }, { key: 'parent_id', label: '上级分类', type: 'parent' }, { key: 'level_path', label: '层级路径' }, { key: 'display_order', label: '排序', type: 'number' }
  ], readonly: ['created_at'] }
};

const booleanText = (value: unknown) => value ? <Tag color="green">是</Tag> : <Tag>否</Tag>;

function asTree(records: ManagementRecordDto[]) {
  const nodes = new Map<string, Record<string, unknown>>(records.map(record => [record.id, { ...record, children: [] }]));
  const roots: Record<string, unknown>[] = [];
  for (const node of nodes.values()) {
    const parentId = node.parent_id;
    const parent = typeof parentId === 'string' ? nodes.get(parentId) : undefined;
    if (parent && parent.id !== node.id) (parent.children as Record<string, unknown>[]).push(node);
    else roots.push(node);
  }
  return roots;
}

export function ManagementPage({ module }: { module: ManagementModule }) {
  const spec = managementSpecs[module];
  const [records, setRecords] = useState<ManagementRecordDto[]>([]);
  const [categories, setCategories] = useState<ManagementRecordDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ManagementRecordDto>();
  const [form] = Form.useForm();

  async function load() {
    setLoading(true);
    const result = await window.datamaker.management.list(module);
    if (module === 'tables' || module === 'privateTables') {
      const categoryResult = await window.datamaker.management.list('categories');
      if (categoryResult.ok) setCategories(categoryResult.data);
    }
    setLoading(false);
    if (result.ok) setRecords(result.data); else message.error(result.error.message);
  }
  useEffect(() => { void load(); }, [module]);

  function edit(record?: ManagementRecordDto) {
    setEditing(record);
    form.setFieldsValue(record ?? { display_order: 0, score: 0, row_count: 0, imported_rows: 0, daily_increase: 0, total_count: 0, is_tree: false, is_internal: true, is_public: module !== 'privateTables', is_search_indexed: false });
    setOpen(true);
  }

  async function save() {
    const values = await form.validateFields();
    const result = await window.datamaker.management.save(module, { id: editing?.id, values });
    if (!result.ok) return message.error(result.error.message);
    message.success(editing ? '已保存' : '已创建');
    setOpen(false); form.resetFields(); await load();
  }

  async function chooseImportFile() {
    const result = await window.datamaker.system.chooseImportFile();
    if (!result.ok) return message.error(result.error.message);
    if (!result.data) return;
    const extension = result.data.split('.').pop()?.toLowerCase();
    form.setFieldsValue({ source_name: result.data, source_type: extension === 'sql' ? 'sql' : extension === 'xlsx' || extension === 'xls' ? 'excel' : 'sqlite' });
  }

  async function remove(id: string) {
    const result = await window.datamaker.management.remove(module, id);
    if (!result.ok) return message.error(result.error.message);
    message.success('已删除'); await load();
  }

  const parentOptions = records.filter(item => item.id !== editing?.id).map(item => ({ value: item.id, label: String(item.description ?? item.name ?? item.code ?? item.id) }));
  const categoryOptions = categories.map(item => ({ value: item.id, label: String(item.name) }));
  const dataSource = module === 'dictionaryTree' || module === 'categories' ? asTree(records) as unknown as ManagementRecordDto[] : records;
  const columns = useMemo(() => [
    ...spec.fields.filter(field => field.key !== 'parent_id' && field.key !== 'definition_json' && field.key !== 'error_message').map(field => ({
      title: field.label, dataIndex: field.key, key: field.key, ellipsis: true,
      render: field.type === 'boolean' ? booleanText : (value: unknown) => value === null || value === undefined || value === '' ? '-' : String(value)
    })),
    { title: '操作', key: 'actions', width: 130, fixed: 'right' as const, render: (_: unknown, record: ManagementRecordDto) => <Space>
      <Button type="text" icon={<EditOutlined />} onClick={() => edit(record)} />
      <Popconfirm title="确认删除这条记录？" onConfirm={() => remove(record.id)}><Button danger type="text" icon={<DeleteOutlined />} /></Popconfirm>
    </Space> }
  ], [spec, records]);

  return <Card title={<div><Typography.Title level={4} style={{ margin: 0 }}>{spec.title}</Typography.Title><Typography.Text type="secondary">{spec.description}</Typography.Text></div>}
    extra={<Space><Button icon={<ReloadOutlined />} onClick={load}>刷新</Button><Button type="primary" icon={<PlusOutlined />} onClick={() => edit()}>新建</Button></Space>}>
    <Table rowKey="id" loading={loading} dataSource={dataSource} columns={columns} scroll={{ x: 900 }} pagination={module === 'dictionaryTree' || module === 'categories' ? false : { pageSize: 12, showSizeChanger: false }} />
    <Modal title={editing ? `编辑${spec.title}` : `新建${spec.title}`} open={open} onCancel={() => { setOpen(false); form.resetFields(); }} onOk={save} destroyOnHidden width={640}>
      <Form form={form} layout="vertical" preserve={false}>
        {module === 'imports' && <Button icon={<FolderOpenOutlined />} onClick={chooseImportFile} style={{ marginBottom: 16 }}>选择外部数据文件</Button>}
        {spec.fields.map(field => <Form.Item key={field.key} name={field.key} label={field.label} valuePropName={field.type === 'boolean' ? 'checked' : 'value'} rules={field.required ? [{ required: true, message: `请填写${field.label}` }] : undefined}>
          {field.type === 'number' ? <InputNumber style={{ width: '100%' }} /> : field.type === 'boolean' ? <Switch /> : field.type === 'select' ? <Select options={field.options} /> : field.type === 'parent' ? <Select allowClear showSearch options={parentOptions} /> : field.type === 'category' ? <Select allowClear showSearch options={categoryOptions} /> : field.key === 'definition_json' || field.key === 'description' || field.key === 'error_message' ? <Input.TextArea rows={3} /> : <Input />}
        </Form.Item>)}
      </Form>
    </Modal>
  </Card>;
}
