import { describe, expect, it } from "vitest";
import { MetadataDatabase } from "../src/main/database.js";
import { AccessRepository } from "../src/main/access.js";
import { AuthService } from "../src/main/auth.js";
describe("AuthService", () => {
  it("authenticates, expires authorization by logout, and assigns the first administrator role", () => {
    const database = new MetadataDatabase(":memory:");
    const access = new AccessRepository(database.db);
    const user = access.saveUser({
      username: "admin",
      displayName: "Administrator",
      status: "active",
      password: "Secure-pass-123!",
      roleIds: [],
    });
    expect(user.roleIds).toHaveLength(1);
    expect(() => access.authenticate("admin", "wrong-password")).toThrow();
    const auth = new AuthService(access);
    const session = auth.login({
      username: "admin",
      password: "Secure-pass-123!",
    });
    expect(session.permissions).toContain("system:user_manage");
    expect(auth.require(session.token, "metadata:read").user.id).toBe(user.id);
    auth.revokeUser(user.id);
    expect(() => auth.require(session.token)).toThrow(
      "Authentication required",
    );
    const next = auth.login({
      username: "admin",
      password: "Secure-pass-123!",
    });
    auth.revokeAll();
    expect(() => auth.require(next.token)).toThrow("Authentication required");
    database.close();
  });

  it("enforces password complexity and temporarily locks repeated failures", () => {
    const database = new MetadataDatabase(":memory:");
    const access = new AccessRepository(database.db);
    expect(() =>
      access.saveUser({
        username: "weak",
        displayName: "Weak",
        status: "active",
        password: "only-lowercase",
        roleIds: [],
      }),
    ).toThrow("uppercase and lowercase");
    const user = access.saveUser({
      username: "operator",
      displayName: "Operator",
      status: "active",
      password: "Operator-pass-123!",
      roleIds: [],
    });
    for (let attempt = 0; attempt < 5; attempt++)
      expect(() => access.authenticate("operator", "Wrong-pass-123!")).toThrow(
        "Invalid username or password",
      );
    expect(
      access.listUsers().find((item) => item.id === user.id),
    ).toMatchObject({
      failedLoginCount: 5,
    });
    expect(
      access.listUsers().find((item) => item.id === user.id)?.lockedUntil,
    ).toBeTruthy();
    expect(() => access.authenticate("operator", "Operator-pass-123!")).toThrow(
      "Invalid username or password",
    );
    database.db
      .prepare(
        "UPDATE users SET locked_until='2000-01-01T00:00:00.000Z' WHERE id=?",
      )
      .run(user.id);
    expect(access.authenticate("operator", "Operator-pass-123!").user.id).toBe(
      user.id,
    );
    expect(
      access.listUsers().find((item) => item.id === user.id),
    ).toMatchObject({
      failedLoginCount: 0,
      lockedUntil: null,
    });
    database.close();
  });
});
