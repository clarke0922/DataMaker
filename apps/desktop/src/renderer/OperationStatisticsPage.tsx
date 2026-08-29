import { useEffect, useState } from "react";
import { Button, Card, DatePicker, message, Radio, Space, Table, Tabs, Tag, Typography } from "antd";
import { DownloadOutlined, ReloadOutlined } from "@ant-design/icons";
import type { AuditLogDto, AuditStatisticsRowDto } from "@datamaker/contracts";
import { useI18n } from "./i18n";

const csvCell = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;

export function OperationStatisticsPage() {
  const { t } = useI18n();
  const [groupBy, setGroupBy] = useState<"object" | "user">("object");
  const [range, setRange] = useState<[string, string] | undefined>();
  const [statistics, setStatistics] = useState<AuditStatisticsRowDto[]>([]);
  const [logs, setLogs] = useState<AuditLogDto[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  async function load(targetPage = page, targetGroup = groupBy) {
    setLoading(true);
    const query = { from: range?.[0], to: range?.[1] };
    const [statResult, logResult] = await Promise.all([
      window.datamaker.audit.statistics({ ...query, groupBy: targetGroup }),
      window.datamaker.audit.list({ ...query, page: targetPage, pageSize: 20 }),
    ]);
    setLoading(false);
    if (statResult.ok) setStatistics(statResult.data);
    else message.error(statResult.error.message);
    if (logResult.ok) {
      setLogs(logResult.data.items);
      setTotal(logResult.data.total);
      setPage(logResult.data.page);
    } else message.error(logResult.error.message);
  }
  useEffect(() => void load(), []);

  async function exportCsv() {
    const headers = [t("Group"), t("Create"), t("View"), t("Update"), t("Delete"), t("Other"), t("Total")];
    const content = [headers, ...statistics.map((row) => [row.group, row.created, row.viewed, row.updated, row.deleted, row.other, row.total])]
      .map((row) => row.map(csvCell).join(",")).join("\r\n");
    const result = await window.datamaker.system.saveTextFile("operation-statistics.csv", `\uFEFF${content}`);
    if (!result.ok) message.error(result.error.message);
    else if (result.data) message.success(t("Exported to {path}", { path: result.data }));
  }

  const filters = <Space wrap>
    <DatePicker.RangePicker onChange={(dates) => setRange(dates ? [dates[0]!.startOf("day").toISOString(), dates[1]!.endOf("day").toISOString()] : undefined)} />
    <Radio.Group value={groupBy} onChange={(event) => { setGroupBy(event.target.value); void load(1, event.target.value); }} options={[{ value: "object", label: t("By Object") }, { value: "user", label: t("By User") }]} />
    <Button type="primary" icon={<ReloadOutlined />} onClick={() => void load(1)}>{t("Statistics")}</Button>
    <Button icon={<DownloadOutlined />} onClick={() => void exportCsv()} disabled={!statistics.length}>{t("Export CSV")}</Button>
  </Space>;

  return <Card title={<div><Typography.Title level={4} style={{ margin: 0 }}>{t("Operation Statistics")}</Typography.Title><Typography.Text type="secondary">{t("Summarize auditable operations by object or user.")}</Typography.Text></div>} extra={filters}>
    <Tabs items={[
      { key: "statistics", label: t("Statistics"), children: <Table rowKey="group" loading={loading} dataSource={statistics} pagination={false} summary={(rows) => <Table.Summary.Row><Table.Summary.Cell index={0}><b>{t("Total")}</b></Table.Summary.Cell>{["created", "viewed", "updated", "deleted", "other", "total"].map((key, index) => <Table.Summary.Cell index={index + 1} key={key}><b>{rows.reduce((sum, row) => sum + Number(row[key as keyof AuditStatisticsRowDto]), 0)}</b></Table.Summary.Cell>)}</Table.Summary.Row>} columns={[
        { title: t("Group"), dataIndex: "group" },
        { title: t("Create"), dataIndex: "created" },
        { title: t("View"), dataIndex: "viewed" },
        { title: t("Update"), dataIndex: "updated" },
        { title: t("Delete"), dataIndex: "deleted" },
        { title: t("Other"), dataIndex: "other" },
        { title: t("Total"), dataIndex: "total" },
      ]} /> },
      { key: "details", label: t("Operation Details"), children: <Table rowKey="id" loading={loading} dataSource={logs} pagination={{ current: page, pageSize: 20, total, onChange: (value) => void load(value) }} columns={[
        { title: t("Occurred At"), dataIndex: "occurredAt", width: 190 },
        { title: t("User"), dataIndex: "actorUsername", width: 150, render: (value) => value || "system" },
        { title: t("Action"), dataIndex: "action" },
        { title: t("Object Type"), dataIndex: "objectType" },
        { title: t("Object ID"), dataIndex: "objectId" },
        { title: t("Result"), dataIndex: "result", render: (value) => <Tag color={value === "success" ? "green" : "red"}>{t(value === "success" ? "Success" : "Failure")}</Tag> },
      ]} /> },
    ]} />
  </Card>;
}
