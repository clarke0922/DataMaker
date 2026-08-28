import { useEffect, useState } from "react";
import {
  Button,
  Alert,
  Card,
  Col,
  Empty,
  Form,
  Input,
  message,
  Modal,
  Progress,
  Row,
  Space,
  Statistic,
  Switch,
  Select,
  Table,
  Tag,
  Typography,
} from "antd";
import {
  CheckCircleOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import type { QualityResultDto, QualityRuleDto } from "@datamaker/contracts";
import { useI18n } from "./i18n";

export function QualityCenterPage({ canManage }: { canManage: boolean }) {
  const { t } = useI18n();
  const [rules, setRules] = useState<QualityRuleDto[]>([]);
  const [results, setResults] = useState<QualityResultDto[]>([]);
  const [issueTotal, setIssueTotal] = useState(0);
  const [issuePage, setIssuePage] = useState(1);
  const [resultsStale, setResultsStale] = useState(false);
  const [loading, setLoading] = useState(false);
  const [task, setTask] =
    useState<import("@datamaker/contracts").QualityTaskDto>();
  const [editingRule, setEditingRule] = useState<QualityRuleDto>();
  const [editingResult, setEditingResult] = useState<QualityResultDto>();
  const [ruleForm] = Form.useForm();
  const [resultForm] = Form.useForm();
  async function load(targetPage = issuePage) {
    setLoading(true);
    const [ruleResult, issueResult] = await Promise.all([
      window.datamaker.quality.listRules(),
      window.datamaker.quality.listResults({ page: targetPage, pageSize: 15 }),
    ]);
    setLoading(false);
    if (ruleResult.ok) setRules(ruleResult.data);
    else message.error(ruleResult.error.message);
    if (issueResult.ok) {
      setResults(issueResult.data.items);
      setIssueTotal(issueResult.data.total);
      setIssuePage(issueResult.data.page);
      setResultsStale(issueResult.data.stale);
    } else message.error(issueResult.error.message);
  }
  useEffect(() => {
    void load();
    void window.datamaker.quality.listTasks().then((result) => {
      if (result.ok) {
        const running = result.data.find(
          (item) => item.status === "running" || item.status === "pending",
        );
        if (running) {
          setTask(running);
          watchTask(running.id, false);
        }
      }
    });
  }, []);
  async function watchTask(id: string, announce = true) {
    const status = await window.datamaker.quality.task(id);
    if (!status.ok) return message.error(status.error.message);
    setTask(status.data);
    if (status.data.status === "running" || status.data.status === "pending")
      return setTimeout(() => watchTask(id, announce), 500);
    if (status.data.status === "completed" && status.data.result) {
      if (announce)
        message.success(
          t("Quality check completed: {count} issues", {
            count: status.data.result.issues,
          }),
        );
      await load();
    } else if (status.data.status === "failed" && announce)
      message.error(status.data.error);
  }
  async function run() {
    const result = await window.datamaker.quality.run();
    if (!result.ok) return message.error(result.error.message);
    setTask(result.data);
    setTimeout(() => watchTask(result.data.id), 300);
  }
  async function cancel() {
    if (!task) return;
    const result = await window.datamaker.quality.cancelTask(task.id);
    if (result.ok) setTask(result.data);
    else message.error(result.error.message);
  }
  async function toggle(rule: QualityRuleDto, enabled: boolean) {
    const result = await window.datamaker.quality.setRuleEnabled(
      rule.id,
      enabled,
    );
    if (!result.ok) return message.error(result.error.message);
    await load();
  }
  function editRule(rule: QualityRuleDto) {
    setEditingRule(rule);
    ruleForm.setFieldsValue({
      enabled: rule.enabled,
      severity: rule.severity,
      namingPattern: rule.config.namingPattern,
      identifierNames: rule.config.identifierNames?.join(", "),
      identifierSuffixes: rule.config.identifierSuffixes?.join(", "),
    });
  }
  async function saveRule() {
    if (!editingRule) return;
    const values = await ruleForm.validateFields();
    const list = (value?: string) =>
      String(value ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    const config =
      editingRule.code === "object-naming"
        ? { namingPattern: values.namingPattern }
        : editingRule.code === "column-required"
          ? {
              identifierNames: list(values.identifierNames),
              identifierSuffixes: list(values.identifierSuffixes),
            }
          : {};
    const result = await window.datamaker.quality.updateRule(editingRule.id, {
      enabled: values.enabled,
      severity: values.severity,
      config,
    });
    if (!result.ok) return message.error(result.error.message);
    message.success(t("Quality rule updated"));
    setEditingRule(undefined);
    await load();
  }
  function editResult(result: QualityResultDto) {
    setEditingResult(result);
    resultForm.setFieldsValue({
      status: result.status === "open" ? "resolved" : result.status,
      resolutionNote: result.resolutionNote ?? "",
    });
  }
  async function saveResult() {
    if (!editingResult) return;
    const values = await resultForm.validateFields();
    const result = await window.datamaker.quality.updateResult(
      editingResult.id,
      values,
    );
    if (!result.ok) return message.error(result.error.message);
    message.success(t("Quality finding updated"));
    setEditingResult(undefined);
    await load();
  }
  const severity = (value: string) => (
    <Tag
      color={
        value === "error" ? "red" : value === "warning" ? "orange" : "blue"
      }
    >
      {t(
        value === "error" ? "Error" : value === "warning" ? "Warning" : "Info",
      )}
    </Tag>
  );
  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      {resultsStale && (
        <Alert
          type="warning"
          showIcon
          message={t(
            "Metadata has changed since the last quality run. Run checks again to refresh these results.",
          )}
        />
      )}
      <Card
        title={
          <div>
            <Typography.Title level={4} style={{ margin: 0 }}>
              {t("Quality Center")}
            </Typography.Title>
            <Typography.Text type="secondary">
              {t(
                "Run built-in metadata checks and review actionable findings.",
              )}
            </Typography.Text>
          </div>
        }
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => load()}>
              {t("Refresh")}
            </Button>
            <Button
              type="primary"
              icon={<SafetyCertificateOutlined />}
              loading={loading}
              disabled={!canManage}
              onClick={run}
            >
              {t("Run Checks")}
            </Button>
          </Space>
        }
      >
        <Row gutter={[16, 16]}>
          <Col xs={24} md={8}>
            <Statistic
              title={t("Enabled Rules")}
              value={rules.filter((rule) => rule.enabled).length}
              prefix={<CheckCircleOutlined />}
            />
          </Col>
          <Col xs={24} md={8}>
            <Statistic
              title={t("Quality Issues")}
              value={issueTotal}
              prefix={<WarningOutlined />}
            />
          </Col>
          <Col xs={24} md={8}>
            <Statistic
              title={t("Error Issues")}
              value={rules
                .filter((rule) => rule.severity === "error")
                .reduce((total, rule) => total + rule.issueCount, 0)}
            />
          </Col>
        </Row>
        {task && (task.status === "running" || task.status === "pending") && (
          <div style={{ marginTop: 16 }}>
            <Space style={{ width: "100%", justifyContent: "space-between" }}>
              <span>{t("Quality check is running")}</span>
              <Button
                danger
                size="small"
                disabled={!canManage}
                onClick={cancel}
              >
                {t("Cancel")}
              </Button>
            </Space>
            <Progress percent={task.progress} status="active" />
          </div>
        )}
      </Card>
      <Card title={t("Quality Rules")}>
        <Table
          rowKey="id"
          loading={loading}
          pagination={false}
          dataSource={rules}
          columns={[
            { title: t("Rule Code"), dataIndex: "code" },
            { title: t("Rule Name"), dataIndex: "name" },
            { title: t("Severity"), dataIndex: "severity", render: severity },
            { title: t("Issue Count"), dataIndex: "issueCount", width: 110 },
            {
              title: t("Enabled"),
              dataIndex: "enabled",
              width: 100,
              render: (value, rule) => (
                <Switch
                  checked={value}
                  disabled={!canManage}
                  onChange={(checked) => toggle(rule, checked)}
                />
              ),
            },
            {
              title: t("Actions"),
              width: 110,
              render: (_, rule) => (
                <Button
                  size="small"
                  icon={<SettingOutlined />}
                  disabled={!canManage}
                  onClick={() => editRule(rule)}
                >
                  {t("Configure")}
                </Button>
              ),
            },
          ]}
        />
      </Card>
      <Card title={t("Quality Findings")}>
        {results.length ? (
          <Table
            rowKey="id"
            dataSource={results}
            pagination={{
              current: issuePage,
              pageSize: 15,
              total: issueTotal,
              showSizeChanger: false,
              onChange: (next) => void load(next),
            }}
            columns={[
              {
                title: t("Severity"),
                dataIndex: "severity",
                width: 100,
                render: severity,
              },
              { title: t("Rule Name"), dataIndex: "ruleName" },
              { title: t("Object Type"), dataIndex: "objectType", width: 120 },
              { title: t("Object Name"), dataIndex: "objectName" },
              { title: t("Finding"), dataIndex: "message" },
              {
                title: t("Status"),
                dataIndex: "status",
                width: 100,
                render: (value) =>
                  t(
                    value === "resolved"
                      ? "Resolved"
                      : value === "ignored"
                        ? "Ignored"
                        : "Pending",
                  ),
              },
              { title: t("Checked At"), dataIndex: "createdAt", width: 190 },
              {
                title: t("Actions"),
                width: 100,
                render: (_, result) => (
                  <Button
                    size="small"
                    disabled={!canManage}
                    onClick={() => editResult(result)}
                  >
                    {t("Process")}
                  </Button>
                ),
              },
            ]}
          />
        ) : (
          <Empty
            description={t(
              "No quality findings. Run checks after importing metadata.",
            )}
          />
        )}
      </Card>
      <Modal
        open={Boolean(editingRule)}
        title={t("Configure Quality Rule")}
        okText={t("Save")}
        cancelText={t("Cancel")}
        onOk={() => void saveRule()}
        onCancel={() => setEditingRule(undefined)}
        destroyOnHidden
      >
        <Form form={ruleForm} layout="vertical">
          <Form.Item
            name="enabled"
            label={t("Enabled")}
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
          <Form.Item
            name="severity"
            label={t("Severity")}
            rules={[{ required: true }]}
          >
            <Select
              options={[
                { value: "info", label: t("Info") },
                { value: "warning", label: t("Warning") },
                { value: "error", label: t("Error") },
              ]}
            />
          </Form.Item>
          {editingRule?.code === "object-naming" && (
            <Form.Item
              name="namingPattern"
              label={t("Naming Regular Expression")}
              rules={[{ required: true, max: 200 }]}
              extra={t("Applied to table and field names")}
            >
              <Input />
            </Form.Item>
          )}
          {editingRule?.code === "column-required" && (
            <>
              <Form.Item
                name="identifierNames"
                label={t("Identifier Field Names")}
                extra={t("Comma-separated values")}
              >
                <Input placeholder="id" />
              </Form.Item>
              <Form.Item
                name="identifierSuffixes"
                label={t("Identifier Field Suffixes")}
                extra={t("Comma-separated values")}
              >
                <Input placeholder="_id" />
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>
      <Modal
        open={Boolean(editingResult)}
        title={t("Process Quality Finding")}
        okText={t("Save")}
        cancelText={t("Cancel")}
        onOk={() => void saveResult()}
        onCancel={() => setEditingResult(undefined)}
        destroyOnHidden
      >
        <Form form={resultForm} layout="vertical">
          <Form.Item
            name="status"
            label={t("Status")}
            rules={[{ required: true }]}
          >
            <Select
              options={[
                { value: "open", label: t("Pending") },
                { value: "resolved", label: t("Resolved") },
                { value: "ignored", label: t("Ignored") },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="resolutionNote"
            label={t("Resolution Note")}
            dependencies={["status"]}
            rules={[
              ({ getFieldValue }) => ({
                required: getFieldValue("status") !== "open",
                max: 1000,
              }),
            ]}
          >
            <Input.TextArea rows={4} maxLength={1000} showCount />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
