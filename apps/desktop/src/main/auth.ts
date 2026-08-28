import { randomBytes } from "node:crypto";
import type { LoginInput, SessionDto } from "@datamaker/contracts";
import type { AccessRepository } from "./access.js";

export class AuthService {
  private sessions = new Map<string, SessionDto>();
  constructor(private readonly access: AccessRepository) {}
  login(input: LoginInput) {
    const authenticated = this.access.authenticate(
      input.username,
      input.password,
    );
    const token = randomBytes(32).toString("base64url");
    const session: SessionDto = {
      token,
      user: authenticated.user,
      permissions: authenticated.permissions,
      expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
    };
    this.sessions.set(token, session);
    return session;
  }
  get(token: string | undefined) {
    if (!token) return null;
    const session = this.sessions.get(token);
    if (!session) return null;
    if (Date.parse(session.expiresAt) <= Date.now()) {
      this.sessions.delete(token);
      return null;
    }
    return session;
  }
  require(token: string | undefined, permission?: string) {
    const session = this.get(token);
    if (!session) throw new Error("Authentication required");
    if (permission && !session.permissions.includes(permission))
      throw new Error(`Permission required: ${permission}`);
    return session;
  }
  logout(token: string | undefined) {
    if (token) this.sessions.delete(token);
  }
  revokeUser(userId: string) {
    for (const [token, session] of this.sessions)
      if (session.user.id === userId) this.sessions.delete(token);
  }
  revokeAll() {
    this.sessions.clear();
  }
}
