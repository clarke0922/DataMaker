import { useEffect, useMemo, useState, type Key } from "react";
import {
  Button,
  Card,
  Checkbox,
  Descriptions,
  Form,
  Input,
  message,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import {
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  PlusOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import type {
  ManagementRecordDto,
  MetadataTableDto,
  MetadataTableOptionDto,
} from "@datamaker/contracts";
import { useI18n } from "./i18n";

type FactorField = {
  id: string;
  name: string;
  comment: string | null;
  tableId: string;
  tableName: string;
};

function jsonArray<T>(value: unknown): T[] {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function FactorManagementPage({ canManage }: { canManage: boolean }) {
  const { t } = useI18n();
  const [records, setRecords] = useState<ManagementRecordDto[]>([]);
  const [tableOptions, setTableOptions] = useState<MetadataTableOptionDto[]>(
    [],
  );
  const [tables, setTables] = useState<MetadataTableDto[]>([]);
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const [selectedRows, setSelectedRows] = useState<Key[]>([]);
  const [editing, setEditing] = useState<ManagementRecordDto>();
  const [viewing, setViewing] = useState<ManagementRecordDto>();
  const [editorOpen, setEditorOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [search, setSearch] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [form] = Form.useForm();

  async function load() {
    setLoading(true);
    const [factorResult, optionResult] = await Promise.all([
      window.datamaker.management.list("factors"),
      window.datamaker.metadata.listTableOptions(),
    ]);
    setLoading(false);
    if (factorResult.ok) setRecords(factorResult.data);
    else message.error(factorResult.error.message);
    if (optionResult.ok) setTableOptions(optionResult.data);
    else message.error(optionResult.error.message);
  }

  useEffect(() => {
    void load();
  }, []);

  async function loadTables(ids: string[]) {
    const results = await Promise.all(
      ids.map((id) => window.datamaker.metadata.getTable(id)),
    );
    const loaded = results.flatMap((result) =>
      result.ok ? [result.data] : [],
    );
    setTables(loaded);
    return loaded;
  }

  async function openEditor(record?: ManagementRecordDto) {
    const details = jsonArray<FactorField>(record?.field_details_json);
    const tableIds = [...new Set(details.map((field) => field.tableId))];
    setEditing(record);
    setSelectedFields(jsonArray<string>(record?.field_ids_json));
    setKeyword("");
    form.setFieldsValue({
      name: record?.name ?? "",
      description: record?.description ?? "",
      table_ids: tableIds,
    });
    setEditorOpen(true);
    await loadTables(tableIds);
  }

  async function changeTables(ids: string[]) {
    const loaded = await loadTables(ids);
    const available = new Set(
      loaded.flatMap((table) => table.columns.map((column) => column.id)),
    );
    setSelectedFields((current) => current.filter((id) => available.has(id)));
  }

  async function save() {
    const values = await form.validateFields();
    if (!selectedFields.length)
      return message.warning(t("Select at least one factor field"));
    const result = await window.datamaker.management.save("factors", {
      id: editing?.id,
      values: {
        name: values.name.trim(),
        description: values.description?.trim() || null,
        field_ids_json: JSON.stringify(selectedFields),
      },
    });
    if (!result.ok) return message.error(result.error.message);
    message.success(t(editing ? "Saved" : "Created"));
    setEditorOpen(false);
    form.resetFields();
    await load();
  }

  async function remove(ids: string[]) {
    for (const id of ids) {
      const result = await window.datamaker.management.remove("factors", id);
      if (!result.ok) return message.error(result.error.message);
    }
    setSelectedRows([]);
    message.success(t("Deleted"));
    await load();
  }

  const visibleRecords = useMemo(() => {
    const term = search.trim().toLowerCase();
    return records.filter((record) => {
      const created = String(record.created_at ?? "").slice(0, 10);
      return (
        (!term || String(record.name).toLowerCase().includes(term)) &&
        (!startDate || created >= startDate) &&
        (!endDate || created <= endDate)
      );
    });
  }, [records, search, startDate, endDate]);

  const columns = [
    { title: t("Factor Name"), dataIndex: "name", key: "name" },
    {
      title: t("Associated Fields"),
      key: "fields",
      render: (_: unknown, record: ManagementRecordDto) =>
        jsonArray<string>(record.field_ids_json).length,
    },
    {
      title: t("Created At"),
      dataIndex: "created_at",
      key: "created_at",
      render: (value: unknown) =>
        String(value ?? "-")
          .replace("T", " ")
          .slice(0, 19),
    },
    {
      title: t("Actions"),
      key: "actions",
      width: 180,
      render: (_: unknown, record: ManagementRecordDto) => (
        <Space>
          <Button
            type="text"
            icon={<EyeOutlined />}
            onClick={() => setViewing(record)}
          />
          <Button
            type="text"
            icon={<EditOutlined />}
            disabled={!canManage}
            onClick={() => void openEditor(record)}
          />
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

  return (
    <Card
      title={
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {t("Factor Management")}
          </Typography.Title>
          <Typography.Text type="secondary">
            {t("Maintain business factors and groups of equivalent fields.")}
          </Typography.Text>
        </div>
      }
      extra={
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>
            {t("Refresh")}
          </Button>
          <Popconfirm
            title={t("Delete selected factors?")}
            disabled={!canManage || !selectedRows.length}
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
            onClick={() => void openEditor()}
          >
            {t("New")}
          </Button>
        </Space>
      }
    >
      <Space wrap style={{ marginBottom: 16 }}>
        <Input.Search
          allowClear
          value={search}
          placeholder={t("Search factor name")}
          onChange={(event) => setSearch(event.target.value)}
          style={{ width: 260 }}
        />
        <Input
          type="date"
          value={startDate}
          aria-label={t("Start Date")}
          onChange={(event) => setStartDate(event.target.value)}
        />
        <Typography.Text type="secondary">{t("To")}</Typography.Text>
        <Input
          type="date"
          value={endDate}
          aria-label={t("End Date")}
          onChange={(event) => setEndDate(event.target.value)}
        />
        <Button
          onClick={() => {
            setSearch("");
            setStartDate("");
            setEndDate("");
          }}
        >
          {t("Reset")}
        </Button>
      </Space>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={visibleRecords}
        columns={columns}
        rowSelection={{
          selectedRowKeys: selectedRows,
          onChange: setSelectedRows,
        }}
        pagination={{ pageSize: 20, showSizeChanger: false }}
      />

      <Modal
        title={t(editing ? "Edit Factor" : "New Factor")}
        open={editorOpen}
        width={900}
        onOk={() => void save()}
        onCancel={() => setEditorOpen(false)}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item
            name="name"
            label={t("Factor Name")}
            rules={[{ required: true }, { max: 64 }]}
          >
            <Input maxLength={64} />
          </Form.Item>
          <Form.Item name="description" label={t("Description")}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item
            name="table_ids"
            label={t("Data Tables")}
            rules={[{ required: true }]}
          >
            <Select
              mode="multiple"
              showSearch
              optionFilterProp="label"
              options={tableOptions.map((table) => ({
                value: table.id,
                label: `${table.sourceName} / ${table.schemaName} / ${table.name}`,
              }))}
              onChange={(ids) => void changeTables(ids)}
            />
          </Form.Item>
          <Space.Compact style={{ width: "100%", marginBottom: 12 }}>
            <Input
              value={keyword}
              placeholder={t("Quick select fields containing keyword")}
              onChange={(event) => setKeyword(event.target.value)}
            />
            <Button
              onClick={() => {
                const term = keyword.trim().toLowerCase();
                if (!term) return;
                const matches = tables
                  .flatMap((table) => table.columns)
                  .filter((field) =>
                    `${field.name} ${field.comment ?? ""}`
                      .toLowerCase()
                      .includes(term),
                  )
                  .map((field) => field.id);
                setSelectedFields((current) => [
                  ...new Set([...current, ...matches]),
                ]);
              }}
            >
              {t("Select")}
            </Button>
            <Button onClick={() => setSelectedFields([])}>{t("Reset")}</Button>
          </Space.Compact>
          {tables.map((table) => {
            const ids = table.columns.map((column) => column.id);
            const checked = ids.filter((id) =>
              selectedFields.includes(id),
            ).length;
            return (
              <Card
                key={table.id}
                size="small"
                title={
                  <Checkbox
                    checked={Boolean(ids.length) && checked === ids.length}
                    indeterminate={checked > 0 && checked < ids.length}
                    onChange={(event) =>
                      setSelectedFields((current) =>
                        event.target.checked
                          ? [...new Set([...current, ...ids])]
                          : current.filter((id) => !ids.includes(id)),
                      )
                    }
                  >
                    {table.name}
                  </Checkbox>
                }
                style={{ marginBottom: 10 }}
              >
                <Checkbox.Group
                  value={selectedFields}
                  onChange={(values) => setSelectedFields(values.map(String))}
                >
                  <Space wrap>
                    {table.columns.map((column) => (
                      <Checkbox key={column.id} value={column.id}>
                        {column.comment || column.name}{" "}
                        <Typography.Text type="secondary">
                          ({column.name})
                        </Typography.Text>
                      </Checkbox>
                    ))}
                  </Space>
                </Checkbox.Group>
              </Card>
            );
          })}
        </Form>
      </Modal>

      <Modal
        title={t("Factor Details")}
        open={Boolean(viewing)}
        footer={null}
        onCancel={() => setViewing(undefined)}
        width={800}
      >
        {viewing && (
          <>
            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label={t("Factor Name")}>
                {String(viewing.name)}
              </Descriptions.Item>
              <Descriptions.Item label={t("Created At")}>
                {String(viewing.created_at).replace("T", " ").slice(0, 19)}
              </Descriptions.Item>
              <Descriptions.Item label={t("Description")} span={2}>
                {String(viewing.description ?? "-")}
              </Descriptions.Item>
            </Descriptions>
            <Table
              style={{ marginTop: 16 }}
              rowKey="id"
              pagination={false}
              dataSource={jsonArray<FactorField>(viewing.field_details_json)}
              columns={[
                {
                  title: t("Data Table"),
                  dataIndex: "tableName",
                  key: "tableName",
                },
                {
                  title: t("Factor Field"),
                  key: "field",
                  render: (_value, field) => (
                    <Tag color="red">
                      {field.comment || field.name} ({field.name})
                    </Tag>
                  ),
                },
              ]}
            />
          </>
        )}
      </Modal>
    </Card>
  );
}
