import React, { lazy, Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Alert,
  App as AntApp,
  Button,
  ConfigProvider,
  Layout,
  Menu,
  Card,
  Typography,
  Input,
  Table,
  Tag,
  Select,
  Segmented,
  Spin,
  theme,
} from "antd";
import enUS from "antd/locale/en_US";
import zhCN from "antd/locale/zh_CN";
import {
  ApartmentOutlined,
  BarChartOutlined,
  BookOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  DeploymentUnitOutlined,
  ImportOutlined,
  KeyOutlined,
  LockOutlined,
  PercentageOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  SettingOutlined,
  TableOutlined,
  TagsOutlined,
  TeamOutlined,
  UserOutlined,
  MoonOutlined,
  SunOutlined,
} from "@ant-design/icons";
import type {
  ManagementModule,
  MetadataStatsDto,
  SearchHitDto,
  SessionDto,
  SystemInfoDto,
} from "@datamaker/contracts";
import "antd/dist/reset.css";
import "./style.css";
import { getManagementSpecs } from "./managementSpecs";
import { I18nProvider, useI18n } from "./i18n";
import { WelcomePage } from "./WelcomePage";
import { AuthGate } from "./LoginPage";
const ManagementPage = lazy(() =>
  import("./ManagementPage").then((module) => ({
    default: module.ManagementPage,
  })),
);
const FactorManagementPage = lazy(() =>
  import("./FactorManagementPage").then((module) => ({
    default: module.FactorManagementPage,
  })),
);
const TableManagementPage = lazy(() =>
  import("./TableManagementPage").then((module) => ({
    default: module.TableManagementPage,
  })),
);
const DailyCountsPage = lazy(() =>
  import("./DailyCountsPage").then((module) => ({
    default: module.DailyCountsPage,
  })),
);
const OrganizationManagementPage = lazy(() =>
  import("./OrganizationManagementPage").then((module) => ({
    default: module.OrganizationManagementPage,
  })),
);
const OperationStatisticsPage = lazy(() =>
  import("./OperationStatisticsPage").then((module) => ({
    default: module.OperationStatisticsPage,
  })),
);
const CategoryManagementPage = lazy(() =>
  import("./CategoryManagementPage").then((module) => ({
    default: module.CategoryManagementPage,
  })),
);
const SystemTypeManagementPage = lazy(() =>
  import("./SystemTypeManagementPage").then((module) => ({
    default: module.SystemTypeManagementPage,
  })),
);
const ProfilePage = lazy(() =>
  import("./ProfilePage").then((module) => ({ default: module.ProfilePage })),
);
const AccessManagementPage = lazy(() =>
  import("./AccessManagementPage").then((module) => ({
    default: module.AccessManagementPage,
  })),
);
const DictionaryManagementPage = lazy(() =>
  import("./DictionaryManagementPage").then((module) => ({
    default: module.DictionaryManagementPage,
  })),
);
const QualityCenterPage = lazy(() =>
  import("./QualityCenterPage").then((module) => ({
    default: module.QualityCenterPage,
  })),
);
const DataSourcesPage = lazy(() =>
  import("./DataSourcesPage").then((module) => ({
    default: module.DataSourcesPage,
  })),
);
const MetadataExplorerPage = lazy(() =>
  import("./MetadataExplorerPage").then((module) => ({
    default: module.MetadataExplorerPage,
  })),
);
const AuditPage = lazy(() =>
  import("./AuditPage").then((module) => ({ default: module.AuditPage })),
);
const GlobalSearchPage = lazy(() =>
  import("./GlobalSearchPage").then((module) => ({
    default: module.GlobalSearchPage,
  })),
);

const EMPTY: MetadataStatsDto = {
  sources: 0,
  tables: 0,
  columns: 0,
  relations: 0,
  qualityIssues: 0,
};
type AppTheme = "dark" | "light";

function Workspace({
  appTheme,
  setAppTheme,
  session,
  onLogout,
}: {
  appTheme: AppTheme;
  setAppTheme(value: AppTheme): void;
  session: SessionDto;
  onLogout(): void;
}) {
  const { locale, setLocale, t } = useI18n();
  const [info, setInfo] = useState<SystemInfoDto>();
  const [stats, setStats] = useState(EMPTY);
  const [hits, setHits] = useState<SearchHitDto[]>([]);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string>("dashboard");
  const [currentUser, setCurrentUser] = useState(session.user);
  const specs = getManagementSpecs(t);
  const can = (permission: string) => session.permissions.includes(permission);
  const canReadMetadata = can("metadata:read");
  const canManageMetadata = can("metadata:manage");
  const metadataChildren = [
    { key: "weights", icon: <PercentageOutlined />, label: t("Weight Scores") },
    {
      key: "dictionaries",
      icon: <BookOutlined />,
      label: t("Dictionary Data"),
    },
    {
      key: "dictionaryTree",
      icon: <ApartmentOutlined />,
      label: t("Tree Dictionary"),
    },
    { key: "factors", icon: <DeploymentUnitOutlined />, label: t("Factors") },
    ...(can("metadata:import")
      ? [
          {
            key: "imports",
            icon: <ImportOutlined />,
            label: t("External Import"),
          },
        ]
      : []),
    { key: "tables", icon: <TableOutlined />, label: t("Data Tables") },
    {
      key: "privateTables",
      icon: <LockOutlined />,
      label: t("Private Tables"),
    },
    {
      key: "dailyCounts",
      icon: <BarChartOutlined />,
      label: t("Daily Counts"),
    },
    { key: "cubes", icon: <ApartmentOutlined />, label: t("Data Cubes") },
    { key: "categories", icon: <TagsOutlined />, label: t("Table Types") },
  ];
  const systemChildren = [
    ...(canReadMetadata
      ? [
          {
            key: "systemTypes",
            icon: <TagsOutlined />,
            label: t("System Types"),
          },
        ]
      : []),
    ...(can("system:user_manage")
      ? [
          { key: "organizations", icon: <ApartmentOutlined />, label: t("Organization Management") },
          { key: "users", icon: <UserOutlined />, label: t("User Management") },
          { key: "operationStatistics", icon: <BarChartOutlined />, label: t("Operation Statistics") },
        ]
      : []),
    ...(can("system:user_manage") || can("export:create")
      ? [
          {
            key: "audit",
            icon: <SafetyCertificateOutlined />,
            label: t("Audit and Export"),
          },
        ]
      : []),
    ...(can("system:role_manage")
      ? [{ key: "roles", icon: <TeamOutlined />, label: t("Role Management") }]
      : []),
    ...(can("system:permission_manage")
      ? [
          {
            key: "permissions",
            icon: <KeyOutlined />,
            label: t("Permission Management"),
          },
        ]
      : []),
  ];

  useEffect(() => {
    Promise.all([
      window.datamaker.system.info(),
      window.datamaker.metadata.stats(),
    ])
      .then(([system, metadata]) => {
        if (system.ok) setInfo(system.data);
        else setError(system.error.message);
        if (metadata.ok) setStats(metadata.data);
        else setError(metadata.error.message);
      })
      .catch(() =>
        setError(t("Unable to connect to the main process service")),
      );
  }, [t]);

  async function search(value: string) {
    const result = await window.datamaker.metadata.search(value);
    if (result.ok) setHits(result.data);
    else setError(result.error.message);
  }

  return (
    <Layout className="shell">
      <Layout.Sider width={224} theme={appTheme} className="sider">
        <div className="brand">
          <DatabaseOutlined /> DataMaker
        </div>
        <Menu
          mode="inline"
          selectedKeys={[selected]}
          onSelect={({ key }) => setSelected(key)}
          items={[
            {
              key: "dashboard",
              icon: <DashboardOutlined />,
              label: t("Dashboard"),
            },
            ...(can("metadata:import")
              ? [
                  {
                    key: "sources",
                    icon: <DatabaseOutlined />,
                    label: t("Data Sources"),
                  },
                ]
              : []),
            ...(canReadMetadata
              ? [
                  {
                    key: "explorer",
                    icon: <SearchOutlined />,
                    label: t("Metadata Browser"),
                  },
                  {
                    key: "search",
                    icon: <SearchOutlined />,
                    label: t("Global Search"),
                  },
                  {
                    key: "relations",
                    icon: <DeploymentUnitOutlined />,
                    label: t("Relationship Management"),
                  },
                  {
                    key: "metadata",
                    icon: <DatabaseOutlined />,
                    label: t("Metadata Management"),
                    children: metadataChildren,
                  },
                  {
                    key: "quality",
                    icon: <SafetyCertificateOutlined />,
                    label: t("Quality Center"),
                  },
                ]
              : []),
            ...(systemChildren.length
              ? [
                  {
                    key: "settings",
                    icon: <SettingOutlined />,
                    label: t("System Management"),
                    children: systemChildren,
                  },
                ]
              : []),
          ]}
        />
      </Layout.Sider>
      <Layout>
        <Layout.Header className="header">
          <Typography.Title level={4}>
            {selected in specs
              ? specs[selected as ManagementModule].title
                : ["users", "roles", "permissions", "operationStatistics"].includes(selected)
                  ? t(
                    selected === "users"
                      ? "User Management"
                      : selected === "operationStatistics"
                        ? "Operation Statistics"
                      : selected === "roles"
                        ? "Role Management"
                        : "Permission Management",
                  )
                : t("Metadata Workspace")}
          </Typography.Title>
          <div className="header-actions">
            <Tag color="blue">{t("Local mode")}</Tag>
            <Segmented
              aria-label={t("Theme")}
              value={appTheme}
              onChange={(value) => setAppTheme(value as AppTheme)}
              options={[
                { value: "dark", label: t("Dark"), icon: <MoonOutlined /> },
                { value: "light", label: t("Light"), icon: <SunOutlined /> },
              ]}
            />
            <Select
              aria-label={t("Language")}
              value={locale}
              onChange={setLocale}
              style={{ width: 112 }}
              options={[
                { value: "en-US", label: t("English") },
                { value: "zh-CN", label: t("Chinese") },
              ]}
            />
            <Button
              type="text"
              icon={<UserOutlined />}
              onClick={() => setSelected("profile")}
            >
              {currentUser.displayName}
            </Button>
            <Button type="text" onClick={onLogout}>
              {t("Sign out")}
            </Button>
          </div>
        </Layout.Header>
        <Layout.Content className="content">
          {error && (
            <Alert
              closable
              onClose={() => setError("")}
              type="error"
              message={error}
            />
          )}
          <Suspense
            fallback={
              <div
                style={{
                  display: "grid",
                  placeItems: "center",
                  minHeight: 300,
                }}
              >
                <Spin size="large" />
              </div>
            }
          >
            {selected === "profile" ? (
              <ProfilePage
                user={currentUser}
                onUpdated={setCurrentUser}
                onPasswordChanged={onLogout}
              />
            ) : selected === "search" ? (
              <GlobalSearchPage />
            ) : selected === "audit" ? (
              <AuditPage
                canAudit={can("system:user_manage")}
                canExport={can("export:create")}
                canReadMetadata={canReadMetadata}
              />
            ) : selected === "explorer" || selected === "relations" ? (
              <MetadataExplorerPage
                initialTab={selected === "relations" ? "relations" : "tables"}
                canManage={canManageMetadata}
              />
            ) : selected === "sources" ? (
              <DataSourcesPage />
            ) : selected === "quality" ? (
              <QualityCenterPage canManage={can("quality:manage")} />
            ) : selected === "dictionaries" || selected === "dictionaryTree" ? (
              <DictionaryManagementPage
                preferredType={selected === "dictionaryTree" ? "tree" : "list"}
                canManage={canManageMetadata}
              />
            ) : selected === "factors" ? (
              <FactorManagementPage canManage={canManageMetadata} />
            ) : selected === "tables" || selected === "privateTables" ? (
              <TableManagementPage
                privateOnly={selected === "privateTables"}
                canManage={canManageMetadata}
              />
            ) : selected === "dailyCounts" ? (
              <DailyCountsPage canManage={canManageMetadata} />
            ) : selected === "categories" ? (
              <CategoryManagementPage canManage={canManageMetadata} />
            ) : selected === "systemTypes" ? (
              <SystemTypeManagementPage canManage={canManageMetadata} />
            ) : selected === "organizations" ? (
              <OrganizationManagementPage canManage={can("system:user_manage")} />
            ) : selected === "operationStatistics" ? (
              <OperationStatisticsPage />
            ) : selected in specs ? (
              <ManagementPage
                module={selected as ManagementModule}
                canManage={canManageMetadata}
              />
            ) : ["users", "roles", "permissions"].includes(selected) ? (
              <AccessManagementPage
                section={selected as "users" | "roles" | "permissions"}
                currentUserId={session.user.id}
                onSessionInvalidated={onLogout}
              />
            ) : (
              <WelcomePage info={info} stats={stats} onNavigate={setSelected} />
            )}
          </Suspense>
        </Layout.Content>
      </Layout>
    </Layout>
  );
}

function LocalizedApp() {
  const { locale } = useI18n();
  const [appTheme, setAppThemeState] = useState<AppTheme>(() =>
    localStorage.getItem("datamaker.theme") === "light" ? "light" : "dark",
  );
  function setAppTheme(value: AppTheme) {
    localStorage.setItem("datamaker.theme", value);
    document.documentElement.dataset.theme = value;
    setAppThemeState(value);
  }
  useEffect(() => {
    document.documentElement.dataset.theme = appTheme;
  }, [appTheme]);
  return (
    <ConfigProvider
      locale={locale === "zh-CN" ? zhCN : enUS}
      theme={{
        algorithm:
          appTheme === "dark" ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: { colorPrimary: "#3b82f6", borderRadius: 8 },
      }}
    >
      <AntApp>
        <AuthGate>
          {(session, onLogout) => (
            <Workspace
              appTheme={appTheme}
              setAppTheme={setAppTheme}
              session={session}
              onLogout={onLogout}
            />
          )}
        </AuthGate>
      </AntApp>
    </ConfigProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <I18nProvider>
      <LocalizedApp />
    </I18nProvider>
  </React.StrictMode>,
);
