import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { Algorithm, hashRawSync } from "@node-rs/argon2";
import type { DatabaseSync } from "node:sqlite";
import type {
  PermissionDto,
  RoleDto,
  SavePermissionInput,
  SaveRoleInput,
  SaveUserInput,
  UserDto,
  UserStatus,
} from "@datamaker/contracts";

const ACCESS_MIGRATION = `
ALTER TABLE permissions ADD COLUMN description TEXT NOT NULL DEFAULT '';
`;

const DEFAULT_PERMISSIONS = [
  ["system:user_manage", "system", "user_manage", "Manage local users"],
  [
    "system:role_manage",
    "system",
    "role_manage",
    "Manage roles and assignments",
  ],
  [
    "system:permission_manage",
    "system",
    "permission_manage",
    "Manage permission definitions",
  ],
  ["metadata:read", "metadata", "read", "View metadata"],
  ["metadata:manage", "metadata", "manage", "Create and update metadata"],
  ["metadata:import", "metadata", "import", "Import external metadata"],
  ["quality:manage", "quality", "manage", "Manage quality rules and results"],
  ["export:create", "export", "create", "Export metadata dictionaries"],
] as const;

const deriveArgon2id = (password: string, salt: Buffer, outputLen = 32) =>
  hashRawSync(password, {
    algorithm: Algorithm.Argon2id,
    salt,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
    outputLen,
  });

export class AccessRepository {
  constructor(private readonly db: DatabaseSync) {
    const columns = db
      .prepare("PRAGMA table_info('permissions')")
      .all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "description"))
      db.exec(ACCESS_MIGRATION);
    this.seed();
  }

  private seed() {
    const insertPermission = this.db.prepare(
      "INSERT OR IGNORE INTO permissions(id,code,domain,action,description) VALUES(?,?,?,?,?)",
    );
    DEFAULT_PERMISSIONS.forEach((permission) =>
      insertPermission.run(randomUUID(), ...permission),
    );
    const adminRoleId = randomUUID();
    this.db
      .prepare(
        "INSERT OR IGNORE INTO roles(id,code,name,built_in) VALUES(?, 'administrator', 'Administrator', 1)",
      )
      .run(adminRoleId);
    const role = this.db
      .prepare("SELECT id FROM roles WHERE code = 'administrator'")
      .get() as { id: string };
    this.db
      .prepare(
        "INSERT OR IGNORE INTO role_permissions(role_id,permission_id) SELECT ?,id FROM permissions",
      )
      .run(role.id);
  }

  private hashPassword(password: string) {
    if (password.length < 12)
      throw new Error("Password must contain at least 12 characters");
    if (!/[a-z]/.test(password) || !/[A-Z]/.test(password))
      throw new Error("Password must contain uppercase and lowercase letters");
    if (!/\d/.test(password)) throw new Error("Password must contain a number");
    if (!/[^A-Za-z0-9]/.test(password))
      throw new Error("Password must contain a symbol");
    const salt = randomBytes(16);
    const hash = deriveArgon2id(password, salt);
    return `argon2id:${salt.toString("base64")}:${hash.toString("base64")}`;
  }

  authenticate(
    username: string,
    password: string,
  ): { user: UserDto; permissions: string[] } {
    const row = this.db
      .prepare(
        "SELECT id,password_hash,status,failed_login_count,locked_until FROM users WHERE username=? COLLATE NOCASE",
      )
      .get(username.trim()) as
      | {
          id: string;
          password_hash: string;
          status: UserStatus;
          failed_login_count: number;
          locked_until: string | null;
        }
      | undefined;
    if (!row || row.status !== "active")
      throw new Error("Invalid username or password");
    if (row.locked_until && Date.parse(row.locked_until) > Date.now())
      throw new Error("Invalid username or password");
    if (row.locked_until)
      this.db
        .prepare(
          "UPDATE users SET failed_login_count=0,locked_until=NULL WHERE id=?",
        )
        .run(row.id);
    const [algorithm, saltText, hashText] = row.password_hash.split(":");
    if (
      !saltText ||
      !hashText ||
      (algorithm !== "scrypt" && algorithm !== "argon2id")
    )
      throw new Error("Invalid username or password");
    const expected = Buffer.from(hashText, "base64");
    const salt = Buffer.from(saltText, "base64");
    const actual =
      algorithm === "argon2id"
        ? deriveArgon2id(password, salt, expected.length)
        : scryptSync(password, salt, expected.length);
    if (
      expected.length !== actual.length ||
      !timingSafeEqual(expected, actual)
    ) {
      const lockedUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      this.db
        .prepare(
          "UPDATE users SET failed_login_count=failed_login_count+1,locked_until=CASE WHEN failed_login_count+1>=5 THEN ? ELSE NULL END,updated_at=? WHERE id=?",
        )
        .run(lockedUntil, new Date().toISOString(), row.id);
      throw new Error("Invalid username or password");
    }
    this.db
      .prepare(
        "UPDATE users SET failed_login_count=0,locked_until=NULL,updated_at=? WHERE id=?",
      )
      .run(new Date().toISOString(), row.id);
    if (algorithm === "scrypt")
      this.db
        .prepare("UPDATE users SET password_hash=?,updated_at=? WHERE id=?")
        .run(this.hashPassword(password), new Date().toISOString(), row.id);
    const user = this.listUsers().find((item) => item.id === row.id)!;
    const permissions = (
      this.db
        .prepare(
          `SELECT DISTINCT permission.code FROM permissions permission JOIN role_permissions assignment ON assignment.permission_id=permission.id JOIN user_roles membership ON membership.role_id=assignment.role_id WHERE membership.user_id=? ORDER BY permission.code`,
        )
        .all(row.id) as Array<{ code: string }>
    ).map((item) => item.code);
    return { user, permissions };
  }

  listUsers(): UserDto[] {
    const rows = this.db
      .prepare(
        `SELECT id,username,display_name,status,failed_login_count,locked_until,created_at,updated_at FROM users ORDER BY username COLLATE NOCASE`,
      )
      .all() as Array<{
      id: string;
      username: string;
      display_name: string;
      status: UserStatus;
      failed_login_count: number;
      locked_until: string | null;
      created_at: string;
      updated_at: string;
    }>;
    const roleIds = this.db.prepare(
      "SELECT role_id FROM user_roles WHERE user_id = ? ORDER BY role_id",
    );
    return rows.map((row) => ({
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      status: row.status,
      roleIds: (roleIds.all(row.id) as Array<{ role_id: string }>).map(
        (item) => item.role_id,
      ),
      failedLoginCount: row.failed_login_count,
      lockedUntil: row.locked_until,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  saveUser(input: SaveUserInput): UserDto {
    if (!input.username.trim() || !input.displayName.trim())
      throw new Error("Username and display name are required");
    const now = new Date().toISOString();
    const id = input.id ?? randomUUID();
    this.db.exec("BEGIN");
    try {
      if (input.id) {
        if (!this.db.prepare("SELECT 1 FROM users WHERE id = ?").get(id))
          throw new Error("User not found");
        this.db
          .prepare(
            "UPDATE users SET username=?,display_name=?,status=?,updated_at=? WHERE id=?",
          )
          .run(
            input.username.trim(),
            input.displayName.trim(),
            input.status,
            now,
            id,
          );
        if (input.password)
          this.db
            .prepare("UPDATE users SET password_hash=? WHERE id=?")
            .run(this.hashPassword(input.password), id);
        if (input.status === "active" || input.password)
          this.db
            .prepare(
              "UPDATE users SET failed_login_count=0,locked_until=NULL WHERE id=?",
            )
            .run(id);
      } else {
        if (!input.password)
          throw new Error("Password is required for new users");
        this.db
          .prepare(
            "INSERT INTO users(id,username,password_hash,display_name,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
          )
          .run(
            id,
            input.username.trim(),
            this.hashPassword(input.password),
            input.displayName.trim(),
            input.status,
            now,
            now,
          );
      }
      this.db.prepare("DELETE FROM user_roles WHERE user_id = ?").run(id);
      const assign = this.db.prepare(
        "INSERT INTO user_roles(user_id,role_id) VALUES(?,?)",
      );
      const firstUser =
        Number(
          (
            this.db.prepare("SELECT COUNT(*) count FROM users").get() as {
              count: number;
            }
          ).count,
        ) === 1 && !input.id;
      const roleIds = firstUser
        ? [
            (
              this.db
                .prepare("SELECT id FROM roles WHERE code='administrator'")
                .get() as { id: string }
            ).id,
          ]
        : input.roleIds;
      [...new Set(roleIds)].forEach((roleId) => assign.run(id, roleId));
      const activeAdministrators = Number(
        (
          this.db
            .prepare(
              `SELECT COUNT(DISTINCT user.id) count FROM users user
               JOIN user_roles membership ON membership.user_id=user.id
               JOIN roles role ON role.id=membership.role_id
               WHERE user.status='active' AND role.code='administrator'`,
            )
            .get() as { count: number }
        ).count,
      );
      if (activeAdministrators < 1)
        throw new Error("At least one active administrator is required");
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.listUsers().find((user) => user.id === id)!;
  }

  removeUser(id: string) {
    const count = (
      this.db.prepare("SELECT count(*) AS count FROM users").get() as {
        count: number;
      }
    ).count;
    if (count <= 1) throw new Error("The last user cannot be deleted");
    const targetIsAdministrator = Boolean(
      this.db
        .prepare(
          `SELECT 1 FROM users user JOIN user_roles membership ON membership.user_id=user.id JOIN roles role ON role.id=membership.role_id WHERE user.id=? AND user.status='active' AND role.code='administrator'`,
        )
        .get(id),
    );
    const activeAdministrators = Number(
      (
        this.db
          .prepare(
            `SELECT COUNT(DISTINCT user.id) count FROM users user JOIN user_roles membership ON membership.user_id=user.id JOIN roles role ON role.id=membership.role_id WHERE user.status='active' AND role.code='administrator'`,
          )
          .get() as { count: number }
      ).count,
    );
    if (targetIsAdministrator && activeAdministrators <= 1)
      throw new Error("The last active administrator cannot be deleted");
    if (!this.db.prepare("DELETE FROM users WHERE id = ?").run(id).changes)
      throw new Error("User not found");
  }

  listRoles(): RoleDto[] {
    const rows = this.db
      .prepare(
        "SELECT id,code,name,built_in FROM roles ORDER BY built_in DESC,name",
      )
      .all() as Array<{
      id: string;
      code: string;
      name: string;
      built_in: number;
    }>;
    const permissions = this.db.prepare(
      "SELECT permission_id FROM role_permissions WHERE role_id = ? ORDER BY permission_id",
    );
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      builtIn: Boolean(row.built_in),
      permissionIds: (
        permissions.all(row.id) as Array<{ permission_id: string }>
      ).map((item) => item.permission_id),
    }));
  }

  saveRole(input: SaveRoleInput): RoleDto {
    if (!input.code.trim() || !input.name.trim())
      throw new Error("Role code and name are required");
    const id = input.id ?? randomUUID();
    this.db.exec("BEGIN");
    try {
      if (input.id) {
        const existing = this.db
          .prepare("SELECT built_in FROM roles WHERE id=?")
          .get(id) as { built_in: number } | undefined;
        if (!existing) throw new Error("Role not found");
        this.db
          .prepare(
            `UPDATE roles SET code=${existing.built_in ? "code" : "?"},name=? WHERE id=?`,
          )
          .run(
            ...(existing.built_in
              ? [input.name.trim(), id]
              : [input.code.trim(), input.name.trim(), id]),
          );
      } else
        this.db
          .prepare("INSERT INTO roles(id,code,name,built_in) VALUES(?,?,?,0)")
          .run(id, input.code.trim(), input.name.trim());
      this.db.prepare("DELETE FROM role_permissions WHERE role_id=?").run(id);
      const assign = this.db.prepare(
        "INSERT INTO role_permissions(role_id,permission_id) VALUES(?,?)",
      );
      const permissionIds = (
        this.db.prepare("SELECT built_in FROM roles WHERE id=?").get(id) as {
          built_in: number;
        }
      ).built_in
        ? (
            this.db.prepare("SELECT id FROM permissions").all() as Array<{
              id: string;
            }>
          ).map((permission) => permission.id)
        : input.permissionIds;
      [...new Set(permissionIds)].forEach((permissionId) =>
        assign.run(id, permissionId),
      );
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.listRoles().find((role) => role.id === id)!;
  }

  removeRole(id: string) {
    const role = this.db
      .prepare("SELECT built_in FROM roles WHERE id=?")
      .get(id) as { built_in: number } | undefined;
    if (!role) throw new Error("Role not found");
    if (role.built_in) throw new Error("Built-in roles cannot be deleted");
    this.db.prepare("DELETE FROM roles WHERE id=?").run(id);
  }

  listPermissions(): PermissionDto[] {
    return this.db
      .prepare(
        "SELECT id,code,domain,action,description FROM permissions ORDER BY domain,action",
      )
      .all() as unknown as PermissionDto[];
  }

  savePermission(input: SavePermissionInput): PermissionDto {
    if (!input.code.trim() || !input.domain.trim() || !input.action.trim())
      throw new Error("Permission code, domain, and action are required");
    const id = input.id ?? randomUUID();
    if (input.id) {
      const current = this.db
        .prepare("SELECT code FROM permissions WHERE id=?")
        .get(id) as { code: string } | undefined;
      if (!current) throw new Error("Permission not found");
      if (
        DEFAULT_PERMISSIONS.some((permission) => permission[0] === current.code)
      )
        throw new Error("Built-in permissions cannot be modified");
      if (
        !this.db
          .prepare(
            "UPDATE permissions SET code=?,domain=?,action=?,description=? WHERE id=?",
          )
          .run(
            input.code.trim(),
            input.domain.trim(),
            input.action.trim(),
            input.description.trim(),
            id,
          ).changes
      )
        throw new Error("Permission not found");
    } else
      this.db
        .prepare(
          "INSERT INTO permissions(id,code,domain,action,description) VALUES(?,?,?,?,?)",
        )
        .run(
          id,
          input.code.trim(),
          input.domain.trim(),
          input.action.trim(),
          input.description.trim(),
        );
    return this.listPermissions().find((permission) => permission.id === id)!;
  }

  removePermission(id: string) {
    if (
      DEFAULT_PERMISSIONS.some(
        (permission) =>
          permission[0] ===
          (
            this.db
              .prepare("SELECT code FROM permissions WHERE id=?")
              .get(id) as { code: string } | undefined
          )?.code,
      )
    )
      throw new Error("Built-in permissions cannot be deleted");
    if (!this.db.prepare("DELETE FROM permissions WHERE id=?").run(id).changes)
      throw new Error("Permission not found");
  }
}
