import { useEffect, useState } from "react";
import {
  Button,
  Card,
  Form,
  Input,
  message,
  Modal,
  Popconfirm,
  Progress,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import {
  DeleteOutlined,
  EditOutlined,
  FolderOpenOutlined,
  PlusOutlined,
  ReloadOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import type { DataSourceDto, SaveDataSourceInput } from "@datamaker/contracts";
import { useI18n } from "./i18n";

export function DataSourcesPage() {
  const { t } = useI18n();
  const [rows, setRows] = useState<DataSourceDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DataSourceDto>();
  const [task, setTask] = useState<import("@datamaker/contracts").TaskDto>();
  const [form] = Form.useForm<SaveDataSourceInput>();
  async function load() {
    setLoading(true);
    const result = await window.datamaker.sources.list();
    setLoading(false);
    if (result.ok) setRows(result.data);
    else message.error(result.error.message);
  }
  useEffect(() => {
    void load();
    void window.datamaker.sources.listTasks().then((result) => {
      if (result.ok) {
        const running = result.data.find(
          (item) => item.status === "running" || item.status === "pending",
        );
        if (running) {
          setTask(running);
          watchTask(running.id, false);
        }
      }
    });
  }, []);
  function edit(row?: DataSourceDto) {
    setEditing(row);
    form.setFieldsValue(row ?? { name: "", type: "sqlite", filePath: "" });
    setOpen(true);
  }
  async function choose() {
    const result = await window.datamaker.system.chooseImportFile();
    if (result.ok && result.data)
      form.setFieldsValue({
        filePath: result.data,
        type: result.data.toLowerCase().endsWith(".sql")
          ? "sql_file"
          : "sqlite",
      });
  }
  async function save() {
    const values = await form.validateFields();
    const result = await window.datamaker.sources.save({
      ...values,
      id: editing?.id,
    });
    if (!result.ok) return message.error(result.error.message);
    message.success(t(editing ? "Saved" : "Created"));
    setOpen(false);
    await load();
  }
  async function remove(id: string) {
    const result = await window.datamaker.sources.remove(id);
    if (!result.ok) return message.error(result.error.message);
    message.success(t("Deleted"));
    await load();
  }
  async function scan(row: DataSourceDto) {
    const preview = await window.datamaker.sources.preview(row.id);
    if (!preview.ok) return message.error(preview.error.message);
    Modal.confirm({
      title: t("Confirm Metadata Changes"),
      content: (
        <Space direction="vertical">
          <span>
            {t("Added: {count}", { count: preview.data.added.length })}:{" "}
            {preview.data.added.join(", ") || "-"}
          </span>
          <span>
            {t("Updated: {count}", { count: preview.data.updated.length })}:{" "}
            {preview.data.updated.join(", ") || "-"}
          </span>
          <span>
            {t("Retired: {count}", { count: preview.data.retired.length })}:{" "}
            {preview.data.retired.join(", ") || "-"}
          </span>
        </Space>
      ),
      onOk: async () => startScan(row.id),
    });
  }
  async function watchTask(id: string, announce = true) {
    const status = await window.datamaker.sources.task(id);
    if (!status.ok) return message.error(status.error.message);
    setTask(status.data);
    if (status.data.status === "running" || status.data.status === "pending")
      return setTimeout(() => watchTask(id, announce), 500);
    if (status.data.status === "completed" && status.data.result) {
      const summary = status.data.result;
      if (announce) {
        message.success(
          t(
            "Scan completed: {tables} tables, {columns} fields, {relations} relations",
            {
              tables: summary.tables,
              columns: summary.columns,
              relations: summary.relations,
            },
          ),
        );
        if (summary.warnings.length)
          Modal.warning({
            title: t("Import Warnings"),
            content: (
              <ul>
                {summary.warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            ),
          });
      }
      await load();
    } else if (status.data.status === "failed") {
      if (announce) message.error(status.data.error);
      await load();
    }
  }
  async function startScan(sourceId: string) {
    const result = await window.datamaker.sources.scan(sourceId);
    if (!result.ok) return message.error(result.error.message);
    setTask(result.data);
    setTimeout(() => watchTask(result.data.id), 300);
  }
  async function cancel() {
    if (!task) return;
    const result = await window.datamaker.sources.cancelTask(task.id);
    if (result.ok) {
      setTask(result.data);
      await load();
    } else message.error(result.error.message);
  }
  return (
    <Card
      title={
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {t("Data Source Management")}
          </Typography.Title>
          <Typography.Text type="secondary">
            {t(
              "Register local metadata sources and refresh their structures safely.",
            )}
          </Typography.Text>
        </div>
      }
      extra={
        <Space>
          <Button icon={<ReloadOutlined />} onClick={load}>
            {t("Refresh")}
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => edit()}>
            {t("New Data Source")}
          </Button>
        </Space>
      }
    >
      {task && (task.status === "running" || task.status === "pending") && (
        <Card size="small" style={{ marginBottom: 16 }}>
          <Space style={{ width: "100%", justifyContent: "space-between" }}>
            <span>{t("Metadata scan is running")}</span>
            <Button danger size="small" onClick={cancel}>
              {t("Cancel")}
            </Button>
          </Space>
          <Progress percent={task.progress} status="active" />
        </Card>
      )}
      <Table
        rowKey="id"
        loading={loading}
        dataSource={rows}
        columns={[
          { title: t("Name"), dataIndex: "name" },
          {
            title: t("Source Type"),
            dataIndex: "type",
            width: 120,
            render: (value) => (
              <Tag color="blue">{value === "sqlite" ? "SQLite" : "SQL"}</Tag>
            ),
          },
          { title: t("Source File"), dataIndex: "filePath", ellipsis: true },
          {
            title: t("Status"),
            dataIndex: "status",
            width: 110,
            render: (value: string) => (
              <Tag
                color={
                  value === "active"
                    ? "green"
                    : value === "scanning"
                      ? "blue"
                      : "red"
                }
              >
                {t(value[0]!.toUpperCase() + value.slice(1))}
              </Tag>
            ),
          },
          {
            title: t("Last Error"),
            dataIndex: "lastError",
            ellipsis: true,
            render: (value: string | null) =>
              value ? (
                <Typography.Text type="danger">{value}</Typography.Text>
              ) : (
                "-"
              ),
          },
          {
            title: t("Last Scanned"),
            dataIndex: "lastScannedAt",
            width: 190,
            render: (value) => value || "-",
          },
          {
            title: t("Actions"),
            width: 210,
            render: (_, row) => (
              <Space>
                <Button
                  type="link"
                  icon={<SyncOutlined />}
                  disabled={row.status === "scanning"}
                  onClick={() => scan(row)}
                >
                  {t("Scan")}
                </Button>
                <Button
                  type="text"
                  icon={<EditOutlined />}
                  onClick={() => edit(row)}
                />
                <Popconfirm
                  title={t("Delete this data source and collected metadata?")}
                  onConfirm={() => remove(row.id)}
                >
                  <Button danger type="text" icon={<DeleteOutlined />} />
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
      <Modal
        title={t(editing ? "Edit Data Source" : "New Data Source")}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={save}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item name="name" label={t("Name")} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item
            name="type"
            label={t("Source Type")}
            rules={[{ required: true }]}
          >
            <Select
              options={[
                { value: "sqlite", label: "SQLite" },
                { value: "sql_file", label: t("SQL File") },
              ]}
            />
          </Form.Item>
          <Form.Item label={t("Source File")} required>
            <Space.Compact style={{ width: "100%" }}>
              <Form.Item name="filePath" noStyle rules={[{ required: true }]}>
                <Input />
              </Form.Item>
              <Button icon={<FolderOpenOutlined />} onClick={choose}>
                {t("Browse")}
              </Button>
            </Space.Compact>
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
