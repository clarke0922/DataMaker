import { useEffect, useState } from "react";
import {
  Button,
  Card,
  Form,
  Input,
  List,
  message,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import {
  DeleteOutlined,
  SaveOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import type { SavedQueryDto, SearchHitDto } from "@datamaker/contracts";
import { useI18n } from "./i18n";
export function GlobalSearchPage() {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHitDto[]>([]);
  const [saved, setSaved] = useState<SavedQueryDto[]>([]);
  const [saveOpen, setSaveOpen] = useState(false);
  const [form] = Form.useForm();
  async function loadSaved() {
    const result = await window.datamaker.metadata.listSavedQueries();
    if (result.ok) setSaved(result.data);
    else message.error(result.error.message);
  }
  useEffect(() => {
    void loadSaved();
  }, []);
  async function search(value = query) {
    setQuery(value);
    const result = await window.datamaker.metadata.search(value);
    if (result.ok) setHits(result.data);
    else message.error(result.error.message);
  }
  async function save() {
    const values = await form.validateFields();
    const result = await window.datamaker.metadata.saveQuery(
      values.name,
      query,
    );
    if (!result.ok) return message.error(result.error.message);
    message.success(t("Saved"));
    setSaveOpen(false);
    await loadSaved();
  }
  async function remove(id: string) {
    const result = await window.datamaker.metadata.removeSavedQuery(id);
    if (!result.ok) return message.error(result.error.message);
    await loadSaved();
  }
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card
        title={
          <div>
            <Typography.Title level={4} style={{ margin: 0 }}>
              {t("Global Search")}
            </Typography.Title>
            <Typography.Text type="secondary">
              {t("Search table names, fields, comments, paths, and tags.")}
            </Typography.Text>
          </div>
        }
      >
        <Space.Compact style={{ width: "100%" }}>
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onPressEnter={() => search()}
            prefix={<SearchOutlined />}
            placeholder={t("Search tables, fields, comments, or tags")}
          />
          <Button type="primary" onClick={() => search()}>
            {t("Search")}
          </Button>
          <Button
            icon={<SaveOutlined />}
            disabled={!query.trim()}
            onClick={() => setSaveOpen(true)}
          >
            {t("Save Query")}
          </Button>
        </Space.Compact>
        <Table
          className="results"
          rowKey="id"
          pagination={{ pageSize: 15 }}
          dataSource={hits}
          columns={[
            {
              title: t("Type"),
              dataIndex: "objectType",
              width: 100,
              render: (value) => (
                <Tag>{t(value === "table" ? "Table" : "Field")}</Tag>
              ),
            },
            { title: t("Name"), dataIndex: "name" },
            { title: t("Path"), dataIndex: "path" },
            { title: t("Comment"), dataIndex: "comment" },
          ]}
        />
      </Card>
      <Card title={t("Saved Queries")}>
        <List
          dataSource={saved}
          locale={{ emptyText: t("No saved queries") }}
          renderItem={(item) => (
            <List.Item
              actions={[
                <Button
                  key="run"
                  type="link"
                  onClick={() => search(item.query)}
                >
                  {t("Run")}
                </Button>,
                <Popconfirm
                  key="delete"
                  title={t("Delete this record?")}
                  onConfirm={() => remove(item.id)}
                >
                  <Button danger type="text" icon={<DeleteOutlined />} />
                </Popconfirm>,
              ]}
            >
              <List.Item.Meta title={item.name} description={item.query} />
            </List.Item>
          )}
        />
      </Card>
      <Modal
        title={t("Save Query")}
        open={saveOpen}
        onCancel={() => setSaveOpen(false)}
        onOk={save}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label={t("Name")} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label={t("Query")}>
            <Input value={query} disabled />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
