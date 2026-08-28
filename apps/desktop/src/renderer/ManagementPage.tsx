import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
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
  DeleteOutlined,
  EditOutlined,
  FolderOpenOutlined,
  PlusOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import type {
  ManagementModule,
  ManagementRecordDto,
} from "@datamaker/contracts";
import { useI18n } from "./i18n";
import { getManagementSpecs } from "./managementSpecs";

function asTree(records: ManagementRecordDto[]) {
  const nodes = new Map<string, Record<string, unknown>>(
    records.map((record) => [record.id, { ...record, children: [] }]),
  );
  const roots: Record<string, unknown>[] = [];
  for (const node of nodes.values()) {
    const parent =
      typeof node.parent_id === "string"
        ? nodes.get(node.parent_id)
        : undefined;
    if (parent && parent.id !== node.id)
      (parent.children as Record<string, unknown>[]).push(node);
    else roots.push(node);
  }
  return roots;
}

export function ManagementPage({
  module,
  canManage,
}: {
  module: ManagementModule;
  canManage: boolean;
}) {
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
    if (module === "tables" || module === "privateTables") {
      const categoryResult =
        await window.datamaker.management.list("categories");
      if (categoryResult.ok) setCategories(categoryResult.data);
    }
    setLoading(false);
    if (result.ok) setRecords(result.data);
    else message.error(result.error.message);
  }
  useEffect(() => {
    void load();
  }, [module]);

  function edit(record?: ManagementRecordDto) {
    setEditing(record);
    form.setFieldsValue(
      record ?? {
        display_order: 0,
        score: 0,
        row_count: 0,
        imported_rows: 0,
        daily_increase: 0,
        total_count: 0,
        is_tree: false,
        is_internal: true,
        is_public: module !== "privateTables",
        is_search_indexed: false,
      },
    );
    setOpen(true);
  }

  async function save() {
    const values = await form.validateFields();
    const result = await window.datamaker.management.save(module, {
      id: editing?.id,
      values,
    });
    if (!result.ok) return message.error(result.error.message);
    message.success(t(editing ? "Saved" : "Created"));
    setOpen(false);
    form.resetFields();
    await load();
  }

  async function chooseImportFile() {
    const result = await window.datamaker.system.chooseImportFile();
    if (!result.ok) return message.error(result.error.message);
    if (!result.data) return;
    const extension = result.data.split(".").pop()?.toLowerCase();
    form.setFieldsValue({
      source_name: result.data,
      source_type:
        extension === "sql"
          ? "sql"
          : extension === "xlsx" || extension === "xls"
            ? "excel"
            : "sqlite",
    });
  }

  async function remove(id: string) {
    const result = await window.datamaker.management.remove(module, id);
    if (!result.ok) return message.error(result.error.message);
    message.success(t("Deleted"));
    await load();
  }

  const parentOptions = records
    .filter((item) => item.id !== editing?.id)
    .map((item) => ({
      value: item.id,
      label: String(item.description ?? item.name ?? item.code ?? item.id),
    }));
  const categoryOptions = categories.map((item) => ({
    value: item.id,
    label: String(item.name),
  }));
  const dataSource =
    module === "dictionaryTree" || module === "categories"
      ? (asTree(records) as unknown as ManagementRecordDto[])
      : records;
  const booleanText = (value: unknown) =>
    value ? <Tag color="green">{t("Yes")}</Tag> : <Tag>{t("No")}</Tag>;
  const columns = useMemo(
    () => [
      ...spec.fields
        .filter(
          (field) =>
            field.key !== "parent_id" &&
            field.key !== "definition_json" &&
            field.key !== "error_message",
        )
        .map((field) => ({
          title: field.label,
          dataIndex: field.key,
          key: field.key,
          ellipsis: true,
          render:
            field.type === "boolean"
              ? booleanText
              : (value: unknown) =>
                  value === null || value === undefined || value === ""
                    ? "-"
                    : String(value),
        })),
      {
        title: t("Actions"),
        key: "actions",
        width: 130,
        fixed: "right" as const,
        render: (_: unknown, record: ManagementRecordDto) => (
          <Space>
            <Button
              type="text"
              icon={<EditOutlined />}
              disabled={!canManage}
              onClick={() => edit(record)}
            />
            <Popconfirm
              title={t("Delete this record?")}
              onConfirm={() => remove(record.id)}
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
    ],
    [spec, records, t],
  );

  return (
    <Card
      title={
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {spec.title}
          </Typography.Title>
          <Typography.Text type="secondary">{spec.description}</Typography.Text>
        </div>
      }
      extra={
        <Space>
          <Button icon={<ReloadOutlined />} onClick={load}>
            {t("Refresh")}
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            disabled={!canManage}
            onClick={() => edit()}
          >
            {t("New")}
          </Button>
        </Space>
      }
    >
      <Table
        rowKey="id"
        loading={loading}
        dataSource={dataSource}
        columns={columns}
        scroll={{ x: 900 }}
        pagination={
          module === "dictionaryTree" || module === "categories"
            ? false
            : { pageSize: 12, showSizeChanger: false }
        }
      />
      <Modal
        title={t(editing ? "Edit {title}" : "New {title}", {
          title: spec.title,
        })}
        open={open}
        onCancel={() => {
          setOpen(false);
          form.resetFields();
        }}
        onOk={save}
        destroyOnHidden
        width={640}
      >
        <Form form={form} layout="vertical" preserve={false}>
          {module === "imports" && (
            <Button
              icon={<FolderOpenOutlined />}
              disabled={!canManage}
              onClick={chooseImportFile}
              style={{ marginBottom: 16 }}
            >
              {t("Choose External Data File")}
            </Button>
          )}
          {spec.fields.map((field) => (
            <Form.Item
              key={field.key}
              name={field.key}
              label={field.label}
              valuePropName={field.type === "boolean" ? "checked" : "value"}
              rules={
                field.required
                  ? [
                      {
                        required: true,
                        message: t("Please enter {field}", {
                          field: field.label,
                        }),
                      },
                    ]
                  : undefined
              }
            >
              {field.type === "number" ? (
                <InputNumber style={{ width: "100%" }} />
              ) : field.type === "boolean" ? (
                <Switch />
              ) : field.type === "select" ? (
                <Select options={field.options} />
              ) : field.type === "parent" ? (
                <Select allowClear showSearch options={parentOptions} />
              ) : field.type === "category" ? (
                <Select allowClear showSearch options={categoryOptions} />
              ) : field.key === "definition_json" ||
                field.key === "description" ||
                field.key === "error_message" ? (
                <Input.TextArea rows={3} />
              ) : (
                <Input />
              )}
            </Form.Item>
          ))}
        </Form>
      </Modal>
    </Card>
  );
}
