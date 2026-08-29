import { useEffect, useMemo, useState } from "react";
import {
  Button, Card, Descriptions, Empty, Form, Input, InputNumber, message,
  Modal, Popconfirm, Select, Space, Table, Tree, Typography,
} from "antd";
import {
  ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, EditOutlined,
  FolderAddOutlined, PlusOutlined, ReloadOutlined,
} from "@ant-design/icons";
import type { DataNode } from "antd/es/tree";
import type { ManagementRecordDto } from "@datamaker/contracts";
import { useI18n } from "./i18n";

function buildTree(records: ManagementRecordDto[]): DataNode[] {
  const nodes = new Map<string, DataNode & { parentId: string | null; order: number }>();
  records.forEach((record) => nodes.set(record.id, {
    key: record.id,
    title: `${record.code} ${record.name}`,
    parentId: record.parent_id ? String(record.parent_id) : null,
    order: Number(record.display_order ?? 0),
    children: [],
  }));
  const roots: Array<DataNode & { order: number }> = [];
  nodes.forEach((node) => {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent) parent.children!.push(node);
    else roots.push(node);
  });
  const sort = (items: DataNode[]) => {
    items.sort((a, b) => Number((a as { order?: number }).order ?? 0) - Number((b as { order?: number }).order ?? 0));
    items.forEach((item) => item.children && sort(item.children));
  };
  sort(roots);
  return roots;
}

export function OrganizationManagementPage({ canManage }: { canManage: boolean }) {
  const { t } = useI18n();
  const [records, setRecords] = useState<ManagementRecordDto[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [editing, setEditing] = useState<ManagementRecordDto>();
  const [parentId, setParentId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();

  async function load() {
    setLoading(true);
    const result = await window.datamaker.management.list("organizations");
    setLoading(false);
    if (result.ok) setRecords(result.data);
    else message.error(result.error.message);
  }
  useEffect(() => void load(), []);

  const tree = useMemo(() => buildTree(records), [records]);
  const selected = records.find((item) => item.id === selectedId);
  const filtered = records.filter((item) => {
    const term = search.trim().toLowerCase();
    return !term || [item.code, item.name, item.full_name].some((value) => String(value ?? "").toLowerCase().includes(term));
  });

  function edit(record?: ManagementRecordDto, targetParent: string | null = null) {
    setEditing(record);
    setParentId(record?.parent_id ? String(record.parent_id) : targetParent);
    form.setFieldsValue(record ?? { code: "", name: "", display_order: 0 });
    setOpen(true);
  }

  async function save() {
    const values = await form.validateFields();
    const result = await window.datamaker.management.save("organizations", {
      id: editing?.id,
      values: { ...values, parent_id: parentId },
    });
    if (!result.ok) return message.error(result.error.message);
    setOpen(false);
    setSelectedId(result.data.id);
    message.success(t(editing ? "Saved" : "Created"));
    await load();
  }

  async function remove() {
    if (!selectedId) return;
    const result = await window.datamaker.management.remove("organizations", selectedId);
    if (!result.ok) return message.error(result.error.message);
    setSelectedId(undefined);
    message.success(t("Deleted"));
    await load();
  }

  async function move(delta: number) {
    if (!selected) return;
    const siblings = records
      .filter((item) => (item.parent_id ?? null) === (selected.parent_id ?? null))
      .sort((a, b) => Number(a.display_order ?? 0) - Number(b.display_order ?? 0));
    const index = siblings.findIndex((item) => item.id === selected.id);
    const other = siblings[index + delta];
    if (!other) return;
    const currentOrder = Number(selected.display_order ?? index);
    const otherOrder = Number(other.display_order ?? index + delta);
    for (const [record, order] of [[selected, otherOrder], [other, currentOrder]] as const) {
      const result = await window.datamaker.management.save("organizations", { id: record.id, values: { display_order: order } });
      if (!result.ok) return message.error(result.error.message);
    }
    await load();
  }

  return <Card title={<div><Typography.Title level={4} style={{ margin: 0 }}>{t("Organization Management")}</Typography.Title><Typography.Text type="secondary">{t("Maintain the organization hierarchy and sibling order.")}</Typography.Text></div>} extra={<Button icon={<ReloadOutlined />} onClick={() => void load()}>{t("Refresh")}</Button>}>
    <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 30%) 1fr", gap: 20 }}>
      <Card size="small" title={t("Organization Tree")} loading={loading} extra={<Button type="text" icon={<PlusOutlined />} disabled={!canManage} onClick={() => edit()}>{t("Root Organization")}</Button>}>
        {tree.length ? <Tree treeData={tree} defaultExpandAll selectedKeys={selectedId ? [selectedId] : []} onSelect={(keys) => setSelectedId(keys[0] ? String(keys[0]) : undefined)} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}
      </Card>
      <Card size="small" title={selected ? String(selected.name) : t("Select an organization")} extra={<Space wrap>
        <Button icon={<FolderAddOutlined />} disabled={!canManage || !selected} onClick={() => edit(undefined, selectedId ?? null)}>{t("Add Child Organization")}</Button>
        <Button icon={<EditOutlined />} disabled={!canManage || !selected} onClick={() => edit(selected)}>{t("Edit")}</Button>
        <Button icon={<ArrowUpOutlined />} disabled={!canManage || !selected} onClick={() => void move(-1)} />
        <Button icon={<ArrowDownOutlined />} disabled={!canManage || !selected} onClick={() => void move(1)} />
        <Popconfirm title={t("Delete this organization?")} onConfirm={() => void remove()}><Button danger icon={<DeleteOutlined />} disabled={!canManage || !selected}>{t("Delete")}</Button></Popconfirm>
      </Space>}>
        {selected ? <Descriptions size="small" bordered column={2} items={[
          { key: "code", label: t("Organization Code"), children: selected.code },
          { key: "full", label: t("Full Organization Name"), children: selected.full_name },
          { key: "parent", label: t("Parent Organization"), children: selected.parent_name || "-" },
          { key: "contact", label: t("Contact"), children: selected.contact || "-" },
          { key: "address", label: t("Address"), children: selected.address || "-" },
          { key: "postal", label: t("Postal Code"), children: selected.postal_code || "-" },
          { key: "email", label: t("Email"), children: selected.email || "-" },
          { key: "registered", label: t("Registered By"), children: selected.registered_by || "-" },
        ]} /> : <Empty description={t("Select an organization")} />}
        <Input.Search allowClear value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("Search organization code or name")} style={{ margin: "16px 0 8px" }} />
        <Table rowKey="id" size="small" loading={loading} dataSource={filtered} pagination={{ pageSize: 10 }} onRow={(record) => ({ onClick: () => setSelectedId(record.id) })} columns={[
          { title: t("Organization Code"), dataIndex: "code", width: 130 },
          { title: t("Organization Name"), dataIndex: "name" },
          { title: t("Full Organization Name"), dataIndex: "full_name" },
          { title: t("Contact"), dataIndex: "contact", width: 140 },
        ]} />
      </Card>
    </div>
    <Modal title={t(editing ? "Edit Organization" : "New Organization")} open={open} onOk={() => void save()} onCancel={() => setOpen(false)} destroyOnHidden>
      <Form form={form} layout="vertical" preserve={false}>
        <Form.Item label={t("Parent Organization")}><Select allowClear value={parentId ?? undefined} onChange={(value) => setParentId(value ?? null)} options={records.filter((item) => item.id !== editing?.id).map((item) => ({ value: item.id, label: item.full_name }))} /></Form.Item>
        <Form.Item name="code" label={t("Organization Code")} rules={[{ required: true }, { pattern: /^[A-Za-z0-9_-]{1,3}$/ }]}><Input maxLength={3} /></Form.Item>
        <Form.Item name="name" label={t("Organization Name")} rules={[{ required: true }, { max: 100 }]}><Input /></Form.Item>
        <Form.Item name="contact" label={t("Contact")} rules={[{ max: 100 }]}><Input /></Form.Item>
        <Form.Item name="address" label={t("Address")} rules={[{ max: 200 }]}><Input /></Form.Item>
        <Form.Item name="postal_code" label={t("Postal Code")} rules={[{ max: 6 }]}><Input maxLength={6} /></Form.Item>
        <Form.Item name="email" label={t("Email")} rules={[{ type: "email" }]}><Input /></Form.Item>
        <Form.Item name="display_order" label={t("Order")}><InputNumber precision={0} style={{ width: "100%" }} /></Form.Item>
      </Form>
    </Modal>
  </Card>;
}
