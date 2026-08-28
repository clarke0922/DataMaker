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
  Switch,
  Table,
  Tag,
  Typography,
} from "antd";
import {
  CloudDownloadOutlined,
  CloudUploadOutlined,
  DownloadOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import type {
  AuditLogDto,
  DataSourceDto,
  ExportDictionaryInput,
  ExportTaskDto,
  MetadataTableOptionDto,
} from "@datamaker/contracts";
import { useI18n } from "./i18n";

export function AuditPage({
  canAudit,
  canExport,
  canReadMetadata,
}: {
  canAudit: boolean;
  canExport: boolean;
  canReadMetadata: boolean;
}) {
  const { t } = useI18n(),
    [rows, setRows] = useState<AuditLogDto[]>([]),
    [auditTotal, setAuditTotal] = useState(0),
    [auditPage, setAuditPage] = useState(1),
    [auditSearch, setAuditSearch] = useState(""),
    [auditResultFilter, setAuditResultFilter] = useState<
      "success" | "failure" | undefined
    >(),
    [sources, setSources] = useState<DataSourceDto[]>([]),
    [tables, setTables] = useState<MetadataTableOptionDto[]>([]),
    [loading, setLoading] = useState(false),
    [exportTask, setExportTask] = useState<ExportTaskDto>(),
    [exportOpen, setExportOpen] = useState(false),
    [form] = Form.useForm<ExportDictionaryInput>();
  async function load(
    targetPage = auditPage,
    search = auditSearch,
    resultFilter = auditResultFilter,
  ) {
    setLoading(true);
    const [auditResult, sourceResult, tableResult] = await Promise.all([
      canAudit
        ? window.datamaker.audit.list({
            page: targetPage,
            pageSize: 20,
            search,
            result: resultFilter,
          })
        : undefined,
      canReadMetadata ? window.datamaker.sources.list() : undefined,
      canReadMetadata
        ? window.datamaker.metadata.listTableOptions()
        : undefined,
    ]);
    setLoading(false);
    if (auditResult?.ok) {
      setRows(auditResult.data.items);
      setAuditTotal(auditResult.data.total);
      setAuditPage(auditResult.data.page);
    } else if (auditResult) message.error(auditResult.error.message);
    if (sourceResult?.ok) setSources(sourceResult.data);
    if (tableResult?.ok) setTables(tableResult.data);
  }
  useEffect(() => {
    void load();
  }, []);
  async function exportDictionary() {
    const values = await form.validateFields();
    setLoading(true);
    const result = await window.datamaker.exports.metadataDictionary(values);
    if (!result.ok) {
      setLoading(false);
      return message.error(result.error.message);
    }
    setExportTask(result.data);
    void watchExport(result.data.id);
  }
  async function watchExport(id: string) {
    const result = await window.datamaker.exports.task(id);
    if (!result.ok) {
      setLoading(false);
      return message.error(result.error.message);
    }
    setExportTask(result.data);
    if (result.data.status === "running" || result.data.status === "pending") {
      setTimeout(() => void watchExport(id), 400);
      return;
    }
    setLoading(false);
    if (result.data.status !== "completed" || !result.data.result)
      return message.error(result.data.error || t("Export failed"));
    const output = result.data.result;
    const saved = await window.datamaker.system.saveTextFile(
      output.fileName,
      output.content,
    );
    if (!saved.ok) return message.error(saved.error.message);
    if (saved.data) {
      message.success(t("Exported to {path}", { path: saved.data }));
      setExportOpen(false);
      setExportTask(undefined);
      await load();
    }
  }
  async function cancelExport() {
    if (!exportTask) return;
    const result = await window.datamaker.exports.cancelTask(exportTask.id);
    setLoading(false);
    if (result.ok) setExportTask(result.data);
    else message.error(result.error.message);
  }
  async function backup() {
    const result = await window.datamaker.system.backupDatabase();
    if (!result.ok) return message.error(result.error.message);
    if (result.data)
      message.success(t("Backup saved to {path}", { path: result.data }));
  }
  async function restore() {
    const result = await window.datamaker.system.restoreDatabase();
    if (!result.ok) return message.error(result.error.message);
    if (result.data)
      message.success(t("Backup validated. DataMaker is restarting."));
  }
  const selectedSources = Form.useWatch("sourceIds", form) ?? [];
  const tableChoices = tables
    .filter(
      (table) =>
        !table.retired &&
        (!selectedSources.length || selectedSources.includes(table.sourceId)),
    )
    .map((table) => ({
      value: table.id,
      label: `${table.sourceName} / ${table.schemaName} / ${table.name}`,
    }));
  return (
    <>
      <Card
        title={
          <div>
            <Typography.Title level={4} style={{ margin: 0 }}>
              {t("Audit and Export")}
            </Typography.Title>
            <Typography.Text type="secondary">
              {t(
                "Review local operations and export the collected metadata dictionary.",
              )}
            </Typography.Text>
          </div>
        }
        extra={
          <Space wrap>
            {canAudit && (
              <Button icon={<ReloadOutlined />} onClick={() => load()}>
                {t("Refresh")}
              </Button>
            )}
            {canExport && (
              <Button icon={<CloudDownloadOutlined />} onClick={backup}>
                {t("Backup")}
              </Button>
            )}
            {canAudit && (
              <Popconfirm
                title={t("Restore this backup and restart DataMaker?")}
                onConfirm={restore}
              >
                <Button danger icon={<CloudUploadOutlined />}>
                  {t("Restore")}
                </Button>
              </Popconfirm>
            )}
            {canExport && (
              <Button
                type="primary"
                icon={<DownloadOutlined />}
                onClick={() => {
                  form.setFieldsValue({
                    includeQuality: true,
                    includeRelations: true,
                    includeRawTypes: true,
                    sourceIds: [],
                    tableIds: [],
                  });
                  setExportOpen(true);
                }}
              >
                {t("Export Metadata Dictionary")}
              </Button>
            )}
          </Space>
        }
      >
        {canAudit && (
          <>
            <Space wrap style={{ marginBottom: 16 }}>
              <Input.Search
                allowClear
                placeholder={t("Search audit logs")}
                value={auditSearch}
                onChange={(event) => setAuditSearch(event.target.value)}
                onSearch={(value) => {
                  setAuditSearch(value);
                  void load(1, value, auditResultFilter);
                }}
                style={{ width: 320 }}
              />
              <Select
                allowClear
                placeholder={t("Result")}
                value={auditResultFilter}
                options={[
                  { value: "success", label: t("Success") },
                  { value: "failure", label: t("Failure") },
                ]}
                onChange={(value) => {
                  setAuditResultFilter(value);
                  void load(1, auditSearch, value);
                }}
                style={{ width: 150 }}
              />
            </Space>
            <Table
              rowKey="id"
              loading={loading}
              dataSource={rows}
              pagination={{
                current: auditPage,
                pageSize: 20,
                total: auditTotal,
                showTotal: (value) => `${value}`,
                onChange: (value) => void load(value),
              }}
              columns={[
                {
                  title: t("Occurred At"),
                  dataIndex: "occurredAt",
                  width: 190,
                },
                {
                  title: t("User"),
                  dataIndex: "actorUsername",
                  render: (value) => value ?? "-",
                },
                { title: t("Action"), dataIndex: "action" },
                { title: t("Object Type"), dataIndex: "objectType" },
                {
                  title: t("Object ID"),
                  dataIndex: "objectId",
                  ellipsis: true,
                },
                {
                  title: t("Result"),
                  dataIndex: "result",
                  render: (value) => (
                    <Tag color={value === "success" ? "green" : "red"}>
                      {value}
                    </Tag>
                  ),
                },
                { title: t("Context"), dataIndex: "context", ellipsis: true },
              ]}
            />
          </>
        )}
      </Card>
      <Modal
        title={t("Export Metadata Dictionary")}
        open={exportOpen}
        onCancel={() => {
          if (!loading) setExportOpen(false);
        }}
        closable={!loading}
        maskClosable={!loading}
        onOk={exportDictionary}
        confirmLoading={loading}
        destroyOnHidden
      >
        {exportTask && loading && (
          <Space
            direction="vertical"
            style={{ width: "100%", marginBottom: 16 }}
          >
            <Progress percent={exportTask.progress} status="active" />
            <Button danger onClick={cancelExport}>
              {t("Cancel")}
            </Button>
          </Space>
        )}
        <Form form={form} layout="vertical">
          <Form.Item name="sourceIds" label={t("Data Sources")}>
            <Select
              mode="multiple"
              allowClear
              options={sources.map((source) => ({
                value: source.id,
                label: source.name,
              }))}
              onChange={() => form.setFieldValue("tableIds", [])}
            />
          </Form.Item>
          <Form.Item name="tableIds" label={t("Metadata Tables")}>
            <Select
              mode="multiple"
              allowClear
              showSearch
              options={tableChoices}
            />
          </Form.Item>
          <Space size="large">
            <Form.Item
              name="includeQuality"
              label={t("Include Quality Results")}
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
            <Form.Item
              name="includeRelations"
              label={t("Include Relations")}
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
            <Form.Item
              name="includeRawTypes"
              label={t("Include Raw Types")}
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </>
  );
}
