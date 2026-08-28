import { useEffect, useState } from "react";
import {
  Button,
  Card,
  Form,
  Input,
  message,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
} from "antd";
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import type {
  PermissionDto,
  RoleDto,
  SavePermissionInput,
  SaveRoleInput,
  SaveUserInput,
  UserDto,
  UserStatus,
} from "@datamaker/contracts";
import { useI18n } from "./i18n";

type Section = "users" | "roles" | "permissions";

export function AccessManagementPage({ section }: { section: Section }) {
  const { t } = useI18n();
  const [users, setUsers] = useState<UserDto[]>([]);
  const [roles, setRoles] = useState<RoleDto[]>([]);
  const [permissions, setPermissions] = useState<PermissionDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<UserDto | RoleDto | PermissionDto>();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();

  async function load() {
    setLoading(true);
    const [userResult, roleResult, permissionResult] = await Promise.all([
      window.datamaker.access.listUsers(),
      window.datamaker.access.listRoles(),
      window.datamaker.access.listPermissions(),
    ]);
    setLoading(false);
    if (userResult.ok) setUsers(userResult.data);
    else message.error(userResult.error.message);
    if (roleResult.ok) setRoles(roleResult.data);
    else message.error(roleResult.error.message);
    if (permissionResult.ok) setPermissions(permissionResult.data);
    else message.error(permissionResult.error.message);
  }
  useEffect(() => {
    void load();
  }, []);

  function edit(record?: UserDto | RoleDto | PermissionDto) {
    setEditing(record);
    if (section === "users") {
      const user = record as UserDto | undefined;
      form.setFieldsValue(
        user
          ? {
              username: user.username,
              displayName: user.displayName,
              status: user.status,
              roleIds: user.roleIds,
            }
          : { status: "active", roleIds: [] },
      );
    } else if (section === "roles") {
      const role = record as RoleDto | undefined;
      form.setFieldsValue(
        role
          ? {
              code: role.code,
              name: role.name,
              permissionIds: role.permissionIds,
            }
          : { permissionIds: [] },
      );
    } else form.setFieldsValue(record ?? {});
    setOpen(true);
  }

  async function save() {
    const values = await form.validateFields();
    const result =
      section === "users"
        ? await window.datamaker.access.saveUser({
            ...values,
            id: editing?.id,
          } as SaveUserInput)
        : section === "roles"
          ? await window.datamaker.access.saveRole({
              ...values,
              id: editing?.id,
            } as SaveRoleInput)
          : await window.datamaker.access.savePermission({
              ...values,
              id: editing?.id,
            } as SavePermissionInput);
    if (!result.ok) return message.error(result.error.message);
    message.success(t(editing ? "Saved" : "Created"));
    setOpen(false);
    form.resetFields();
    await load();
  }

  async function remove(id: string) {
    const result =
      section === "users"
        ? await window.datamaker.access.removeUser(id)
        : section === "roles"
          ? await window.datamaker.access.removeRole(id)
          : await window.datamaker.access.removePermission(id);
    if (!result.ok) return message.error(result.error.message);
    message.success(t("Deleted"));
    await load();
  }

  const actions = (
    record: UserDto | RoleDto | PermissionDto,
    protectedRecord = false,
  ) => (
    <Space>
      <Button
        type="text"
        icon={<EditOutlined />}
        onClick={() => edit(record)}
      />
      <Popconfirm
        title={t("Delete this record?")}
        disabled={protectedRecord}
        onConfirm={() => remove(record.id)}
      >
        <Button
          type="text"
          danger
          disabled={protectedRecord}
          icon={<DeleteOutlined />}
        />
      </Popconfirm>
    </Space>
  );
  const roleNames = new Map(roles.map((role) => [role.id, role.name]));
  const permissionCodes = new Map(
    permissions.map((permission) => [permission.id, permission.code]),
  );
  const dataSource =
    section === "users" ? users : section === "roles" ? roles : permissions;
  const columns =
    section === "users"
      ? [
          { title: t("Username"), dataIndex: "username" },
          { title: t("Display Name"), dataIndex: "displayName" },
          {
            title: t("Status"),
            dataIndex: "status",
            render: (value: UserStatus) => (
              <Tag
                color={
                  value === "active"
                    ? "green"
                    : value === "locked"
                      ? "orange"
                      : "default"
                }
              >
                {t(value[0]!.toUpperCase() + value.slice(1))}
              </Tag>
            ),
          },
          {
            title: t("Roles"),
            dataIndex: "roleIds",
            render: (ids: string[]) =>
              ids.map((id) => <Tag key={id}>{roleNames.get(id) ?? id}</Tag>),
          },
          {
            title: t("Login Protection"),
            key: "loginProtection",
            render: (_: unknown, record: UserDto) =>
              record.lockedUntil ? (
                <Tag color="red">
                  {t("Locked until {time}", { time: record.lockedUntil })}
                </Tag>
              ) : record.failedLoginCount ? (
                <Tag color="orange">
                  {t("{count} failed attempts", {
                    count: record.failedLoginCount,
                  })}
                </Tag>
              ) : (
                "-"
              ),
          },
          {
            title: t("Actions"),
            key: "actions",
            render: (_: unknown, record: UserDto) =>
              actions(record, users.length <= 1),
          },
        ]
      : section === "roles"
        ? [
            { title: t("Role Code"), dataIndex: "code" },
            { title: t("Role Name"), dataIndex: "name" },
            {
              title: t("Built-in"),
              dataIndex: "builtIn",
              render: (value: boolean) => <Tag>{t(value ? "Yes" : "No")}</Tag>,
            },
            {
              title: t("Permissions"),
              dataIndex: "permissionIds",
              render: (ids: string[]) =>
                ids.map((id) => (
                  <Tag key={id}>{permissionCodes.get(id) ?? id}</Tag>
                )),
            },
            {
              title: t("Actions"),
              key: "actions",
              render: (_: unknown, record: RoleDto) =>
                actions(record, record.builtIn),
            },
          ]
        : [
            { title: t("Permission Code"), dataIndex: "code" },
            { title: t("Domain"), dataIndex: "domain" },
            { title: t("Action"), dataIndex: "action" },
            { title: t("Description"), dataIndex: "description" },
            {
              title: t("Actions"),
              key: "actions",
              render: (_: unknown, record: PermissionDto) =>
                actions(
                  record,
                  record.code.startsWith("system:") ||
                    [
                      "metadata:read",
                      "metadata:manage",
                      "metadata:import",
                      "quality:manage",
                      "export:create",
                    ].includes(record.code),
                ),
            },
          ];

  return (
    <Card
      title={t(
        section === "users"
          ? "User Management"
          : section === "roles"
            ? "Role Management"
            : "Permission Management",
      )}
      extra={
        <Space>
          <Button icon={<ReloadOutlined />} onClick={load}>
            {t("Refresh")}
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => edit()}>
            {t("New")}
          </Button>
        </Space>
      }
    >
      <Table<UserDto | RoleDto | PermissionDto>
        rowKey="id"
        loading={loading}
        dataSource={dataSource}
        columns={columns as never}
        scroll={{ x: 800 }}
      />
      <Modal
        title={t(editing ? "Edit {title}" : "New {title}", {
          title: t(
            section === "users"
              ? "User"
              : section === "roles"
                ? "Role"
                : "Permission",
          ),
        })}
        open={open}
        onOk={save}
        onCancel={() => {
          setOpen(false);
          form.resetFields();
        }}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          {section === "users" && (
            <>
              <Form.Item
                name="username"
                label={t("Username")}
                rules={[{ required: true }]}
              >
                <Input />
              </Form.Item>
              <Form.Item
                name="displayName"
                label={t("Display Name")}
                rules={[{ required: true }]}
              >
                <Input />
              </Form.Item>
              <Form.Item
                name="password"
                label={editing ? t("New Password (optional)") : t("Password")}
                extra={t(
                  "At least 12 characters with uppercase, lowercase, number, and symbol.",
                )}
                rules={[
                  ...(editing ? [] : [{ required: true }]),
                  {
                    validator: async (_, value?: string) => {
                      if (!value && editing) return;
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
                  },
                ]}
              >
                <Input.Password />
              </Form.Item>
              <Form.Item
                name="status"
                label={t("Status")}
                rules={[{ required: true }]}
              >
                <Select
                  options={["active", "locked", "disabled"].map((value) => ({
                    value,
                    label: t(value[0]!.toUpperCase() + value.slice(1)),
                  }))}
                />
              </Form.Item>
              <Form.Item name="roleIds" label={t("Roles")}>
                <Select
                  mode="multiple"
                  options={roles.map((role) => ({
                    value: role.id,
                    label: role.name,
                  }))}
                />
              </Form.Item>
            </>
          )}
          {section === "roles" && (
            <>
              <Form.Item
                name="code"
                label={t("Role Code")}
                rules={[{ required: true }]}
              >
                <Input disabled={(editing as RoleDto | undefined)?.builtIn} />
              </Form.Item>
              <Form.Item
                name="name"
                label={t("Role Name")}
                rules={[{ required: true }]}
              >
                <Input />
              </Form.Item>
              <Form.Item name="permissionIds" label={t("Permissions")}>
                <Select
                  mode="multiple"
                  options={permissions.map((permission) => ({
                    value: permission.id,
                    label: permission.code,
                  }))}
                />
              </Form.Item>
            </>
          )}
          {section === "permissions" && (
            <>
              <Form.Item
                name="code"
                label={t("Permission Code")}
                rules={[{ required: true }]}
              >
                <Input />
              </Form.Item>
              <Form.Item
                name="domain"
                label={t("Domain")}
                rules={[{ required: true }]}
              >
                <Input />
              </Form.Item>
              <Form.Item
                name="action"
                label={t("Action")}
                rules={[{ required: true }]}
              >
                <Input />
              </Form.Item>
              <Form.Item name="description" label={t("Description")}>
                <Input.TextArea />
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>
    </Card>
  );
}
