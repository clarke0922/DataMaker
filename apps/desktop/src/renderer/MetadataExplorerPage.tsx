import { useEffect, useState } from "react";
import {
  Button,
  Card,
  Descriptions,
  Drawer,
  Form,
  Input,
  message,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
} from "antd";
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import type {
  MetadataColumnDto,
  MetadataTableDto,
  MetadataTableOptionDto,
  QualityResultDto,
  RelationDto,
  SaveRelationInput,
} from "@datamaker/contracts";
import { useI18n } from "./i18n";
import { RelationGraph } from "./RelationGraph";

export function MetadataExplorerPage({
  initialTab = "tables",
  canManage,
}: {
  initialTab?: "tables" | "relations" | "search";
  canManage: boolean;
}) {
  const { t } = useI18n();
  const [tables, setTables] = useState<MetadataTableDto[]>([]);
  const [tableOptionsData, setTableOptionsData] = useState<
    MetadataTableOptionDto[]
  >([]);
  const [sourceColumns, setSourceColumns] = useState<MetadataColumnDto[]>([]);
  const [targetColumns, setTargetColumns] = useState<MetadataColumnDto[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [relations, setRelations] = useState<RelationDto[]>([]);
  const [selected, setSelected] = useState<MetadataTableDto>();
  const [tableQuality, setTableQuality] = useState<QualityResultDto[]>([]);
  const [tableQualityTotal, setTableQualityTotal] = useState(0);
  const [tableQualityPage, setTableQualityPage] = useState(1);
  const [query, setQuery] = useState("");
  const [relationOpen, setRelationOpen] = useState(false);
  const [editing, setEditing] = useState<RelationDto>();
  const [objectEditing, setObjectEditing] = useState<{
    type: "table" | "column";
    row: MetadataTableDto | MetadataColumnDto;
  }>();
  const [form] = Form.useForm<SaveRelationInput>();
  const [objectForm] = Form.useForm();
  async function load(targetPage = page, search = query) {
    const [tableResult, optionResult, relationResult] = await Promise.all([
      window.datamaker.metadata.listTables({
        page: targetPage,
        pageSize: 15,
        search,
      }),
      window.datamaker.metadata.listTableOptions(),
      window.datamaker.metadata.listRelations(),
    ]);
    if (tableResult.ok) {
      setTables(tableResult.data.items);
      setTotal(tableResult.data.total);
      setPage(tableResult.data.page);
    } else message.error(tableResult.error.message);
    if (optionResult.ok) setTableOptionsData(optionResult.data);
    else message.error(optionResult.error.message);
    if (relationResult.ok) setRelations(relationResult.data);
    else message.error(relationResult.error.message);
  }
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (selected) void loadTableQuality(selected.id, 1);
    else {
      setTableQuality([]);
      setTableQualityTotal(0);
      setTableQualityPage(1);
    }
  }, [selected?.id]);
  async function loadTableQuality(tableId: string, targetPage: number) {
    const result = await window.datamaker.quality.listResults({
      tableId,
      page: targetPage,
      pageSize: 10,
    });
    if (!result.ok) return message.error(result.error.message);
    setTableQuality(result.data.items);
    setTableQualityTotal(result.data.total);
    setTableQualityPage(result.data.page);
  }
  async function loadRelationColumns(
    tableId: string | undefined,
    target: "source" | "target",
  ) {
    if (!tableId) {
      target === "source" ? setSourceColumns([]) : setTargetColumns([]);
      return;
    }
    const result = await window.datamaker.metadata.getTable(tableId);
    if (!result.ok) return message.error(result.error.message);
    target === "source"
      ? setSourceColumns(result.data.columns)
      : setTargetColumns(result.data.columns);
  }
  async function editRelation(row?: RelationDto) {
    setEditing(row);
    if (row)
      await Promise.all([
        loadRelationColumns(row.sourceTableId, "source"),
        loadRelationColumns(row.targetTableId, "target"),
      ]);
    else {
      setSourceColumns([]);
      setTargetColumns([]);
    }
    form.setFieldsValue(
      row
        ? {
            id: row.id,
            sourceTableId: row.sourceTableId,
            targetTableId: row.targetTableId,
            relationType: row.relationType,
            status: row.status,
            evidence: row.evidence ?? "",
            columnMappings: row.columnMappingDetails.map((mapping) => ({
              sourceColumnId: mapping.sourceColumnId,
              targetColumnId: mapping.targetColumnId,
            })),
          }
        : {
            relationType: "many_to_one",
            status: "confirmed",
            columnMappings: [],
          },
    );
    setRelationOpen(true);
  }
  async function saveRelation() {
    const values = await form.validateFields();
    const result = await window.datamaker.metadata.saveRelation({
      ...values,
      id: editing?.id,
    });
    if (!result.ok) return message.error(result.error.message);
    message.success(t(editing ? "Saved" : "Created"));
    setRelationOpen(false);
    await load();
  }
  async function removeRelation(id: string) {
    const result = await window.datamaker.metadata.removeRelation(id);
    if (!result.ok) return message.error(result.error.message);
    message.success(t("Deleted"));
    await load();
  }
  function editObject(
    type: "table" | "column",
    row: MetadataTableDto | MetadataColumnDto,
  ) {
    setObjectEditing({ type, row });
    objectForm.setFieldsValue({ comment: row.comment ?? "", tags: row.tags });
  }
  async function saveObject() {
    if (!objectEditing) return;
    const values = await objectForm.validateFields();
    const result = await window.datamaker.metadata.updateObject({
      objectType: objectEditing.type,
      objectId: objectEditing.row.id,
      comment: values.comment ?? "",
      tags: values.tags ?? [],
    });
    if (!result.ok) return message.error(result.error.message);
    message.success(t("Saved"));
    setObjectEditing(undefined);
    const updated = await window.datamaker.metadata.listTables({
      page,
      pageSize: 15,
      search: query,
    });
    if (updated.ok) {
      setTables(updated.data.items);
      if (selected)
        setSelected(
          updated.data.items.find((table) => table.id === selected.id),
        );
    }
  }
  const tableOptions = tableOptionsData
    .filter((table) => !table.retired)
    .map((table) => ({
      value: table.id,
      label: `${table.sourceName} / ${table.schemaName} / ${table.name}`,
    }));
  const tableView = (
    <Card
      title={t("Collected Metadata")}
      extra={
        <Space>
          <Input.Search
            allowClear
            prefix={<SearchOutlined />}
            placeholder={t("Search tables and fields")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onSearch={(value) => {
              setQuery(value);
              void load(1, value);
            }}
          />
          <Button icon={<ReloadOutlined />} onClick={() => load()}>
            {t("Refresh")}
          </Button>
        </Space>
      }
    >
      <Table
        rowKey="id"
        dataSource={tables}
        onRow={(record) => ({ onDoubleClick: () => setSelected(record) })}
        columns={[
          { title: t("Data Sources"), dataIndex: "sourceName" },
          { title: t("Schema"), dataIndex: "schemaName" },
          { title: t("Table Name"), dataIndex: "name" },
          {
            title: t("Type"),
            dataIndex: "objectType",
            render: (value) => <Tag>{value}</Tag>,
          },
          { title: t("Fields"), render: (_, row) => row.columns.length },
          {
            title: t("Status"),
            render: (_, row) =>
              row.retired ? (
                <Tag>{t("Retired")}</Tag>
              ) : (
                <Tag color="green">{t("Active")}</Tag>
              ),
          },
          {
            title: t("Actions"),
            render: (_, row) => (
              <Button type="link" onClick={() => setSelected(row)}>
                {t("Details")}
              </Button>
            ),
          },
        ]}
        pagination={{
          current: page,
          pageSize: 15,
          total,
          showSizeChanger: false,
          onChange: (next) => void load(next),
        }}
      />
    </Card>
  );
  const relationView = (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card title={t("Relationship Graph")}>
        <RelationGraph tables={tableOptionsData} relations={relations} />
      </Card>
      <Card
        title={t("Relationship Management")}
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => load()}>
              {t("Refresh")}
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              disabled={!canManage}
              onClick={() => editRelation()}
            >
              {t("New Relation")}
            </Button>
          </Space>
        }
      >
        <Table
          rowKey="id"
          dataSource={relations}
          columns={[
            { title: t("Source Table"), dataIndex: "sourceTableName" },
            { title: t("Target Table"), dataIndex: "targetTableName" },
            {
              title: t("Column Mapping"),
              dataIndex: "columnMappings",
              render: (values) => values?.join(", ") || "-",
            },
            { title: t("Relationship Type"), dataIndex: "relationType" },
            {
              title: t("Origin"),
              dataIndex: "origin",
              render: (value) => (
                <Tag
                  color={
                    value === "physical"
                      ? "blue"
                      : value === "manual"
                        ? "green"
                        : "orange"
                  }
                >
                  {value}
                </Tag>
              ),
            },
            {
              title: t("Confidence"),
              dataIndex: "confidence",
              render: (value) =>
                value == null ? "-" : `${Math.round(value * 100)}%`,
            },
            { title: t("Status"), dataIndex: "status" },
            { title: t("Evidence"), dataIndex: "evidence", ellipsis: true },
            {
              title: t("Actions"),
              render: (_, row) => (
                <Space>
                  <Button
                    type="text"
                    disabled={!canManage || row.origin === "physical"}
                    icon={<EditOutlined />}
                    onClick={() => editRelation(row)}
                  />
                  <Popconfirm
                    title={t("Delete this record?")}
                    onConfirm={() => removeRelation(row.id)}
                  >
                    <Button
                      danger
                      type="text"
                      disabled={!canManage || row.origin === "physical"}
                      icon={<DeleteOutlined />}
                    />
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
          scroll={{ x: 1200 }}
        />
      </Card>
    </Space>
  );
  return (
    <>
      <Tabs
        defaultActiveKey={initialTab === "relations" ? "relations" : "tables"}
        items={[
          { key: "tables", label: t("Metadata Tables"), children: tableView },
          { key: "relations", label: t("Relations"), children: relationView },
        ]}
      />
      <Drawer
        width={780}
        title={selected?.name}
        extra={
          selected && (
            <Button
              icon={<EditOutlined />}
              disabled={!canManage}
              onClick={() => editObject("table", selected)}
            >
              {t("Edit Notes and Tags")}
            </Button>
          )
        }
        open={Boolean(selected)}
        onClose={() => setSelected(undefined)}
      >
        {selected && (
          <Tabs
            items={[
              {
                key: "overview",
                label: t("Overview"),
                children: (
                  <Descriptions
                    column={2}
                    bordered
                    items={[
                      {
                        key: "source",
                        label: t("Data Sources"),
                        children: selected.sourceName,
                      },
                      {
                        key: "schema",
                        label: t("Schema"),
                        children: selected.schemaName,
                      },
                      {
                        key: "type",
                        label: t("Type"),
                        children: selected.objectType,
                      },
                      {
                        key: "updated",
                        label: t("Updated At"),
                        children: selected.updatedAt,
                      },
                      {
                        key: "comment",
                        label: t("Comment"),
                        span: 2,
                        children: selected.comment || "-",
                      },
                      {
                        key: "tags",
                        label: t("Tags"),
                        span: 2,
                        children: selected.tags.length
                          ? selected.tags.map((tag) => (
                              <Tag key={tag}>{tag}</Tag>
                            ))
                          : "-",
                      },
                    ]}
                  />
                ),
              },
              {
                key: "fields",
                label: `${t("Fields")} (${selected.columns.length})`,
                children: (
                  <Table
                    rowKey="id"
                    size="small"
                    pagination={false}
                    dataSource={selected.columns}
                    scroll={{ x: 720, y: 520 }}
                    columns={[
                      { title: "#", dataIndex: "ordinal", width: 50 },
                      { title: t("Name"), dataIndex: "name" },
                      { title: t("Raw Type"), dataIndex: "rawType" },
                      {
                        title: t("Normalized Type"),
                        dataIndex: "normalizedType",
                      },
                      {
                        title: t("Nullable"),
                        dataIndex: "nullable",
                        render: (value) => t(value ? "Yes" : "No"),
                      },
                      {
                        title: t("Primary Key"),
                        dataIndex: "primaryKeyOrdinal",
                        render: (value) =>
                          value ? <Tag color="gold">PK {value}</Tag> : "-",
                      },
                      {
                        title: t("Actions"),
                        width: 60,
                        render: (_, row) => (
                          <Button
                            type="text"
                            icon={<EditOutlined />}
                            disabled={!canManage}
                            onClick={() => editObject("column", row)}
                          />
                        ),
                      },
                    ]}
                  />
                ),
              },
              {
                key: "indexes",
                label: `${t("Indexes")} (${selected.indexes.length})`,
                children: (
                  <Table
                    rowKey="id"
                    size="small"
                    pagination={false}
                    dataSource={selected.indexes}
                    locale={{ emptyText: t("No Data") }}
                    columns={[
                      { title: t("Name"), dataIndex: "name" },
                      {
                        title: t("Type"),
                        dataIndex: "unique",
                        render: (value) =>
                          value ? <Tag color="blue">UNIQUE</Tag> : "INDEX",
                      },
                      { title: t("Origin"), dataIndex: "origin" },
                      {
                        title: t("Fields"),
                        dataIndex: "columns",
                        render: (value: string[]) => value.join(", "),
                      },
                    ]}
                  />
                ),
              },
              {
                key: "relations",
                label: `${t("Relations")} (${relations.filter((relation) => relation.sourceTableId === selected.id || relation.targetTableId === selected.id).length})`,
                children: (
                  <Table
                    rowKey="id"
                    size="small"
                    pagination={false}
                    dataSource={relations.filter(
                      (relation) =>
                        relation.sourceTableId === selected.id ||
                        relation.targetTableId === selected.id,
                    )}
                    locale={{ emptyText: t("No Data") }}
                    columns={[
                      {
                        title: t("Source Table"),
                        dataIndex: "sourceTableName",
                      },
                      {
                        title: t("Target Table"),
                        dataIndex: "targetTableName",
                      },
                      { title: t("Origin"), dataIndex: "origin" },
                      { title: t("Status"), dataIndex: "status" },
                      {
                        title: t("Fields"),
                        dataIndex: "columnMappings",
                        render: (value: string[]) => value.join(", ") || "-",
                      },
                    ]}
                  />
                ),
              },
              {
                key: "quality",
                label: `${t("Quality Issues")} (${tableQualityTotal})`,
                children: (
                  <Table
                    rowKey="id"
                    size="small"
                    dataSource={tableQuality}
                    locale={{ emptyText: t("No Data") }}
                    pagination={{
                      current: tableQualityPage,
                      pageSize: 10,
                      total: tableQualityTotal,
                      onChange: (page) =>
                        void loadTableQuality(selected.id, page),
                    }}
                    columns={[
                      { title: t("Object"), dataIndex: "objectName" },
                      { title: t("Rule"), dataIndex: "ruleName" },
                      {
                        title: t("Severity"),
                        dataIndex: "severity",
                        render: (value: string) => (
                          <Tag
                            color={
                              value === "error"
                                ? "red"
                                : value === "warning"
                                  ? "orange"
                                  : "blue"
                            }
                          >
                            {value}
                          </Tag>
                        ),
                      },
                      { title: t("Message"), dataIndex: "message" },
                    ]}
                  />
                ),
              },
              {
                key: "ddl",
                label: t("Raw DDL"),
                children: selected.rawDdl ? (
                  <Typography.Paragraph
                    copyable
                    style={{ whiteSpace: "pre-wrap", fontFamily: "monospace" }}
                  >
                    {selected.rawDdl}
                  </Typography.Paragraph>
                ) : (
                  <Typography.Text type="secondary">
                    {t("No Data")}
                  </Typography.Text>
                ),
              },
            ]}
          />
        )}
      </Drawer>
      <Modal
        width={680}
        title={t(editing ? "Edit Relation" : "New Relation")}
        open={relationOpen}
        onCancel={() => setRelationOpen(false)}
        onOk={saveRelation}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="sourceTableId"
            label={t("Source Table")}
            rules={[{ required: true }]}
          >
            <Select
              showSearch
              options={tableOptions}
              onChange={(value) => {
                form.setFieldValue("columnMappings", []);
                void loadRelationColumns(value, "source");
              }}
            />
          </Form.Item>
          <Form.Item
            name="targetTableId"
            label={t("Target Table")}
            rules={[{ required: true }]}
          >
            <Select
              showSearch
              options={tableOptions}
              onChange={(value) => {
                form.setFieldValue("columnMappings", []);
                void loadRelationColumns(value, "target");
              }}
            />
          </Form.Item>
          <Form.Item
            name="relationType"
            label={t("Relationship Type")}
            rules={[{ required: true }]}
          >
            <Select
              options={[
                "one_to_one",
                "one_to_many",
                "many_to_one",
                "many_to_many",
              ].map((value) => ({ value, label: value }))}
            />
          </Form.Item>
          <Form.List name="columnMappings">
            {(fields, { add, remove }) => (
              <Space direction="vertical" style={{ width: "100%" }}>
                {fields.map((field) => (
                  <Space key={field.key} style={{ display: "flex" }}>
                    <Form.Item
                      {...field}
                      name={[field.name, "sourceColumnId"]}
                      rules={[{ required: true }]}
                    >
                      <Select
                        style={{ width: 220 }}
                        placeholder={t("Source Field")}
                        options={sourceColumns.map((column) => ({
                          value: column.id,
                          label: column.name,
                        }))}
                      />
                    </Form.Item>
                    <span>→</span>
                    <Form.Item
                      {...field}
                      name={[field.name, "targetColumnId"]}
                      rules={[{ required: true }]}
                    >
                      <Select
                        style={{ width: 220 }}
                        placeholder={t("Target Field")}
                        options={targetColumns.map((column) => ({
                          value: column.id,
                          label: column.name,
                        }))}
                      />
                    </Form.Item>
                    <Button
                      danger
                      type="text"
                      icon={<DeleteOutlined />}
                      onClick={() => remove(field.name)}
                    />
                  </Space>
                ))}
                <Button
                  onClick={() => add()}
                  disabled={!sourceColumns.length || !targetColumns.length}
                >
                  {t("Add Field Mapping")}
                </Button>
              </Space>
            )}
          </Form.List>
          <Form.Item name="status" label={t("Status")}>
            <Select
              options={["candidate", "confirmed", "rejected"].map((value) => ({
                value,
                label: value,
              }))}
            />
          </Form.Item>
          <Form.Item name="evidence" label={t("Evidence")}>
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title={t("Edit Notes and Tags")}
        open={Boolean(objectEditing)}
        onCancel={() => setObjectEditing(undefined)}
        onOk={saveObject}
        destroyOnHidden
      >
        <Form form={objectForm} layout="vertical">
          <Form.Item name="comment" label={t("Comment")}>
            <Input.TextArea rows={4} />
          </Form.Item>
          <Form.Item name="tags" label={t("Tags")}>
            <Select
              mode="tags"
              tokenSeparators={[","]}
              placeholder={t("Enter tags")}
            />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
