import { useEffect, useMemo, useState, type Key } from "react";
import {
  Button,
  Card,
  Checkbox,
  Descriptions,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from "antd";
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  ExportOutlined,
  PlusOutlined,
  ReloadOutlined,
  ScanOutlined,
} from "@ant-design/icons";
import type {
  ManagementRecordDto,
  MetadataTableDto,
  MetadataTableOptionDto,
} from "@datamaker/contracts";
import { useI18n } from "./i18n";

type ManagedColumn = {
  id?: string;
  name: string;
  display_name: string;
  data_type: string;
  length?: number | null;
  precision?: number | null;
  nullable: boolean | number;
  is_primary_key: boolean | number;
  is_pinyin: boolean | number;
  is_tree_display: boolean | number;
  is_multiple: boolean | number;
  dictionary_name?: string | null;
  weight: number;
  display_order: number;
  show_in_list: boolean | number;
  searchable: boolean | number;
  title_column: boolean | number;
  group_required: boolean | number;
};

const DATA_TYPES = ["varchar", "number", "date", "datetime", "clob", "blob"];

function jsonColumns(value: unknown): ManagedColumn[] {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function emptyColumn(order: number): ManagedColumn {
  return {
    name: "",
    display_name: "",
    data_type: "varchar",
    length: 32,
    precision: 0,
    nullable: true,
    is_primary_key: false,
    is_pinyin: false,
    is_tree_display: false,
    is_multiple: false,
    dictionary_name: null,
    weight: 0,
    display_order: order,
    show_in_list: true,
    searchable: false,
    title_column: false,
    group_required: false,
  };
}

function fromMetadata(table: MetadataTableDto): ManagedColumn[] {
  return table.columns.map((column, index) => ({
    name: column.name,
    display_name: column.comment || column.name,
    data_type:
      column.normalizedType === "integer" || column.normalizedType === "decimal"
        ? "number"
        : column.normalizedType === "date" ||
            column.normalizedType === "datetime"
          ? column.normalizedType
          : column.normalizedType === "binary"
            ? "blob"
            : column.normalizedType === "text" &&
                /clob|text/i.test(column.rawType)
              ? "clob"
              : "varchar",
    length: null,
    precision: null,
    nullable: column.nullable,
    is_primary_key: column.primaryKeyOrdinal !== null,
    is_pinyin: false,
    is_tree_display: false,
    is_multiple: false,
    dictionary_name: null,
    weight: 0,
    display_order: index,
    show_in_list: true,
    searchable: false,
    title_column: false,
    group_required: false,
  }));
}

export function TableManagementPage({
  privateOnly,
  canManage,
}: {
  privateOnly: boolean;
  canManage: boolean;
}) {
  const { t } = useI18n();
  const module = privateOnly ? "privateTables" : "tables";
  const [records, setRecords] = useState<ManagementRecordDto[]>([]);
  const [allTables, setAllTables] = useState<ManagementRecordDto[]>([]);
  const [categories, setCategories] = useState<ManagementRecordDto[]>([]);
  const [metadataOptions, setMetadataOptions] = useState<
    MetadataTableOptionDto[]
  >([]);
  const [columns, setColumns] = useState<ManagedColumn[]>([]);
  const [editing, setEditing] = useState<ManagementRecordDto>();
  const [viewing, setViewing] = useState<ManagementRecordDto>();
  const [selectedRows, setSelectedRows] = useState<Key[]>([]);
  const [searchPhysical, setSearchPhysical] = useState("");
  const [searchDisplay, setSearchDisplay] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [recognizeOpen, setRecognizeOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();
  const [recognizeForm] = Form.useForm();

  async function load() {
    setLoading(true);
    const [current, all, categoryResult, metadataResult] = await Promise.all([
      window.datamaker.management.list(module),
      window.datamaker.management.list("tables"),
      window.datamaker.management.list("categories"),
      window.datamaker.metadata.listTableOptions(),
    ]);
    setLoading(false);
    if (current.ok) setRecords(current.data);
    else message.error(current.error.message);
    if (all.ok) setAllTables(all.data);
    if (categoryResult.ok) setCategories(categoryResult.data);
    if (metadataResult.ok) setMetadataOptions(metadataResult.data);
  }

  useEffect(() => {
    void load();
  }, [privateOnly]);

  function openEditor(record?: ManagementRecordDto, copy = false) {
    setEditing(copy ? undefined : record);
    const sourceColumns = jsonColumns(record?.columns_json);
    setColumns(sourceColumns.length ? sourceColumns : [emptyColumn(0)]);
    form.setFieldsValue(
      record
        ? {
            ...record,
            name: copy ? `${record.name}_COPY` : record.name,
            display_name: copy
              ? `${record.display_name} Copy`
              : record.display_name,
            is_tree: Boolean(record.is_tree),
            is_internal: Boolean(record.is_internal),
            is_public: copy ? !privateOnly : Boolean(record.is_public),
            is_search_indexed: Boolean(record.is_search_indexed),
          }
        : {
            table_type: "business",
            is_tree: false,
            is_internal: true,
            is_public: !privateOnly,
            is_search_indexed: false,
            row_count: 0,
            display_order: records.length,
          },
    );
    setEditorOpen(true);
  }

  function updateColumn(index: number, patch: Partial<ManagedColumn>) {
    setColumns((current) =>
      current.map((column, position) =>
        position === index ? { ...column, ...patch } : column,
      ),
    );
  }

  function moveColumn(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= columns.length) return;
    setColumns((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next.map((column, position) => ({
        ...column,
        display_order: position,
      }));
    });
  }

  async function save() {
    const values = await form.validateFields();
    if (values.table_type === "subtable" && !values.parent_id)
      return message.warning(t("Select a parent table for a subtable"));
    if (
      !columns.length ||
      columns.some(
        (column) => !column.name.trim() || !column.display_name.trim(),
      )
    )
      return message.warning(t("Complete all required field names"));
    const result = await window.datamaker.management.save(module, {
      id: editing?.id,
      values: {
        ...values,
        columns_json: JSON.stringify(columns),
        is_public: privateOnly ? 0 : Number(values.is_public),
      },
    });
    if (!result.ok) return message.error(result.error.message);
    message.success(t(editing ? "Saved" : "Created"));
    setEditorOpen(false);
    await load();
  }

  async function remove(ids: string[]) {
    for (const id of ids) {
      const result = await window.datamaker.management.remove(module, id);
      if (!result.ok) return message.error(result.error.message);
    }
    setSelectedRows([]);
    message.success(t("Deleted"));
    await load();
  }

  async function promote(record: ManagementRecordDto) {
    const result = await window.datamaker.management.save("tables", {
      id: record.id,
      values: { is_public: 1 },
    });
    if (!result.ok) return message.error(result.error.message);
    message.success(t("Promoted to public table"));
    await load();
  }

  async function recognize() {
    const values = await recognizeForm.validateFields();
    const detail = await window.datamaker.metadata.getTable(
      values.source_table_id,
    );
    if (!detail.ok) return message.error(detail.error.message);
    const target = allTables.find(
      (record) => record.id === values.target_table_id,
    );
    const result = await window.datamaker.management.save("tables", {
      id: target?.id,
      values: {
        name: target?.name ?? detail.data.name.replace(/[^A-Za-z0-9_]/g, "_"),
        display_name:
          target?.display_name ?? detail.data.comment ?? detail.data.name,
        category_id: values.category_id || target?.category_id || null,
        parent_id: target?.parent_id || null,
        source_table_id: detail.data.id,
        table_type: target?.table_type || "business",
        is_internal: Number(values.is_internal),
        is_public: target?.is_public ?? 1,
        columns_json: JSON.stringify(fromMetadata(detail.data)),
      },
    });
    if (!result.ok) return message.error(result.error.message);
    message.success(
      t(target ? "Recognized as existing table" : "Recognized as new table"),
    );
    setRecognizeOpen(false);
    recognizeForm.resetFields();
    await load();
  }

  async function exportDdl(record: ManagementRecordDto) {
    const fields = jsonColumns(record.columns_json);
    const definitions = fields.map((column) => {
      const size =
        column.data_type === "varchar" && column.length
          ? `(${column.length})`
          : column.data_type === "number" && column.length
            ? `(${column.length}${column.precision ? `,${column.precision}` : ""})`
            : "";
      return `  "${column.name}" ${column.data_type.toUpperCase()}${size}${column.nullable ? "" : " NOT NULL"}`;
    });
    const primary = fields
      .filter((column) => column.is_primary_key)
      .map((column) => `"${column.name}"`);
    if (primary.length)
      definitions.push(`  PRIMARY KEY (${primary.join(", ")})`);
    const ddl = `CREATE TABLE "${record.name}" (\n${definitions.join(",\n")}\n);\n`;
    const result = await window.datamaker.system.saveTextFile(
      `${record.name}.sql`,
      ddl,
    );
    if (!result.ok) message.error(result.error.message);
  }

  const visibleRecords = useMemo(
    () =>
      records.filter(
        (record) =>
          (!searchPhysical.trim() ||
            String(record.name)
              .toLowerCase()
              .includes(searchPhysical.trim().toLowerCase())) &&
          (!searchDisplay.trim() ||
            String(record.display_name)
              .toLowerCase()
              .includes(searchDisplay.trim().toLowerCase())),
      ),
    [records, searchPhysical, searchDisplay],
  );

  const tableColumns = [
    { title: t("Physical Name"), dataIndex: "name", key: "name" },
    {
      title: t("Display Name"),
      dataIndex: "display_name",
      key: "display_name",
    },
    {
      title: t("Category"),
      dataIndex: "category_name",
      key: "category_name",
      render: (value: unknown) => String(value ?? "-"),
    },
    {
      title: t("Table Scope"),
      key: "scope",
      render: (_: unknown, record: ManagementRecordDto) => (
        <Space>
          <Tag color={record.is_internal ? "blue" : "orange"}>
            {t(record.is_internal ? "Internal Table" : "External Table")}
          </Tag>
          <Tag>
            {t(record.table_type === "subtable" ? "Subtable" : "Main Table")}
          </Tag>
        </Space>
      ),
    },
    { title: t("Row Count"), dataIndex: "row_count", key: "row_count" },
    {
      title: t("Actions"),
      key: "actions",
      width: 280,
      render: (_: unknown, record: ManagementRecordDto) => (
        <Space size={2}>
          <Button
            type="text"
            icon={<EyeOutlined />}
            onClick={() => setViewing(record)}
          />
          <Button
            type="text"
            icon={<EditOutlined />}
            disabled={!canManage}
            onClick={() => openEditor(record)}
          />
          <Button
            type="text"
            icon={<CopyOutlined />}
            disabled={!canManage}
            onClick={() => openEditor(record, true)}
          />
          <Button
            type="text"
            icon={<ExportOutlined />}
            onClick={() => void exportDdl(record)}
          />
          {privateOnly && (
            <Button
              type="link"
              disabled={!canManage}
              onClick={() => void promote(record)}
            >
              {t("Make Public")}
            </Button>
          )}
          <Popconfirm
            title={t("Delete this record?")}
            onConfirm={() => void remove([record.id])}
          >
            <Button
              danger
              type="text"
              icon={<DeleteOutlined />}
              disabled={!canManage}
            />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const editorColumns = [
    {
      title: t("Order"),
      width: 82,
      render: (_: unknown, _column: ManagedColumn, index: number) => (
        <Space size={0}>
          <Button
            size="small"
            type="text"
            icon={<ArrowUpOutlined />}
            onClick={() => moveColumn(index, -1)}
          />
          <Button
            size="small"
            type="text"
            icon={<ArrowDownOutlined />}
            onClick={() => moveColumn(index, 1)}
          />
        </Space>
      ),
    },
    {
      title: t("Field Physical Name"),
      width: 150,
      render: (_: unknown, column: ManagedColumn, index: number) => (
        <Input
          value={column.name}
          onChange={(event) =>
            updateColumn(index, { name: event.target.value.toUpperCase() })
          }
        />
      ),
    },
    {
      title: t("Field Display Name"),
      width: 150,
      render: (_: unknown, column: ManagedColumn, index: number) => (
        <Input
          value={column.display_name}
          onChange={(event) =>
            updateColumn(index, { display_name: event.target.value })
          }
        />
      ),
    },
    {
      title: t("Field Type"),
      width: 120,
      render: (_: unknown, column: ManagedColumn, index: number) => (
        <Select
          value={column.data_type}
          options={DATA_TYPES.map((value) => ({ value, label: t(value) }))}
          onChange={(value) => updateColumn(index, { data_type: value })}
        />
      ),
    },
    {
      title: t("Length"),
      width: 90,
      render: (_: unknown, column: ManagedColumn, index: number) => (
        <InputNumber
          min={0}
          value={column.length}
          onChange={(value) => updateColumn(index, { length: value })}
        />
      ),
    },
    {
      title: t("Precision"),
      width: 90,
      render: (_: unknown, column: ManagedColumn, index: number) => (
        <InputNumber
          min={0}
          value={column.precision}
          onChange={(value) => updateColumn(index, { precision: value })}
        />
      ),
    },
    {
      title: t("Primary Key"),
      width: 75,
      render: (_: unknown, column: ManagedColumn, index: number) => (
        <Checkbox
          checked={Boolean(column.is_primary_key)}
          onChange={(event) =>
            updateColumn(index, {
              is_primary_key: event.target.checked,
              nullable: event.target.checked ? false : column.nullable,
            })
          }
        />
      ),
    },
    {
      title: t("Nullable"),
      width: 70,
      render: (_: unknown, column: ManagedColumn, index: number) => (
        <Checkbox
          checked={Boolean(column.nullable)}
          disabled={Boolean(column.is_primary_key)}
          onChange={(event) =>
            updateColumn(index, { nullable: event.target.checked })
          }
        />
      ),
    },
    {
      title: t("Dictionary"),
      width: 130,
      render: (_: unknown, column: ManagedColumn, index: number) => (
        <Input
          value={column.dictionary_name ?? ""}
          onChange={(event) =>
            updateColumn(index, { dictionary_name: event.target.value })
          }
        />
      ),
    },
    {
      title: t("Weight"),
      width: 80,
      render: (_: unknown, column: ManagedColumn, index: number) => (
        <InputNumber
          min={0}
          max={100}
          value={column.weight}
          onChange={(value) => updateColumn(index, { weight: value ?? 0 })}
        />
      ),
    },
    {
      title: t("List"),
      width: 60,
      render: (_: unknown, column: ManagedColumn, index: number) => (
        <Checkbox
          checked={Boolean(column.show_in_list)}
          onChange={(event) =>
            updateColumn(index, { show_in_list: event.target.checked })
          }
        />
      ),
    },
    {
      title: t("Search Column"),
      width: 65,
      render: (_: unknown, column: ManagedColumn, index: number) => (
        <Checkbox
          checked={Boolean(column.searchable)}
          onChange={(event) =>
            updateColumn(index, { searchable: event.target.checked })
          }
        />
      ),
    },
    {
      title: t("Title"),
      width: 60,
      render: (_: unknown, column: ManagedColumn, index: number) => (
        <Checkbox
          checked={Boolean(column.title_column)}
          onChange={(event) =>
            updateColumn(index, { title_column: event.target.checked })
          }
        />
      ),
    },
    {
      title: t("Group Required"),
      width: 90,
      render: (_: unknown, column: ManagedColumn, index: number) => (
        <Checkbox
          checked={Boolean(column.group_required)}
          onChange={(event) =>
            updateColumn(index, { group_required: event.target.checked })
          }
        />
      ),
    },
    {
      title: "",
      width: 48,
      render: (_: unknown, _column: ManagedColumn, index: number) => (
        <Button
          danger
          type="text"
          icon={<DeleteOutlined />}
          onClick={() =>
            setColumns((current) =>
              current
                .filter((_item, position) => position !== index)
                .map((item, position) => ({
                  ...item,
                  display_order: position,
                })),
            )
          }
        />
      ),
    },
  ];

  return (
    <Card
      title={
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {t(
              privateOnly
                ? "Private Table Management"
                : "Data Table Management",
            )}
          </Typography.Title>
          <Typography.Text type="secondary">
            {t(
              "Maintain table structure, hierarchy, recognition, and field display settings.",
            )}
          </Typography.Text>
        </div>
      }
      extra={
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>
            {t("Refresh")}
          </Button>
          {!privateOnly && (
            <Button
              icon={<ScanOutlined />}
              disabled={!canManage}
              onClick={() => {
                recognizeForm.setFieldsValue({ is_internal: false });
                setRecognizeOpen(true);
              }}
            >
              {t("Recognize Table")}
            </Button>
          )}
          <Popconfirm
            title={t("Delete selected tables?")}
            disabled={!selectedRows.length}
            onConfirm={() => void remove(selectedRows.map(String))}
          >
            <Button
              danger
              icon={<DeleteOutlined />}
              disabled={!canManage || !selectedRows.length}
            >
              {t("Delete")}
            </Button>
          </Popconfirm>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            disabled={!canManage}
            onClick={() => openEditor()}
          >
            {t("New")}
          </Button>
        </Space>
      }
    >
      <Space wrap style={{ marginBottom: 16 }}>
        <Input
          value={searchPhysical}
          placeholder={t("Physical Name")}
          onChange={(event) => setSearchPhysical(event.target.value)}
        />
        <Input
          value={searchDisplay}
          placeholder={t("Display Name")}
          onChange={(event) => setSearchDisplay(event.target.value)}
        />
        <Button
          onClick={() => {
            setSearchPhysical("");
            setSearchDisplay("");
          }}
        >
          {t("Reset")}
        </Button>
      </Space>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={visibleRecords}
        columns={tableColumns}
        scroll={{ x: 1200 }}
        rowSelection={{
          selectedRowKeys: selectedRows,
          onChange: setSelectedRows,
        }}
        pagination={{ pageSize: 20, showSizeChanger: false }}
      />

      <Modal
        title={t(editing ? "Edit Data Table" : "New Data Table")}
        open={editorOpen}
        width={1200}
        onOk={() => void save()}
        onCancel={() => setEditorOpen(false)}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Space wrap align="start">
            <Form.Item
              name="name"
              label={t("Physical Name")}
              rules={[{ required: true }]}
            >
              <Input style={{ width: 210 }} />
            </Form.Item>
            <Form.Item
              name="display_name"
              label={t("Display Name")}
              rules={[{ required: true }, { max: 100 }]}
            >
              <Input style={{ width: 210 }} />
            </Form.Item>
            <Form.Item name="category_id" label={t("Category")}>
              <Select
                allowClear
                showSearch
                style={{ width: 210 }}
                options={categories.map((item) => ({
                  value: item.id,
                  label: String(item.name),
                }))}
              />
            </Form.Item>
            <Form.Item name="table_type" label={t("Table Type")}>
              <Select
                style={{ width: 150 }}
                options={[
                  { value: "business", label: t("Main Table") },
                  { value: "subtable", label: t("Subtable") },
                ]}
              />
            </Form.Item>
            <Form.Item
              noStyle
              shouldUpdate={(before, after) =>
                before.table_type !== after.table_type
              }
            >
              {({ getFieldValue }) =>
                getFieldValue("table_type") === "subtable" ? (
                  <Form.Item
                    name="parent_id"
                    label={t("Parent Table")}
                    rules={[{ required: true }]}
                  >
                    <Select
                      showSearch
                      style={{ width: 210 }}
                      options={allTables
                        .filter((item) => item.id !== editing?.id)
                        .map((item) => ({
                          value: item.id,
                          label: `${item.display_name} (${item.name})`,
                        }))}
                    />
                  </Form.Item>
                ) : null
              }
            </Form.Item>
            <Form.Item name="display_order" label={t("Order")}>
              <InputNumber min={0} />
            </Form.Item>
          </Space>
          <Space wrap style={{ marginBottom: 16 }}>
            <Form.Item
              name="is_internal"
              label={t("Internal Table")}
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
            {!privateOnly && (
              <Form.Item
                name="is_public"
                label={t("Public Table")}
                valuePropName="checked"
              >
                <Switch />
              </Form.Item>
            )}
            <Form.Item
              name="is_tree"
              label={t("Tree Table")}
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
            <Form.Item
              name="is_search_indexed"
              label={t("Full-text Index")}
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
            <Form.Item name="owner" label={t("Owner")}>
              <Input style={{ width: 180 }} />
            </Form.Item>
            <Form.Item name="icon" label={t("Table Icon")}>
              <Input style={{ width: 180 }} />
            </Form.Item>
          </Space>
          <Form.Item name="description" label={t("Description")}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <Space style={{ marginBottom: 8 }}>
            <Typography.Title level={5} style={{ margin: 0 }}>
              {t("Field Information")}
            </Typography.Title>
            <Button
              size="small"
              icon={<PlusOutlined />}
              onClick={() =>
                setColumns((current) => [
                  ...current,
                  emptyColumn(current.length),
                ])
              }
            >
              {t("Add Field")}
            </Button>
          </Space>
          <Table
            rowKey={(_column, index) => String(index)}
            size="small"
            pagination={false}
            dataSource={columns}
            columns={editorColumns}
            scroll={{ x: 1500 }}
          />
        </Form>
      </Modal>

      <Modal
        title={t("Recognize Table")}
        open={recognizeOpen}
        onOk={() => void recognize()}
        onCancel={() => setRecognizeOpen(false)}
        destroyOnHidden
      >
        <Form form={recognizeForm} layout="vertical" preserve={false}>
          <Form.Item
            name="source_table_id"
            label={t("Unrecognized Metadata Table")}
            rules={[{ required: true }]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              options={metadataOptions.map((table) => ({
                value: table.id,
                label: `${table.sourceName} / ${table.schemaName} / ${table.name}`,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="target_table_id"
            label={t("Recognize as Existing Table")}
          >
            <Select
              allowClear
              showSearch
              options={allTables.map((table) => ({
                value: table.id,
                label: `${table.display_name} (${table.name})`,
              }))}
            />
          </Form.Item>
          <Form.Item name="category_id" label={t("Category")}>
            <Select
              allowClear
              options={categories.map((item) => ({
                value: item.id,
                label: String(item.name),
              }))}
            />
          </Form.Item>
          <Form.Item
            name="is_internal"
            label={t("Internal Table")}
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t("Data Table Details")}
        open={Boolean(viewing)}
        footer={null}
        width={950}
        onCancel={() => setViewing(undefined)}
      >
        {viewing && (
          <>
            <Descriptions bordered size="small" column={3}>
              <Descriptions.Item label={t("Physical Name")}>
                {String(viewing.name)}
              </Descriptions.Item>
              <Descriptions.Item label={t("Display Name")}>
                {String(viewing.display_name)}
              </Descriptions.Item>
              <Descriptions.Item label={t("Category")}>
                {String(viewing.category_name ?? "-")}
              </Descriptions.Item>
              <Descriptions.Item label={t("Parent Table")}>
                {String(viewing.parent_name ?? "-")}
              </Descriptions.Item>
              <Descriptions.Item label={t("Table Scope")}>
                {t(viewing.is_internal ? "Internal Table" : "External Table")}
              </Descriptions.Item>
              <Descriptions.Item label={t("Row Count")}>
                {String(viewing.row_count ?? 0)}
              </Descriptions.Item>
            </Descriptions>
            <Table
              style={{ marginTop: 16 }}
              rowKey={(column) => column.id || column.name}
              pagination={false}
              dataSource={jsonColumns(viewing.columns_json)}
              columns={[
                { title: t("Order"), dataIndex: "display_order" },
                { title: t("Field Physical Name"), dataIndex: "name" },
                { title: t("Field Display Name"), dataIndex: "display_name" },
                { title: t("Field Type"), dataIndex: "data_type" },
                { title: t("Length"), dataIndex: "length" },
                {
                  title: t("Primary Key"),
                  dataIndex: "is_primary_key",
                  render: (value) => (value ? t("Yes") : t("No")),
                },
                {
                  title: t("Nullable"),
                  dataIndex: "nullable",
                  render: (value) => (value ? t("Yes") : t("No")),
                },
              ]}
            />
          </>
        )}
      </Modal>
    </Card>
  );
}
