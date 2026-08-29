import { useEffect, useState } from "react";
import {
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  message,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import {
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  KeyOutlined,
  PlusOutlined,
  ReloadOutlined,
  UnlockOutlined,
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

export function AccessManagementPage({
  section,
  currentUserId,
  onSessionInvalidated,
}: {
  section: Section;
  currentUserId: string;
  onSessionInvalidated: () => void | Promise<void>;
}) {
  const { t } = useI18n();
  const [users, setUsers] = useState<UserDto[]>([]);
  const [roles, setRoles] = useState<RoleDto[]>([]);
  const [permissions, setPermissions] = useState<PermissionDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<UserDto | RoleDto | PermissionDto>();
  const [viewing, setViewing] = useState<UserDto>();
  const [viewingRole, setViewingRole] = useState<RoleDto>();
  const [passwordUser, setPasswordUser] = useState<UserDto>();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const [passwordForm] = Form.useForm();

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
    setOpen(false);
    form.resetFields();
    if (section === "users" && editing?.id === currentUserId) {
      message.success(t("Account updated. Please sign in again."));
      await onSessionInvalidated();
      return;
    }
    message.success(t(editing ? "Saved" : "Created"));
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

  async function unlock(user: UserDto) {
    const result = await window.datamaker.access.saveUser({
      ...user,
      status: "active",
    });
    if (!result.ok) return message.error(result.error.message);
    message.success(t("User unlocked"));
    if (user.id === currentUserId) return onSessionInvalidated();
    await load();
  }

  async function resetPassword() {
    const values = await passwordForm.validateFields();
    if (!passwordUser) return;
    const result = await window.datamaker.access.saveUser({
      ...passwordUser,
      password: values.password,
    });
    if (!result.ok) return message.error(result.error.message);
    setPasswordUser(undefined);
    passwordForm.resetFields();
    message.success(t("Password reset successfully"));
    if (passwordUser.id === currentUserId) return onSessionInvalidated();
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
  const permissionsByDomain = permissions.reduce<
    Record<string, PermissionDto[]>
  >((groups, permission) => {
    (groups[permission.domain] ??= []).push(permission);
    return groups;
  }, {});
  const permissionOptions = Object.entries(permissionsByDomain).map(
    ([domain, items]) => ({
      label: domain,
      options: items.map((permission) => ({
        value: permission.id,
        label: `${permission.action} · ${permission.description}`,
      })),
    }),
  );
  const dataSource =
    section === "users"
      ? users.filter((user) =>
          `${user.username} ${user.displayName}`
            .toLowerCase()
            .includes(search.trim().toLowerCase()),
        )
      : section === "roles"
        ? roles
        : permissions;
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
            width: 220,
            render: (_: unknown, record: UserDto) => (
              <Space>
                <Button
                  type="text"
                  icon={<EyeOutlined />}
                  title={t("View")}
                  onClick={() => setViewing(record)}
                />
                <Button
                  type="text"
                  icon={<EditOutlined />}
                  title={t("Edit")}
                  onClick={() => edit(record)}
                />
                <Button
                  type="text"
                  icon={<KeyOutlined />}
                  title={t("Reset Password")}
                  onClick={() => {
                    setPasswordUser(record);
                    passwordForm.resetFields();
                  }}
                />
                <Button
                  type="text"
                  icon={<UnlockOutlined />}
                  title={t("Unlock")}
                  disabled={
                    !record.lockedUntil &&
                    !record.failedLoginCount &&
                    record.status !== "locked"
                  }
                  onClick={() => void unlock(record)}
                />
                <Popconfirm
                  title={t("Delete this record?")}
                  disabled={users.length <= 1}
                  onConfirm={() => remove(record.id)}
                >
                  <Button
                    type="text"
                    danger
                    disabled={users.length <= 1}
                    icon={<DeleteOutlined />}
                  />
                </Popconfirm>
              </Space>
            ),
          },
        ]
      : section === "roles"
        ? [
            { title: t("Role Code"), dataIndex: "code" },
            {
              title: t("Role Name"),
              dataIndex: "name",
              render: (value: string, record: RoleDto) => (
                <Button type="link" onClick={() => setViewingRole(record)}>
                  {value}
                </Button>
              ),
            },
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
              title: t("Associated Users"),
              key: "userCount",
              render: (_: unknown, record: RoleDto) =>
                users.filter((user) => user.roleIds.includes(record.id)).length,
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
          {section === "users" && (
            <Input.Search
              allowClear
              placeholder={t("Search users")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              style={{ width: 220 }}
            />
          )}
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
              {!editing && (
                <Form.Item
                  name="password"
                  label={t("Password")}
                  extra={t(
                    "At least 12 characters with uppercase, lowercase, number, and symbol.",
                  )}
                  rules={[
                    { required: true },
                    {
                      validator: async (_, value?: string) => {
                        if (
                          !value ||
                          value.length < 12 ||
                          !/[a-z]/.test(value) ||
                          !/[A-Z]/.test(value) ||
                          !/\d/.test(value) ||
                          !/[^A-Za-z0-9]/.test(value)
                        )
                          throw new Error(
                            t("Password does not meet the policy"),
                          );
                      },
                    },
                  ]}
                >
                  <Input.Password />
                </Form.Item>
              )}
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
                  optionFilterProp="label"
                  options={permissionOptions}
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
      <Modal
        title={t("User Details")}
        open={Boolean(viewing)}
        footer={null}
        onCancel={() => setViewing(undefined)}
      >
        {viewing && (
          <Descriptions bordered column={2}>
            <Descriptions.Item label={t("Username")}>
              {viewing.username}
            </Descriptions.Item>
            <Descriptions.Item label={t("Display Name")}>
              {viewing.displayName}
            </Descriptions.Item>
            <Descriptions.Item label={t("Status")}>
              {t(viewing.status[0]!.toUpperCase() + viewing.status.slice(1))}
            </Descriptions.Item>
            <Descriptions.Item label={t("Roles")}>
              {viewing.roleIds
                .map((id) => roleNames.get(id) ?? id)
                .join(", ") || "-"}
            </Descriptions.Item>
            <Descriptions.Item label={t("Created At")}>
              {viewing.createdAt}
            </Descriptions.Item>
            <Descriptions.Item label={t("Updated At")}>
              {viewing.updatedAt}
            </Descriptions.Item>
            <Descriptions.Item label={t("Failed Login Count")}>
              {viewing.failedLoginCount}
            </Descriptions.Item>
            <Descriptions.Item label={t("Locked Until")}>
              {viewing.lockedUntil ?? "-"}
            </Descriptions.Item>
          </Descriptions>
        )}
      </Modal>
      <Modal
        title={t("Reset Password")}
        open={Boolean(passwordUser)}
        onOk={() => void resetPassword()}
        onCancel={() => {
          setPasswordUser(undefined);
          passwordForm.resetFields();
        }}
        destroyOnHidden
      >
        <Form form={passwordForm} layout="vertical" preserve={false}>
          <Form.Item label={t("Username")}>
            <Input disabled value={passwordUser?.username} />
          </Form.Item>
          <Form.Item
            name="password"
            label={t("New Password")}
            extra={t(
              "At least 12 characters with uppercase, lowercase, number, and symbol.",
            )}
            rules={[
              { required: true },
              {
                validator: async (_, value?: string) => {
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
            name="confirmPassword"
            label={t("Confirm Password")}
            dependencies={["password"]}
            rules={[
              { required: true },
              {
                validator: async (_, value) => {
                  if (value !== passwordForm.getFieldValue("password"))
                    throw new Error(t("Passwords do not match"));
                },
              },
            ]}
          >
            <Input.Password />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title={t("Role Details")}
        open={Boolean(viewingRole)}
        footer={null}
        width={760}
        onCancel={() => setViewingRole(undefined)}
      >
        {viewingRole && (
          <>
            <Descriptions bordered column={2} style={{ marginBottom: 16 }}>
              <Descriptions.Item label={t("Role Code")}>
                {viewingRole.code}
              </Descriptions.Item>
              <Descriptions.Item label={t("Role Name")}>
                {viewingRole.name}
              </Descriptions.Item>
              <Descriptions.Item label={t("Built-in")}>
                {t(viewingRole.builtIn ? "Yes" : "No")}
              </Descriptions.Item>
              <Descriptions.Item label={t("Permissions")}>
                {viewingRole.permissionIds.length}
              </Descriptions.Item>
            </Descriptions>
            <Typography.Title level={5}>
              {t("Permission Assignment")}
            </Typography.Title>
            <Space wrap style={{ marginBottom: 16 }}>
              {viewingRole.permissionIds.map((id) => (
                <Tag key={id}>{permissionCodes.get(id) ?? id}</Tag>
              ))}
            </Space>
            <Typography.Title level={5}>
              {t("Associated Users")}
            </Typography.Title>
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={users.filter((user) =>
                user.roleIds.includes(viewingRole.id),
              )}
              locale={{ emptyText: t("No associated users") }}
              columns={[
                { title: t("Username"), dataIndex: "username" },
                { title: t("Display Name"), dataIndex: "displayName" },
                {
                  title: t("Status"),
                  dataIndex: "status",
                  render: (value: UserStatus) =>
                    t(value[0]!.toUpperCase() + value.slice(1)),
                },
              ]}
            />
          </>
        )}
      </Modal>
    </Card>
  );
}
