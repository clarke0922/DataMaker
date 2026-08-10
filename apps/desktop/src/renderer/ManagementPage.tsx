import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Form, Input, InputNumber, message, Modal, Popconfirm, Select, Space, Switch, Table, Tag, Typography } from 'antd';
import { DeleteOutlined, EditOutlined, FolderOpenOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import type { ManagementModule, ManagementRecordDto } from '@datamaker/contracts';
import { useI18n } from './i18n';

type Translate = (key: string, params?: Record<string, string | number>) => string;
type Field = { key: string; label: string; type?: 'text' | 'number' | 'boolean' | 'select' | 'parent' | 'category'; required?: boolean; options?: Array<{ label: string; value: string }> };
type Spec = { title: string; description: string; fields: Field[] };

export function getManagementSpecs(t: Translate): Record<ManagementModule, Spec> {
  return {
    weights: { title: t('Weight Score Management'), description: t('Maintain field importance levels and scores.'), fields: [
      { key: 'name', label: t('Weight Name'), required: true }, { key: 'score', label: t('Weight Score'), type: 'number', required: true }, { key: 'display_order', label: t('Order'), type: 'number' }
    ] },
    dictionaries: { title: t('Dictionary Data Management'), description: t('Maintain codes, descriptions, and order in a list.'), fields: [
      { key: 'code', label: t('Dictionary Code'), required: true }, { key: 'description', label: t('Dictionary Description'), required: true }, { key: 'parent_id', label: t('Parent Dictionary'), type: 'parent' }, { key: 'path', label: t('Path') }, { key: 'display_order', label: t('Order'), type: 'number' }
    ] },
    dictionaryTree: { title: t('Tree Dictionary Management'), description: t('Maintain hierarchical dictionary data using parent-child relationships.'), fields: [
      { key: 'code', label: t('Node Code'), required: true }, { key: 'description', label: t('Node Name'), required: true }, { key: 'parent_id', label: t('Parent Node'), type: 'parent' }, { key: 'path', label: t('Hierarchy Path') }, { key: 'display_order', label: t('Order'), type: 'number' }
    ] },
    factors: { title: t('Factor Management'), description: t('Maintain business factors and groups of equivalent fields.'), fields: [
      { key: 'name', label: t('Factor Name'), required: true }, { key: 'description', label: t('Description') }, { key: 'owner', label: t('Created By') }
    ] },
    imports: { title: t('External Data Import'), description: t('Import table metadata from SQL or SQLite files and track each job.'), fields: [
      { key: 'source_name', label: t('Source File'), required: true }, { key: 'source_type', label: t('Source Type'), type: 'select', required: true, options: [{ label: t('SQL File'), value: 'sql' }, { label: 'SQLite', value: 'sqlite' }, { label: 'Excel', value: 'excel' }] },
      { key: 'target_name', label: t('Target Prefix') }, { key: 'status', label: t('Status'), type: 'select', options: [{ label: t('Pending'), value: 'pending' }, { label: t('Running'), value: 'running' }, { label: t('Completed'), value: 'completed' }, { label: t('Failed'), value: 'failed' }] }, { key: 'imported_rows', label: t('Imported Objects'), type: 'number' }, { key: 'error_message', label: t('Error Message') }
    ] },
    tables: { title: t('Data Table Management'), description: t('Maintain business tables and their visibility, hierarchy, and indexing metadata.'), fields: tableFields(t, true) },
    privateTables: { title: t('Private Table Management'), description: t('Display and maintain non-public data tables only.'), fields: tableFields(t, false) },
    dailyCounts: { title: t('Daily Table Count Management'), description: t('Track daily increments and cumulative totals for each table.'), fields: [
      { key: 'table_name', label: t('Table Name'), required: true }, { key: 'daily_increase', label: t('Daily Increase'), type: 'number' }, { key: 'total_count', label: t('Total Count'), type: 'number' }, { key: 'stat_date', label: t('Statistics Date'), required: true }
    ] },
    cubes: { title: t('Data Cube Management'), description: t('Maintain analytical relationship models between data tables.'), fields: [
      { key: 'name', label: t('Cube Name'), required: true }, { key: 'description', label: t('Description') }, { key: 'definition_json', label: t('Relationship Definition JSON') }
    ] },
    categories: { title: t('Table Category Management'), description: t('Maintain the table category tree and display order.'), fields: [
      { key: 'name', label: t('Category Name'), required: true }, { key: 'parent_id', label: t('Parent Category'), type: 'parent' }, { key: 'level_path', label: t('Hierarchy Path') }, { key: 'display_order', label: t('Order'), type: 'number' }
    ] }
  };
}

function tableFields(t: Translate, includePublic: boolean): Field[] {
  const fields: Field[] = [
    { key: 'name', label: t('Physical Name'), required: true }, { key: 'display_name', label: t('Display Name'), required: true }, { key: 'category_id', label: t('Category'), type: 'category' }, { key: 'table_type', label: t('Table Type') },
    { key: 'is_tree', label: t('Tree Table'), type: 'boolean' }, { key: 'is_internal', label: t('Internal Table'), type: 'boolean' }
  ];
  if (includePublic) fields.push({ key: 'is_public', label: t('Public Table'), type: 'boolean' });
  fields.push({ key: 'owner', label: t('Owner') }, { key: 'row_count', label: t('Row Count'), type: 'number' }, { key: 'is_search_indexed', label: t('Full-text Index'), type: 'boolean' }, { key: 'description', label: t('Description') });
  return fields;
}

function asTree(records: ManagementRecordDto[]) {
  const nodes = new Map<string, Record<string, unknown>>(records.map(record => [record.id, { ...record, children: [] }]));
  const roots: Record<string, unknown>[] = [];
  for (const node of nodes.values()) {
    const parent = typeof node.parent_id === 'string' ? nodes.get(node.parent_id) : undefined;
    if (parent && parent.id !== node.id) (parent.children as Record<string, unknown>[]).push(node); else roots.push(node);
  }
  return roots;
}

export function ManagementPage({ module }: { module: ManagementModule }) {
  const { t } = useI18n();
  const spec = getManagementSpecs(t)[module];
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
    message.success(t(editing ? 'Saved' : 'Created'));
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
    message.success(t('Deleted')); await load();
  }

  const parentOptions = records.filter(item => item.id !== editing?.id).map(item => ({ value: item.id, label: String(item.description ?? item.name ?? item.code ?? item.id) }));
  const categoryOptions = categories.map(item => ({ value: item.id, label: String(item.name) }));
  const dataSource = module === 'dictionaryTree' || module === 'categories' ? asTree(records) as unknown as ManagementRecordDto[] : records;
  const booleanText = (value: unknown) => value ? <Tag color="green">{t('Yes')}</Tag> : <Tag>{t('No')}</Tag>;
  const columns = useMemo(() => [
    ...spec.fields.filter(field => field.key !== 'parent_id' && field.key !== 'definition_json' && field.key !== 'error_message').map(field => ({ title: field.label, dataIndex: field.key, key: field.key, ellipsis: true, render: field.type === 'boolean' ? booleanText : (value: unknown) => value === null || value === undefined || value === '' ? '-' : String(value) })),
    { title: t('Actions'), key: 'actions', width: 130, fixed: 'right' as const, render: (_: unknown, record: ManagementRecordDto) => <Space><Button type="text" icon={<EditOutlined />} onClick={() => edit(record)} /><Popconfirm title={t('Delete this record?')} onConfirm={() => remove(record.id)}><Button danger type="text" icon={<DeleteOutlined />} /></Popconfirm></Space> }
  ], [spec, records, t]);

  return <Card title={<div><Typography.Title level={4} style={{ margin: 0 }}>{spec.title}</Typography.Title><Typography.Text type="secondary">{spec.description}</Typography.Text></div>} extra={<Space><Button icon={<ReloadOutlined />} onClick={load}>{t('Refresh')}</Button><Button type="primary" icon={<PlusOutlined />} onClick={() => edit()}>{t('New')}</Button></Space>}>
    <Table rowKey="id" loading={loading} dataSource={dataSource} columns={columns} scroll={{ x: 900 }} pagination={module === 'dictionaryTree' || module === 'categories' ? false : { pageSize: 12, showSizeChanger: false }} />
    <Modal title={t(editing ? 'Edit {title}' : 'New {title}', { title: spec.title })} open={open} onCancel={() => { setOpen(false); form.resetFields(); }} onOk={save} destroyOnHidden width={640}>
      <Form form={form} layout="vertical" preserve={false}>
        {module === 'imports' && <Button icon={<FolderOpenOutlined />} onClick={chooseImportFile} style={{ marginBottom: 16 }}>{t('Choose External Data File')}</Button>}
        {spec.fields.map(field => <Form.Item key={field.key} name={field.key} label={field.label} valuePropName={field.type === 'boolean' ? 'checked' : 'value'} rules={field.required ? [{ required: true, message: t('Please enter {field}', { field: field.label }) }] : undefined}>
          {field.type === 'number' ? <InputNumber style={{ width: '100%' }} /> : field.type === 'boolean' ? <Switch /> : field.type === 'select' ? <Select options={field.options} /> : field.type === 'parent' ? <Select allowClear showSearch options={parentOptions} /> : field.type === 'category' ? <Select allowClear showSearch options={categoryOptions} /> : field.key === 'definition_json' || field.key === 'description' || field.key === 'error_message' ? <Input.TextArea rows={3} /> : <Input />}
        </Form.Item>)}
      </Form>
    </Modal>
  </Card>;
}
