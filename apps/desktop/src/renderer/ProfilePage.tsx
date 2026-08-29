import { useState } from "react";
import {
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  message,
  Modal,
  Radio,
  Space,
  Typography,
} from "antd";
import { EditOutlined, KeyOutlined } from "@ant-design/icons";
import type { UserDto } from "@datamaker/contracts";
import { useI18n } from "./i18n";

export function ProfilePage({
  user,
  onUpdated,
  onPasswordChanged,
}: {
  user: UserDto;
  onUpdated: (user: UserDto) => void;
  onPasswordChanged: () => void | Promise<void>;
}) {
  const { t } = useI18n();
  const [infoOpen, setInfoOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [infoForm] = Form.useForm();
  const [passwordForm] = Form.useForm();
  const passwordRule = {
    validator: async (_: unknown, value?: string) => {
      if (
        !value ||
        value.length < 12 ||
        !/[a-z]/.test(value) ||
        !/[A-Z]/.test(value) ||
        !/\d/.test(value) ||
        !/[^A-Za-z0-9]/.test(value)
      )
        throw new Error(t("Password does not meet the policy"));
    },
  };

  async function saveInfo() {
    const result = await window.datamaker.auth.updateProfile(
      await infoForm.validateFields(),
    );
    if (!result.ok) return message.error(result.error.message);
    onUpdated(result.data);
    setInfoOpen(false);
    message.success(t("Profile updated"));
  }
  async function changePassword() {
    const values = await passwordForm.validateFields();
    const result = await window.datamaker.auth.changePassword({
      currentPassword: values.currentPassword,
      newPassword: values.newPassword,
    });
    if (!result.ok) return message.error(result.error.message);
    message.success(t("Password changed. Please sign in again."));
    await onPasswordChanged();
  }

  return (
    <Card
      title={
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {t("Personal Profile")}
          </Typography.Title>
          <Typography.Text type="secondary">
            {t("View and maintain your own account information.")}
          </Typography.Text>
        </div>
      }
      extra={
        <Space>
          <Button
            icon={<EditOutlined />}
            onClick={() => {
              infoForm.setFieldsValue(user);
              setInfoOpen(true);
            }}
          >
            {t("Edit Profile")}
          </Button>
          <Button
            icon={<KeyOutlined />}
            onClick={() => {
              passwordForm.resetFields();
              setPasswordOpen(true);
            }}
          >
            {t("Change Password")}
          </Button>
        </Space>
      }
    >
      <Descriptions bordered column={2}>
        <Descriptions.Item label={t("Username")}>
          {user.username}
        </Descriptions.Item>
        <Descriptions.Item label={t("Display Name")}>
          {user.displayName}
        </Descriptions.Item>
        <Descriptions.Item label={t("Gender")}>
          {user.gender || "-"}
        </Descriptions.Item>
        <Descriptions.Item label={t("Contact")}>
          {user.contact || "-"}
        </Descriptions.Item>
        <Descriptions.Item label={t("Email")}>
          {user.email || "-"}
        </Descriptions.Item>
        <Descriptions.Item label={t("Status")}>
          {t(user.status[0]!.toUpperCase() + user.status.slice(1))}
        </Descriptions.Item>
        <Descriptions.Item label={t("Notes")} span={2}>
          {user.notes || "-"}
        </Descriptions.Item>
        <Descriptions.Item label={t("Created At")}>
          {user.createdAt}
        </Descriptions.Item>
        <Descriptions.Item label={t("Updated At")}>
          {user.updatedAt}
        </Descriptions.Item>
      </Descriptions>
      <Modal
        title={t("Edit Profile")}
        open={infoOpen}
        onOk={() => void saveInfo()}
        onCancel={() => setInfoOpen(false)}
        destroyOnHidden
      >
        <Form form={infoForm} layout="vertical" preserve={false}>
          <Form.Item label={t("Username")}>
            <Input disabled value={user.username} />
          </Form.Item>
          <Form.Item
            name="displayName"
            label={t("Display Name")}
            rules={[{ required: true }, { max: 50 }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="gender" label={t("Gender")}>
            <Radio.Group
              options={[
                { value: "男", label: t("Male") },
                { value: "女", label: t("Female") },
                { value: "", label: t("Not specified") },
              ]}
            />
          </Form.Item>
          <Form.Item name="contact" label={t("Contact")} rules={[{ max: 100 }]}>
            <Input />
          </Form.Item>
          <Form.Item
            name="email"
            label={t("Email")}
            rules={[{ type: "email" }, { max: 200 }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="notes" label={t("Notes")} rules={[{ max: 500 }]}>
            <Input.TextArea rows={4} />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title={t("Change Password")}
        open={passwordOpen}
        onOk={() => void changePassword()}
        onCancel={() => setPasswordOpen(false)}
        destroyOnHidden
      >
        <Form form={passwordForm} layout="vertical" preserve={false}>
          <Form.Item
            name="currentPassword"
            label={t("Current Password")}
            rules={[{ required: true }]}
          >
            <Input.Password />
          </Form.Item>
          <Form.Item
            name="newPassword"
            label={t("New Password")}
            extra={t(
              "At least 12 characters with uppercase, lowercase, number, and symbol.",
            )}
            rules={[{ required: true }, passwordRule]}
          >
            <Input.Password />
          </Form.Item>
          <Form.Item
            name="confirmPassword"
            label={t("Confirm Password")}
            dependencies={["newPassword"]}
            rules={[
              { required: true },
              {
                validator: async (_: unknown, value: string) => {
                  if (value !== passwordForm.getFieldValue("newPassword"))
                    throw new Error(t("Passwords do not match"));
                },
              },
            ]}
          >
            <Input.Password />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
