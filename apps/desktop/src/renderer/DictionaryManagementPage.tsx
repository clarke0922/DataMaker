import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownOutlined,
  ArrowLeftOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import {
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Popconfirm,
  Radio,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import type { ManagementRecordDto } from "@datamaker/contracts";
import { useI18n } from "./i18n";

type DictionaryType = "list" | "tree";

type TreeRecord = {
  id: string;
  parent_id?: unknown;
  children: TreeRecord[];
  [key: string]: unknown;
};

function toTree(records: ManagementRecordDto[]): TreeRecord[] {
  const nodes = new Map<string, TreeRecord>(
    records.map((record) => [record.id, { ...record, children: [] }]),
  );
  const roots: TreeRecord[] = [];
  for (const node of nodes.values()) {
    const parent =
      typeof node.parent_id === "string"
        ? nodes.get(node.parent_id)
        : undefined;
    if (parent && parent.id !== node.id) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export function DictionaryManagementPage({
  preferredType,
  canManage,
}: {
  preferredType: DictionaryType;
  canManage: boolean;
}) {
  const { t } = useI18n();
  const [definitions, setDefinitions] = useState<ManagementRecordDto[]>([]);
  const [values, setValues] = useState<ManagementRecordDto[]>([]);
  const [selected, setSelected] = useState<ManagementRecordDto>();
  const [editingDefinition, setEditingDefinition] =
    useState<ManagementRecordDto>();
  const [editingValue, setEditingValue] = useState<ManagementRecordDto>();
  const [definitionOpen, setDefinitionOpen] = useState(false);
  const [valueOpen, setValueOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [definitionForm] = Form.useForm();
  const [valueForm] = Form.useForm();

  async function load() {
    setLoading(true);
    const [definitionResult, valueResult] = await Promise.all([
      window.datamaker.management.list("dictionaryDefinitions"),
      window.datamaker.management.list("dictionaryValues"),
    ]);
    setLoading(false);
    if (!definitionResult.ok)
      return message.error(definitionResult.error.message);
    if (!valueResult.ok) return message.error(valueResult.error.message);
    setDefinitions(definitionResult.data);
    setValues(valueResult.data);
    if (selected)
      setSelected(
        definitionResult.data.find((item) => item.id === selected.id),
      );
  }
  useEffect(() => {
    void load();
  }, []);

  const filteredDefinitions = definitions.filter(
    (item) =>
      item.dictionary_type === preferredType &&
      (!search ||
        String(item.name).toLowerCase().includes(search.toLowerCase()) ||
        String(item.code).toLowerCase().includes(search.toLowerCase())),
  );
  const selectedValues = values.filter(
    (item) => item.dictionary_id === selected?.id,
  );
  const itemCount = (id: string) =>
    values.filter((item) => item.dictionary_id === id).length;
  const parentOptions = selectedValues
    .filter((item) => item.id !== editingValue?.id)
    .map((item) => ({ value: item.id, label: String(item.value) }));

  function openDefinition(record?: ManagementRecordDto) {
    setEditingDefinition(record);
    definitionForm.setFieldsValue(record ?? { dictionary_type: preferredType });
    setDefinitionOpen(true);
  }
  async function saveDefinition() {
    const formValues = await definitionForm.validateFields();
    const result = await window.datamaker.management.save(
      "dictionaryDefinitions",
      { id: editingDefinition?.id, values: formValues },
    );
    if (!result.ok) return message.error(result.error.message);
    message.success(t(editingDefinition ? "Saved" : "Created"));
    setDefinitionOpen(false);
    definitionForm.resetFields();
    await load();
  }
  function openValue(record?: ManagementRecordDto) {
    setEditingValue(record);
    valueForm.setFieldsValue(
      record ?? {
        display_order: selectedValues.length + 1,
        weight: selected?.dictionary_type === "list" ? 1 : undefined,
      },
    );
    setValueOpen(true);
  }
  async function saveValue() {
    if (!selected) return;
    const formValues = await valueForm.validateFields();
    const result = await window.datamaker.management.save("dictionaryValues", {
      id: editingValue?.id,
      values: { ...formValues, dictionary_id: selected.id },
    });
    if (!result.ok) return message.error(result.error.message);
    message.success(t(editingValue ? "Saved" : "Created"));
    setValueOpen(false);
    valueForm.resetFields();
    await load();
  }
  async function remove(
    module: "dictionaryDefinitions" | "dictionaryValues",
    id: string,
  ) {
    const result = await window.datamaker.management.remove(module, id);
    if (!result.ok) return message.error(result.error.message);
    if (module === "dictionaryDefinitions" && selected?.id === id)
      setSelected(undefined);
    message.success(t("Deleted"));
    await load();
  }
  async function move(record: ManagementRecordDto, direction: -1 | 1) {
    const siblings = selectedValues
      .filter((item) => (item.parent_id ?? null) === (record.parent_id ?? null))
      .sort((a, b) => Number(a.display_order) - Number(b.display_order));
    const index = siblings.findIndex((item) => item.id === record.id);
    const target = siblings[index + direction];
    if (!target) return;
    const currentOrder = Number(record.display_order);
    const targetOrder = Number(target.display_order);
    const first = await window.datamaker.management.save("dictionaryValues", {
      id: record.id,
      values: { display_order: targetOrder },
    });
    if (!first.ok) return message.error(first.error.message);
    const second = await window.datamaker.management.save("dictionaryValues", {
      id: target.id,
      values: { display_order: currentOrder },
    });
    if (!second.ok) return message.error(second.error.message);
    await load();
  }

  const definitionColumns = useMemo(
    () => [
      { title: t("Dictionary Name"), dataIndex: "name" },
      {
        title: t("Dictionary Code"),
        dataIndex: "code",
        render: (value: string) => <Tag color="blue">{value}</Tag>,
      },
      {
        title: t("Dictionary Type"),
        dataIndex: "dictionary_type",
        width: 130,
        render: (value: string) =>
          t(value === "tree" ? "Dictionary Tree" : "Dictionary List"),
      },
      {
        title: t("Item Count"),
        width: 100,
        render: (_: unknown, record: ManagementRecordDto) =>
          itemCount(record.id),
      },
      { title: t("Created By"), dataIndex: "created_by", width: 120 },
      {
        title: t("Actions"),
        width: 230,
        render: (_: unknown, record: ManagementRecordDto) => (
          <Space>
            <Button
              type="link"
              icon={<UnorderedListOutlined />}
              onClick={() => setSelected(record)}
            >
              {t("Maintain Data")}
            </Button>
            <Button
              type="text"
              icon={<EditOutlined />}
              disabled={!canManage}
              onClick={() => openDefinition(record)}
            />
            <Popconfirm
              title={t("Delete dictionary and all its data?")}
              onConfirm={() => remove("dictionaryDefinitions", record.id)}
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
    [definitions, values, t],
  );

  const valueColumns = useMemo(
    () => [
      { title: t("Dictionary Content"), dataIndex: "value" },
      ...(selected?.dictionary_type === "list"
        ? [{ title: t("Weight"), dataIndex: "weight", width: 100 }]
        : [
            {
              title: t("Parent Item"),
              dataIndex: "parent_id",
              width: 180,
              render: (id: string) =>
                selectedValues.find((item) => item.id === id)?.value ??
                t("None"),
            },
          ]),
      { title: t("Order"), dataIndex: "display_order", width: 90 },
      {
        title: t("Actions"),
        width: 190,
        render: (_: unknown, record: ManagementRecordDto) => (
          <Space>
            <Button
              type="text"
              icon={<ArrowUpOutlined />}
              disabled={!canManage}
              onClick={() => move(record, -1)}
            />
            <Button
              type="text"
              icon={<ArrowDownOutlined />}
              disabled={!canManage}
              onClick={() => move(record, 1)}
            />
            <Button
              type="text"
              icon={<EditOutlined />}
              disabled={!canManage}
              onClick={() => openValue(record)}
            />
            <Popconfirm
              title={t("Delete this record?")}
              onConfirm={() => remove("dictionaryValues", record.id)}
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
    [selected, selectedValues, t],
  );

  if (selected)
    return (
      <Card
        title={
          <Space>
            <Button
              type="text"
              icon={<ArrowLeftOutlined />}
              onClick={() => setSelected(undefined)}
            />
            <div>
              <Typography.Title level={4} style={{ margin: 0 }}>
                {selected.name}
              </Typography.Title>
              <Typography.Text type="secondary">
                {selected.code} ·{" "}
                {t(
                  selected.dictionary_type === "tree"
                    ? "Dictionary Tree"
                    : "Dictionary List",
                )}
              </Typography.Text>
            </div>
          </Space>
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
              onClick={() => openValue()}
            >
              {t("Add Dictionary Item")}
            </Button>
          </Space>
        }
      >
        {selectedValues.length ? (
          <Table
            rowKey="id"
            loading={loading}
            dataSource={
              (selected.dictionary_type === "tree"
                ? toTree(selectedValues)
                : selectedValues) as ManagementRecordDto[]
            }
            columns={valueColumns}
            pagination={false}
          />
        ) : (
          <Empty description={t("No dictionary data yet")}>
            <Button
              type="primary"
              disabled={!canManage}
              onClick={() => openValue()}
            >
              {t("Add Dictionary Item")}
            </Button>
          </Empty>
        )}
        <ValueModal />
      </Card>
    );

  function ValueModal() {
    return (
      <Modal
        title={t(editingValue ? "Edit Dictionary Item" : "Add Dictionary Item")}
        open={valueOpen}
        onCancel={() => setValueOpen(false)}
        onOk={saveValue}
        destroyOnHidden
      >
        <Form form={valueForm} layout="vertical" preserve={false}>
          <Form.Item
            name="value"
            label={t("Dictionary Content")}
            rules={[{ required: true }, { max: 100 }]}
          >
            <Input />
          </Form.Item>
          {selected?.dictionary_type === "tree" ? (
            <Form.Item name="parent_id" label={t("Parent Item")}>
              <Select allowClear showSearch options={parentOptions} />
            </Form.Item>
          ) : (
            <Form.Item
              name="weight"
              label={t("Weight")}
              rules={[{ required: true }]}
            >
              <InputNumber min={1} max={100} style={{ width: "100%" }} />
            </Form.Item>
          )}
          <Form.Item name="display_order" label={t("Order")}>
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
        </Form>
      </Modal>
    );
  }

  return (
    <Card
      title={
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {t(
              preferredType === "tree"
                ? "Tree Dictionary Management"
                : "Dictionary Management",
            )}
          </Typography.Title>
          <Typography.Text type="secondary">
            {t("Create dictionaries, then maintain their values and order.")}
          </Typography.Text>
        </div>
      }
      extra={
        <Space>
          <Input.Search
            allowClear
            placeholder={t("Search dictionary name or code")}
            onSearch={setSearch}
            onChange={(event) => !event.target.value && setSearch("")}
          />
          <Button icon={<ReloadOutlined />} onClick={load}>
            {t("Refresh")}
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            disabled={!canManage}
            onClick={() => openDefinition()}
          >
            {t("Create Dictionary")}
          </Button>
        </Space>
      }
    >
      <Table
        rowKey="id"
        loading={loading}
        dataSource={filteredDefinitions}
        columns={definitionColumns}
        pagination={{ pageSize: 12, showSizeChanger: false }}
      />
      <Modal
        title={t(editingDefinition ? "Edit Dictionary" : "Create Dictionary")}
        open={definitionOpen}
        onCancel={() => setDefinitionOpen(false)}
        onOk={saveDefinition}
        destroyOnHidden
      >
        <Form form={definitionForm} layout="vertical" preserve={false}>
          <Row gutter={16}>
            <Col span={14}>
              <Form.Item
                name="name"
                label={t("Dictionary Name")}
                rules={[{ required: true }, { max: 100 }]}
              >
                <Input />
              </Form.Item>
            </Col>
            <Col span={10}>
              <Form.Item
                name="code"
                label={t("Dictionary Code")}
                rules={[
                  { required: true },
                  { pattern: /^[A-Za-z][A-Za-z0-9_]*$/ },
                ]}
              >
                <Input />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item
            name="dictionary_type"
            label={t("Dictionary Type")}
            rules={[{ required: true }]}
          >
            <Radio.Group
              options={[
                { value: "list", label: t("Dictionary List") },
                { value: "tree", label: t("Dictionary Tree") },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
