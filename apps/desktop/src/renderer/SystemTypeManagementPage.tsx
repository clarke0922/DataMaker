import { useEffect, useMemo, useState, type Key } from "react";
import {
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  message,
  Modal,
  Popconfirm,
  Space,
  Table,
  Typography,
} from "antd";
import {
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  PlusOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import type { ManagementRecordDto } from "@datamaker/contracts";
import { useI18n } from "./i18n";

export function SystemTypeManagementPage({
  canManage,
}: {
  canManage: boolean;
}) {
  const { t } = useI18n();
  const [records, setRecords] = useState<ManagementRecordDto[]>([]);
  const [selected, setSelected] = useState<Key[]>([]);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<ManagementRecordDto>();
  const [viewing, setViewing] = useState<ManagementRecordDto>();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();

  async function load() {
    setLoading(true);
    const result = await window.datamaker.management.list("systemTypes");
    setLoading(false);
    if (result.ok) setRecords(result.data);
    else message.error(result.error.message);
  }
  useEffect(() => void load(), []);

  const filtered = useMemo(() => {
    const value = search.trim().toLowerCase();
    return value
      ? records.filter((record) =>
          `${record.code} ${record.name} ${record.type_group}`
            .toLowerCase()
            .includes(value),
        )
      : records;
  }, [records, search]);

  function edit(record?: ManagementRecordDto) {
    setEditing(record);
    form.setFieldsValue(record ?? { code: "", name: "", type_group: "" });
    setOpen(true);
  }

  async function save() {
    const values = await form.validateFields();
    const result = await window.datamaker.management.save("systemTypes", {
      id: editing?.id,
      values: { ...values, code: String(values.code).trim().toUpperCase() },
    });
    if (!result.ok) return message.error(result.error.message);
    setOpen(false);
    message.success(t(editing ? "Saved" : "Created"));
    await load();
  }

  async function remove(ids: string[]) {
    for (const id of ids) {
      const result = await window.datamaker.management.remove(
        "systemTypes",
        id,
      );
      if (!result.ok) return message.error(result.error.message);
    }
    setSelected([]);
    message.success(t("Deleted"));
    await load();
  }

  return (
    <Card
      title={
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {t("System Type Management")}
          </Typography.Title>
          <Typography.Text type="secondary">
            {t("Maintain reusable system category codes and groups.")}
          </Typography.Text>
        </div>
      }
      extra={
        <Space>
          <Input.Search
            allowClear
            placeholder={t("Search type code, name, or group")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            style={{ width: 250 }}
          />
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>
            {t("Refresh")}
          </Button>
          <Popconfirm
            title={t("Delete selected records?")}
            disabled={!selected.length}
            onConfirm={() => void remove(selected.map(String))}
          >
            <Button
              danger
              icon={<DeleteOutlined />}
              disabled={!canManage || !selected.length}
            >
              {t("Delete")}
            </Button>
          </Popconfirm>
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
        dataSource={filtered}
        rowSelection={{ selectedRowKeys: selected, onChange: setSelected }}
        columns={[
          { title: t("Type Code"), dataIndex: "code" },
          { title: t("Type Name"), dataIndex: "name" },
          { title: t("Type Group"), dataIndex: "type_group" },
          {
            title: t("Actions"),
            width: 150,
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
                  onClick={() => edit(record)}
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
        ]}
        pagination={{ pageSize: 20, showSizeChanger: false }}
      />
      <Modal
        title={t(editing ? "Edit System Type" : "New System Type")}
        open={open}
        onOk={() => void save()}
        onCancel={() => setOpen(false)}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item
            name="code"
            label={t("Type Code")}
            rules={[{ required: true }, { max: 20 }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="name"
            label={t("Type Name")}
            rules={[{ required: true }, { max: 30 }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="type_group"
            label={t("Type Group")}
            rules={[{ max: 20 }]}
          >
            <Input />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title={t("System Type Details")}
        open={Boolean(viewing)}
        footer={null}
        onCancel={() => setViewing(undefined)}
      >
        {viewing && (
          <Descriptions bordered column={1}>
            <Descriptions.Item label={t("Type Code")}>
              {String(viewing.code)}
            </Descriptions.Item>
            <Descriptions.Item label={t("Type Name")}>
              {String(viewing.name)}
            </Descriptions.Item>
            <Descriptions.Item label={t("Type Group")}>
              {String(viewing.type_group || "-")}
            </Descriptions.Item>
          </Descriptions>
        )}
      </Modal>
    </Card>
  );
}
