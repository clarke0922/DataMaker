import { useEffect, useMemo, useState, type Key } from "react";
import {
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  Statistic,
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
import type { ManagementRecordDto } from "@datamaker/contracts";
import { useI18n } from "./i18n";

export type CountPeriod = "day" | "week" | "month";

function dateKey(date: string, period: CountPeriod) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
  if (period === "day") return date;
  if (period === "month") return date.slice(0, 7);
  const value = new Date(`${date}T00:00:00Z`);
  const day = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() - day + 1);
  return value.toISOString().slice(0, 10);
}

function localToday() {
  const value = new Date();
  value.setMinutes(value.getMinutes() - value.getTimezoneOffset());
  return value.toISOString().slice(0, 10);
}

export function aggregateDailyCounts(
  records: ManagementRecordDto[],
  period: CountPeriod,
  selectedDate: string,
) {
  const selectedKey = dateKey(selectedDate, period);
  const grouped = new Map<
    string,
    {
      table_name: string;
      daily_increase: number;
      total_count: number;
      records: number;
      latest: string;
    }
  >();
  for (const record of records) {
    const date = String(record.stat_date ?? "").slice(0, 10);
    if (dateKey(date, period) !== selectedKey) continue;
    const name = String(record.table_name);
    const current = grouped.get(name) ?? {
      table_name: name,
      daily_increase: 0,
      total_count: 0,
      records: 0,
      latest: "",
    };
    current.daily_increase += Number(record.daily_increase ?? 0);
    current.records += 1;
    if (date >= current.latest) {
      current.latest = date;
      current.total_count = Number(record.total_count ?? 0);
    }
    grouped.set(name, current);
  }
  return [...grouped.values()].sort((left, right) =>
    left.table_name.localeCompare(right.table_name),
  );
}

export function DailyCountsPage({ canManage }: { canManage: boolean }) {
  const { t } = useI18n();
  const [records, setRecords] = useState<ManagementRecordDto[]>([]);
  const [tables, setTables] = useState<ManagementRecordDto[]>([]);
  const [period, setPeriod] = useState<CountPeriod>("day");
  const [selectedDate, setSelectedDate] = useState(localToday);
  const [selectedRows, setSelectedRows] = useState<Key[]>([]);
  const [editing, setEditing] = useState<ManagementRecordDto>();
  const [viewing, setViewing] = useState<ManagementRecordDto>();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();

  async function load() {
    setLoading(true);
    const [countResult, tableResult] = await Promise.all([
      window.datamaker.management.list("dailyCounts"),
      window.datamaker.management.list("tables"),
    ]);
    setLoading(false);
    if (countResult.ok) setRecords(countResult.data);
    else message.error(countResult.error.message);
    if (tableResult.ok) setTables(tableResult.data);
  }

  useEffect(() => {
    void load();
  }, []);

  function edit(record?: ManagementRecordDto) {
    setEditing(record);
    form.setFieldsValue(
      record ?? {
        stat_date: selectedDate,
        daily_increase: 0,
        total_count: 0,
      },
    );
    setOpen(true);
  }

  async function save() {
    const values = await form.validateFields();
    const result = await window.datamaker.management.save("dailyCounts", {
      id: editing?.id,
      values,
    });
    if (!result.ok) return message.error(result.error.message);
    message.success(t(editing ? "Saved" : "Created"));
    setOpen(false);
    await load();
  }

  async function remove(ids: string[]) {
    for (const id of ids) {
      const result = await window.datamaker.management.remove(
        "dailyCounts",
        id,
      );
      if (!result.ok) return message.error(result.error.message);
    }
    setSelectedRows([]);
    message.success(t("Deleted"));
    await load();
  }

  const detailRecords = useMemo(
    () =>
      records.filter(
        (record) =>
          dateKey(String(record.stat_date).slice(0, 10), period) ===
          dateKey(selectedDate, period),
      ),
    [records, period, selectedDate],
  );
  const summary = useMemo(
    () => aggregateDailyCounts(records, period, selectedDate),
    [records, period, selectedDate],
  );

  return (
    <Card
      title={
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {t("Daily Table Count Management")}
          </Typography.Title>
          <Typography.Text type="secondary">
            {t(
              "Monitor table increments and cumulative totals by day, week, or month.",
            )}
          </Typography.Text>
        </div>
      }
      extra={
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>
            {t("Refresh")}
          </Button>
          <Popconfirm
            title={t("Delete selected records?")}
            disabled={!selectedRows.length}
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
            onClick={() => edit()}
          >
            {t("New")}
          </Button>
        </Space>
      }
    >
      <Space wrap style={{ marginBottom: 16 }}>
        <Radio.Group
          value={period}
          onChange={(event) => setPeriod(event.target.value)}
        >
          <Radio.Button value="day">{t("By Day")}</Radio.Button>
          <Radio.Button value="week">{t("By Week")}</Radio.Button>
          <Radio.Button value="month">{t("By Month")}</Radio.Button>
        </Radio.Group>
        <Input
          type="date"
          value={selectedDate}
          max={localToday()}
          onChange={(event) => setSelectedDate(event.target.value)}
        />
        <Button
          onClick={() => {
            setPeriod("day");
            setSelectedDate(localToday());
          }}
        >
          {t("Reset")}
        </Button>
      </Space>

      <Space size="large" wrap style={{ marginBottom: 16 }}>
        <Statistic title={t("Monitored Tables")} value={summary.length} />
        <Statistic
          title={t("Period Increase")}
          value={summary.reduce((total, row) => total + row.daily_increase, 0)}
          valueStyle={{
            color:
              summary.reduce((total, row) => total + row.daily_increase, 0) < 0
                ? "#cf1322"
                : "#3f8600",
          }}
        />
        <Statistic
          title={t("Latest Total")}
          value={summary.reduce((total, row) => total + row.total_count, 0)}
        />
      </Space>

      <Typography.Title level={5}>{t("Period Summary")}</Typography.Title>
      <Table
        rowKey="table_name"
        pagination={false}
        dataSource={summary}
        columns={[
          { title: t("Table Name"), dataIndex: "table_name" },
          {
            title: t("Period Increase"),
            dataIndex: "daily_increase",
            render: (value: number) => (
              <Typography.Text
                type={value < 0 ? "danger" : value > 0 ? "success" : undefined}
              >
                {value}
              </Typography.Text>
            ),
          },
          { title: t("Latest Total"), dataIndex: "total_count" },
          { title: t("Latest Statistics Date"), dataIndex: "latest" },
          { title: t("Record Count"), dataIndex: "records" },
        ]}
        style={{ marginBottom: 20 }}
      />

      <Typography.Title level={5}>{t("Detailed Records")}</Typography.Title>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={detailRecords}
        rowSelection={{
          selectedRowKeys: selectedRows,
          onChange: setSelectedRows,
        }}
        pagination={{ pageSize: 20, showSizeChanger: false }}
        columns={[
          { title: t("Table Name"), dataIndex: "table_name" },
          {
            title: t("Daily Increase"),
            dataIndex: "daily_increase",
            render: (value: number) => (
              <Tag color={value < 0 ? "red" : value > 0 ? "green" : "default"}>
                {value}
              </Tag>
            ),
          },
          { title: t("Total Count"), dataIndex: "total_count" },
          { title: t("Statistics Date"), dataIndex: "stat_date" },
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
      />

      <Modal
        title={t(editing ? "Edit Count Record" : "New Count Record")}
        open={open}
        onOk={() => void save()}
        onCancel={() => setOpen(false)}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item name="table_id" label={t("Managed Table")}>
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              options={tables.map((table) => ({
                value: table.id,
                label: `${table.display_name} (${table.name})`,
              }))}
              onChange={(id) => {
                const table = tables.find((item) => item.id === id);
                if (table) form.setFieldValue("table_name", table.name);
              }}
            />
          </Form.Item>
          <Form.Item
            name="table_name"
            label={t("Table Name")}
            rules={[{ required: true }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="daily_increase"
            label={t("Daily Increase")}
            rules={[{ required: true }]}
          >
            <InputNumber precision={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item
            name="total_count"
            label={t("Total Count")}
            rules={[{ required: true }]}
          >
            <InputNumber min={0} precision={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item
            name="stat_date"
            label={t("Statistics Date")}
            rules={[{ required: true }]}
          >
            <Input type="date" max={localToday()} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={t("Count Record Details")}
        open={Boolean(viewing)}
        footer={null}
        onCancel={() => setViewing(undefined)}
      >
        {viewing && (
          <Descriptions bordered column={2}>
            <Descriptions.Item label={t("Table Name")}>
              {String(viewing.table_name)}
            </Descriptions.Item>
            <Descriptions.Item label={t("Statistics Date")}>
              {String(viewing.stat_date)}
            </Descriptions.Item>
            <Descriptions.Item label={t("Daily Increase")}>
              {String(viewing.daily_increase)}
            </Descriptions.Item>
            <Descriptions.Item label={t("Total Count")}>
              {String(viewing.total_count)}
            </Descriptions.Item>
          </Descriptions>
        )}
      </Modal>
    </Card>
  );
}
