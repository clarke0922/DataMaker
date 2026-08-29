import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  Empty,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tree,
  Typography,
} from "antd";
import {
  DeleteOutlined,
  EditOutlined,
  FolderAddOutlined,
  PlusOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import type { DataNode } from "antd/es/tree";
import type { ManagementRecordDto } from "@datamaker/contracts";
import { useI18n } from "./i18n";

function categoryTree(records: ManagementRecordDto[]): DataNode[] {
  const nodes = new Map<string, DataNode & { parentId: string | null }>();
  records.forEach((record) =>
    nodes.set(record.id, {
      key: record.id,
      title: String(record.name),
      parentId: record.parent_id ? String(record.parent_id) : null,
      children: [],
    }),
  );
  const roots: DataNode[] = [];
  nodes.forEach((node) => {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent) parent.children!.push(node);
    else roots.push(node);
  });
  return roots;
}

export function CategoryManagementPage({ canManage }: { canManage: boolean }) {
  const { t } = useI18n();
  const [categories, setCategories] = useState<ManagementRecordDto[]>([]);
  const [tables, setTables] = useState<ManagementRecordDto[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [editing, setEditing] = useState<ManagementRecordDto>();
  const [parentId, setParentId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();

  async function load() {
    setLoading(true);
    const [categoryResult, tableResult] = await Promise.all([
      window.datamaker.management.list("categories"),
      window.datamaker.management.list("tables"),
    ]);
    setLoading(false);
    if (categoryResult.ok) setCategories(categoryResult.data);
    else message.error(categoryResult.error.message);
    if (tableResult.ok) setTables(tableResult.data);
  }
  useEffect(() => void load(), []);

  const selected = categories.find((item) => item.id === selectedId);
  const linkedTables = tables.filter((item) => item.category_id === selectedId);
  const tree = useMemo(() => categoryTree(categories), [categories]);

  function edit(
    record?: ManagementRecordDto,
    targetParent: string | null = null,
  ) {
    setEditing(record);
    setParentId(
      record
        ? record.parent_id
          ? String(record.parent_id)
          : null
        : targetParent,
    );
    form.setFieldsValue(record ?? { name: "", display_order: 0 });
    setOpen(true);
  }

  async function save() {
    const values = await form.validateFields();
    const result = await window.datamaker.management.save("categories", {
      id: editing?.id,
      values: { ...values, parent_id: parentId },
    });
    if (!result.ok) return message.error(result.error.message);
    message.success(t(editing ? "Saved" : "Created"));
    setOpen(false);
    setSelectedId(result.data.id);
    await load();
  }

  async function remove() {
    if (!selectedId) return;
    const result = await window.datamaker.management.remove(
      "categories",
      selectedId,
    );
    if (!result.ok) return message.error(result.error.message);
    setSelectedId(undefined);
    message.success(t("Deleted"));
    await load();
  }

  return (
    <Card
      title={
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {t("Table Type Management")}
          </Typography.Title>
          <Typography.Text type="secondary">
            {t(
              "Maintain the table category hierarchy and view its associated tables.",
            )}
          </Typography.Text>
        </div>
      }
      extra={
        <Button icon={<ReloadOutlined />} onClick={() => void load()}>
          {t("Refresh")}
        </Button>
      }
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(260px, 32%) 1fr",
          gap: 20,
        }}
      >
        <Card
          size="small"
          title={t("Category Tree")}
          loading={loading}
          extra={
            <Button
              type="text"
              icon={<PlusOutlined />}
              disabled={!canManage}
              onClick={() => edit()}
            >
              {t("Root Category")}
            </Button>
          }
        >
          {tree.length ? (
            <Tree
              treeData={tree}
              defaultExpandAll
              selectedKeys={selectedId ? [selectedId] : []}
              onSelect={(keys) =>
                setSelectedId(keys[0] ? String(keys[0]) : undefined)
              }
            />
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
          )}
        </Card>
        <Card
          size="small"
          title={selected ? String(selected.name) : t("Select a category")}
          extra={
            <Space>
              <Button
                icon={<FolderAddOutlined />}
                disabled={!canManage || !selected}
                onClick={() => edit(undefined, selectedId ?? null)}
              >
                {t("Add Child")}
              </Button>
              <Button
                icon={<EditOutlined />}
                disabled={!canManage || !selected}
                onClick={() => edit(selected)}
              >
                {t("Edit")}
              </Button>
              <Popconfirm
                title={t("Delete this category?")}
                onConfirm={() => void remove()}
              >
                <Button
                  danger
                  icon={<DeleteOutlined />}
                  disabled={!canManage || !selected}
                >
                  {t("Delete")}
                </Button>
              </Popconfirm>
            </Space>
          }
        >
          {selected ? (
            <>
              <Typography.Text type="secondary">
                {t("Associated Tables")}: {linkedTables.length}
              </Typography.Text>
              <Table
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={linkedTables}
                columns={[
                  { title: t("Physical Name"), dataIndex: "name" },
                  { title: t("Display Name"), dataIndex: "display_name" },
                  { title: t("Table Type"), dataIndex: "table_type" },
                ]}
                style={{ marginTop: 12 }}
              />
            </>
          ) : (
            <Empty
              description={t("Select a category to view its data tables.")}
            />
          )}
        </Card>
      </div>
      <Modal
        title={t(editing ? "Edit Category" : "New Category")}
        open={open}
        onOk={() => void save()}
        onCancel={() => setOpen(false)}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item label={t("Parent Category")}>
            <Input
              disabled
              value={
                parentId
                  ? String(
                      categories.find((item) => item.id === parentId)?.name ??
                        "-",
                    )
                  : t("Root Category")
              }
            />
          </Form.Item>
          <Form.Item
            name="name"
            label={t("Category Name")}
            rules={[{ required: true }, { max: 100 }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="display_order"
            label={t("Order")}
            rules={[{ required: true }]}
          >
            <InputNumber precision={0} style={{ width: "100%" }} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
