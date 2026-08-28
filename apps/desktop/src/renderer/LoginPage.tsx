import { useEffect, useState, type ReactNode } from "react";
import { Button, Card, Form, Input, message, Spin, Typography } from "antd";
import {
  DatabaseOutlined,
  LockOutlined,
  UserOutlined,
} from "@ant-design/icons";
import type { SessionDto, SystemInfoDto } from "@datamaker/contracts";
import { useI18n } from "./i18n";

export function AuthGate({
  children,
}: {
  children: (session: SessionDto, onLogout: () => void) => ReactNode;
}) {
  const { t } = useI18n();
  const [info, setInfo] = useState<SystemInfoDto>();
  const [session, setSession] = useState<SessionDto>();
  const [loading, setLoading] = useState(true);
  const [form] = Form.useForm();
  useEffect(() => {
    window.datamaker.system.info().then((result) => {
      if (result.ok) setInfo(result.data);
      setLoading(false);
    });
  }, []);
  useEffect(() => {
    if (!session) return;
    const timer = setInterval(() => {
      void window.datamaker.auth.session().then((result) => {
        if (!result.ok || !result.data) {
          setSession(undefined);
          form.resetFields();
          message.warning(t("Your session has expired. Please sign in again."));
        }
      });
    }, 30000);
    return () => clearInterval(timer);
  }, [session?.token, t]);
  async function submit() {
    const values = await form.validateFields();
    const signingIn = info?.initialized === true;
    setLoading(true);
    const result = signingIn
      ? await window.datamaker.auth.login(values)
      : await window.datamaker.auth.initialize({
          ...values,
          displayName: values.displayName,
          status: "active",
          roleIds: [],
        });
    setLoading(false);
    if (!result.ok) return message.error(result.error.message);
    if (!signingIn) {
      await window.datamaker.auth.logout();
      setInfo((current) =>
        current ? { ...current, initialized: true } : current,
      );
      form.resetFields();
      form.setFieldValue("username", values.username);
      message.success(t("Administrator initialized. Sign in to continue."));
      return;
    }
    setSession(result.data);
  }
  async function logout() {
    await window.datamaker.auth.logout();
    setSession(undefined);
    form.resetFields();
  }
  if (loading)
    return (
      <div className="auth-screen">
        <Spin size="large" />
      </div>
    );
  if (session) return <>{children(session, logout)}</>;
  return (
    <div className="auth-screen">
      <Card className="auth-card">
        <div className="auth-brand">
          <DatabaseOutlined />
          <Typography.Title level={2}>DataMaker</Typography.Title>
        </div>
        <Typography.Title level={4}>
          {t(info?.initialized ? "Sign in" : "Initialize Administrator")}
        </Typography.Title>
        <Typography.Paragraph type="secondary">
          {t(
            info?.initialized
              ? "Sign in to continue to the metadata workspace."
              : "Create the first local administrator account.",
          )}
        </Typography.Paragraph>
        <Form form={form} layout="vertical" onFinish={submit}>
          {!info?.initialized && (
            <Form.Item
              name="displayName"
              label={t("Display Name")}
              rules={[{ required: true }]}
            >
              <Input prefix={<UserOutlined />} />
            </Form.Item>
          )}
          <Form.Item
            name="username"
            label={t("Username")}
            rules={[{ required: true }]}
          >
            <Input prefix={<UserOutlined />} autoFocus />
          </Form.Item>
          <Form.Item
            name="password"
            label={t("Password")}
            rules={[{ required: true }, { min: 12 }]}
          >
            <Input.Password prefix={<LockOutlined />} />
          </Form.Item>
          <Button block type="primary" htmlType="submit" loading={loading}>
            {t(info?.initialized ? "Sign in" : "Create Administrator")}
          </Button>
        </Form>
      </Card>
    </div>
  );
}
