import { useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  List,
  message,
  Modal,
  Progress,
  Row,
  Space,
  Statistic,
  Tag,
  Typography,
} from "antd";
import type { BadgeProps } from "antd";
import {
  ArrowRightOutlined,
  DatabaseOutlined,
  FieldNumberOutlined,
  ImportOutlined,
  LockOutlined,
  SafetyCertificateOutlined,
  TableOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import type {
  MetadataStatsDto,
  SystemInfoDto,
  UpdateStatusDto,
} from "@datamaker/contracts";
import { useI18n } from "./i18n";

interface Props {
  info?: SystemInfoDto;
  stats: MetadataStatsDto;
  onNavigate(key: string): void;
}

export function WelcomePage({ info, stats, onNavigate }: Props) {
  const { t } = useI18n();
  const [update, setUpdate] = useState<UpdateStatusDto>();
  async function checkUpdate() {
    const result = await window.datamaker.system.checkForUpdates();
    if (!result.ok) return message.error(result.error.message);
    setUpdate(result.data);
    if (result.data.state === "up_to_date")
      return message.success(t("DataMaker is up to date"));
    if (["checking", "available", "downloading"].includes(result.data.state))
      setTimeout(() => void pollUpdate(), 800);
  }
  async function pollUpdate() {
    const result = await window.datamaker.system.updateStatus();
    if (!result.ok) return message.error(result.error.message);
    setUpdate(result.data);
    if (["checking", "available", "downloading"].includes(result.data.state))
      return setTimeout(() => void pollUpdate(), 800);
    if (result.data.state === "error")
      return message.error(result.data.error || t("Update check failed"));
    if (result.data.state === "downloaded")
      Modal.confirm({
        title: t("Update ready"),
        content: t(
          "Version {version} has been downloaded. Restart and install now?",
          {
            version: result.data.version ?? "",
          },
        ),
        okText: t("Restart and Install"),
        onOk: () => window.datamaker.system.installUpdate(),
      });
  }
  const notices: Array<{
    key: string;
    title: string;
    count: number;
    description: string;
    color: BadgeProps["status"];
  }> = [
    {
      key: "quality",
      title: t("Metadata quality issues"),
      count: stats.qualityIssues,
      description: t(
        "Review validation findings and improve metadata completeness.",
      ),
      color: stats.qualityIssues ? "error" : "success",
    },
    {
      key: "imports",
      title: t("External metadata import"),
      count: 0,
      description: t("Import metadata from SQL or SQLite files."),
      color: "processing" as const,
    },
    {
      key: "privateTables",
      title: t("Private table governance"),
      count: 0,
      description: t("Review private tables and their ownership."),
      color: "default" as const,
    },
  ];
  const shortcuts = [
    {
      key: "imports",
      title: t("External Import"),
      description: t("Scan SQL or SQLite metadata"),
      icon: <ImportOutlined />,
    },
    {
      key: "tables",
      title: t("Data Tables"),
      description: t("Maintain table definitions"),
      icon: <TableOutlined />,
    },
    {
      key: "quality",
      title: t("Quality Center"),
      description: t("Run metadata quality checks"),
      icon: <SafetyCertificateOutlined />,
    },
    {
      key: "users",
      title: t("User Management"),
      description: t("Manage local accounts and roles"),
      icon: <TeamOutlined />,
    },
  ];
  const resources = [
    {
      title: t("Metadata Management"),
      description: t(
        "Tables, dictionaries, factors, categories, and relationships",
      ),
      key: "tables",
    },
    {
      title: t("System Management"),
      description: t("Users, roles, permissions, and local access control"),
      key: "users",
    },
    {
      title: t("Data Sources"),
      description: t("Register and scan local SQLite metadata sources."),
      key: "sources",
    },
  ];

  return (
    <div className="welcome-page">
      <div className="welcome-hero">
        <div>
          <Typography.Text className="welcome-kicker">
            DATAMAKER
          </Typography.Text>
          <Typography.Title level={2}>
            {t("Welcome to Metadata Workspace")}
          </Typography.Title>
          <Typography.Paragraph>
            {t(
              "Manage metadata, quality, and local access control from one desktop workspace.",
            )}
          </Typography.Paragraph>
        </div>
        <DatabaseOutlined className="welcome-hero-icon" />
      </div>

      {!info?.initialized && (
        <Alert
          className="welcome-alert"
          type="warning"
          showIcon
          message={t("The administrator account has not been initialized")}
          description={t(
            "Create the first administrator account from User Management.",
          )}
          action={
            <Button onClick={() => onNavigate("users")}>
              {t("Open User Management")}
            </Button>
          }
        />
      )}

      <Row gutter={[16, 16]} className="welcome-stats">
        {[
          [t("Data Sources"), stats.sources, <DatabaseOutlined />],
          [t("Data Tables"), stats.tables, <TableOutlined />],
          [t("Fields"), stats.columns, <FieldNumberOutlined />],
          [t("Relations"), stats.relations, <SafetyCertificateOutlined />],
        ].map(([title, value, icon]) => (
          <Col xs={24} sm={12} xl={6} key={String(title)}>
            <Card className="metric-card">
              <Statistic title={title} value={value as number} prefix={icon} />
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={9}>
          <Card title={t("System Reminders")} className="welcome-panel">
            <List
              dataSource={notices}
              renderItem={(item) => (
                <List.Item
                  className="reminder-item"
                  onClick={() => onNavigate(item.key)}
                  actions={[<ArrowRightOutlined key="arrow" />]}
                >
                  <List.Item.Meta
                    avatar={<Badge status={item.color} />}
                    title={item.title}
                    description={item.description}
                  />
                  <Tag>{item.count}</Tag>
                </List.Item>
              )}
            />
          </Card>
          <Card
            title={t("Metadata Readiness")}
            className="welcome-panel readiness-panel"
          >
            <Space direction="vertical" size="large" style={{ width: "100%" }}>
              <div>
                <div className="progress-label">
                  <span>{t("Table coverage")}</span>
                  <span>{stats.tables ? "100%" : "0%"}</span>
                </div>
                <Progress percent={stats.tables ? 100 : 0} showInfo={false} />
              </div>
              <div>
                <div className="progress-label">
                  <span>{t("Relationship coverage")}</span>
                  <span>
                    {stats.tables
                      ? `${Math.min(100, Math.round((stats.relations / stats.tables) * 100))}%`
                      : "0%"}
                  </span>
                </div>
                <Progress
                  percent={
                    stats.tables
                      ? Math.min(
                          100,
                          Math.round((stats.relations / stats.tables) * 100),
                        )
                      : 0
                  }
                  showInfo={false}
                  strokeColor="#14b8a6"
                />
              </div>
            </Space>
          </Card>
          <Card title={t("Application Update")} className="welcome-panel">
            <Space direction="vertical" style={{ width: "100%" }}>
              <Typography.Text type="secondary">
                {t("Current version: {version}", {
                  version: info?.version ?? "-",
                })}
              </Typography.Text>
              {update?.state === "downloading" && (
                <Progress percent={update.progress} />
              )}
              <Button
                onClick={checkUpdate}
                loading={update?.state === "checking"}
              >
                {t("Check for Updates")}
              </Button>
            </Space>
          </Card>
        </Col>

        <Col xs={24} xl={15}>
          <Card title={t("Quick Access")} className="welcome-panel">
            <Row gutter={[12, 12]}>
              {shortcuts.map((item) => (
                <Col xs={24} sm={12} key={item.key}>
                  <button
                    className="shortcut-card"
                    onClick={() => onNavigate(item.key)}
                  >
                    <span className="shortcut-icon">{item.icon}</span>
                    <span>
                      <strong>{item.title}</strong>
                      <small>{item.description}</small>
                    </span>
                    <ArrowRightOutlined />
                  </button>
                </Col>
              ))}
            </Row>
          </Card>
          <Card title={t("Resource Navigation")} className="welcome-panel">
            <List
              dataSource={resources}
              renderItem={(item) => (
                <List.Item
                  actions={[
                    <Button
                      key="open"
                      type="link"
                      onClick={() => onNavigate(item.key)}
                    >
                      {t("Open")}
                    </Button>,
                  ]}
                >
                  <List.Item.Meta
                    title={item.title}
                    description={item.description}
                  />
                </List.Item>
              )}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
