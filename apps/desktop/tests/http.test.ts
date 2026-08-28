import { afterEach, describe, expect, it } from "vitest";
import { startHttpServer } from "../src/main/http.js";

const ok = <T>(data: T) => ({ ok: true as const, data, requestId: "test" });
const denied = {
  ok: false as const,
  requestId: "test",
  error: {
    code: "AUTH_REQUIRED",
    category: "AUTHENTICATION" as const,
    message: "Authentication required",
    retryable: false,
  },
};

describe("loopback HTTP API", () => {
  let active: Awaited<ReturnType<typeof startHttpServer>> | undefined;
  afterEach(async () => {
    await active?.server.close();
    active = undefined;
  });
  it("binds only to loopback and protects business routes with bearer tokens", async () => {
    const permissions: Array<string | undefined> = [];
    let initialized = true;
    const services = {
      authorize: (token: string | undefined, permission?: string) => {
        permissions.push(permission);
        return token === "user" ? ok({ user: { id: "u" } }) : denied;
      },
      enterActor: () => undefined,
      systemRequireInitialized: () =>
        initialized
          ? ok(undefined)
          : {
              ...denied,
              error: {
                ...denied.error,
                code: "CONFLICT",
                category: "CONFLICT" as const,
                message: "Application is not initialized",
              },
            },
      metadataStats: () =>
        ok({
          sources: 0,
          tables: 0,
          columns: 0,
          relations: 0,
          qualityIssues: 0,
        }),
      systemInfo: () =>
        ok({
          version: "test",
          platform: "win32",
          databasePath: "test.db",
          apiPort: null,
          initialized: true,
        }),
      exportMetadataDictionary: () =>
        ok({ id: "export-1", kind: "export", status: "running", progress: 5 }),
      exportTask: (id: string) =>
        ok({ id, kind: "export", status: "completed", progress: 100 }),
      qualityUpdateRule: (id: string, input: { severity: string }) =>
        ok({ id, severity: input.severity, config: {}, enabled: true }),
    };
    active = await startHttpServer(services as never);
    const address = active.server.server.address();
    expect(typeof address === "object" && address?.address).toBe("127.0.0.1");
    expect(Date.parse(active.tokenExpiresAt)).toBeGreaterThan(Date.now());
    expect(
      (await active.server.inject({ method: "GET", url: "/api/v1/health" }))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await active.server.inject({
          method: "POST",
          url: "/api/v1/auth/login",
          payload: [],
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await active.server.inject({
          method: "GET",
          url: "/api/v1/metadata/stats",
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await active.server.inject({
          method: "GET",
          url: "/api/v1/system/info",
        })
      ).statusCode,
    ).toBe(401);
    const integrated = await active.server.inject({
      method: "GET",
      url: "/api/v1/metadata/stats",
      headers: { authorization: `Bearer ${active.token}` },
    });
    expect(integrated.statusCode).toBe(200);
    expect(integrated.json()).toMatchObject({ ok: true, data: { tables: 0 } });
    const started = await active.server.inject({
      method: "POST",
      url: "/api/v1/exports/metadata-dictionary",
      headers: { authorization: `Bearer ${active.token}` },
      payload: { includeQuality: false },
    });
    expect(started.json()).toMatchObject({
      ok: true,
      data: { id: "export-1", status: "running" },
    });
    expect(
      (
        await active.server.inject({
          method: "GET",
          url: "/api/v1/exports/metadata-dictionary",
          headers: { authorization: `Bearer ${active.token}` },
        })
      ).statusCode,
    ).toBe(404);
    const completed = await active.server.inject({
      method: "GET",
      url: "/api/v1/exports/tasks/export-1",
      headers: { authorization: `Bearer ${active.token}` },
    });
    expect(completed.json()).toMatchObject({
      ok: true,
      data: { id: "export-1", status: "completed" },
    });
    const configured = await active.server.inject({
      method: "PATCH",
      url: "/api/v1/quality/rules/rule-1",
      headers: { authorization: "Bearer user" },
      payload: { enabled: true, severity: "error", config: {} },
    });
    expect(configured.json()).toMatchObject({
      ok: true,
      data: { id: "rule-1", severity: "error" },
    });
    expect(permissions.at(-1)).toBe("quality:manage");
    initialized = false;
    expect(
      (
        await active.server.inject({
          method: "GET",
          url: "/api/v1/metadata/stats",
          headers: { authorization: `Bearer ${active.token}` },
        })
      ).statusCode,
    ).toBe(409);
  });
});
