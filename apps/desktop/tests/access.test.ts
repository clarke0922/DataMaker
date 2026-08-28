import { describe, expect, it } from "vitest";
import { MetadataDatabase } from "../src/main/database.js";
import { AccessRepository } from "../src/main/access.js";

describe("AccessRepository", () => {
  it("seeds the administrator role and permission catalog", () => {
    const database = new MetadataDatabase(":memory:");
    const access = new AccessRepository(database.db);
    expect(access.listPermissions()).toHaveLength(8);
    const administrator = access
      .listRoles()
      .find((role) => role.code === "administrator");
    expect(administrator?.builtIn).toBe(true);
    expect(administrator?.permissionIds).toHaveLength(8);
    database.close();
  });

  it("creates users with a hashed password and role assignments", () => {
    const database = new MetadataDatabase(":memory:");
    const access = new AccessRepository(database.db);
    const role = access.listRoles()[0]!;
    const user = access.saveUser({
      username: "admin",
      displayName: "Administrator",
      password: "Strong-password-123!",
      status: "active",
      roleIds: [role.id],
    });
    expect(user.roleIds).toEqual([role.id]);
    expect(user).not.toHaveProperty("password_hash");
    const stored = database.db
      .prepare("SELECT password_hash FROM users WHERE id=?")
      .get(user.id) as { password_hash: string };
    expect(stored.password_hash).toMatch(/^argon2id:/);
    expect(stored.password_hash).not.toContain("strong-password");
    expect(() => access.removeUser(user.id)).toThrow("last user");
    database.close();
  });

  it("manages role permissions and protects built-in records", () => {
    const database = new MetadataDatabase(":memory:");
    const access = new AccessRepository(database.db);
    const permission = access.savePermission({
      code: "reports:read",
      domain: "reports",
      action: "read",
      description: "Read reports",
    });
    const role = access.saveRole({
      code: "analyst",
      name: "Analyst",
      permissionIds: [permission.id],
    });
    expect(role.permissionIds).toEqual([permission.id]);
    access.removeRole(role.id);
    access.removePermission(permission.id);
    expect(() => access.removeRole(access.listRoles()[0]!.id)).toThrow(
      "Built-in roles",
    );
    const administrator = access
      .listRoles()
      .find((item) => item.code === "administrator")!;
    expect(
      access.saveRole({
        id: administrator.id,
        code: "changed",
        name: "Administrator",
        permissionIds: [],
      }).permissionIds,
    ).toHaveLength(access.listPermissions().length);
    const builtInPermission = access.listPermissions()[0]!;
    expect(() =>
      access.savePermission({
        ...builtInPermission,
        code: "changed:permission",
      }),
    ).toThrow("cannot be modified");
    database.close();
  });

  it("prevents removing or disabling the last active administrator", () => {
    const database = new MetadataDatabase(":memory:");
    const access = new AccessRepository(database.db);
    const administrator = access
      .listRoles()
      .find((role) => role.code === "administrator")!;
    const admin = access.saveUser({
      username: "admin",
      displayName: "Admin",
      password: "Strong-password-123!",
      status: "active",
      roleIds: [administrator.id],
    });
    access.saveUser({
      username: "reader",
      displayName: "Reader",
      password: "Strong-password-456!",
      status: "active",
      roleIds: [],
    });
    expect(() =>
      access.saveUser({
        ...admin,
        status: "disabled",
        roleIds: admin.roleIds,
      }),
    ).toThrow("active administrator");
    expect(() => access.removeUser(admin.id)).toThrow(
      "last active administrator",
    );
    database.close();
  });
});
