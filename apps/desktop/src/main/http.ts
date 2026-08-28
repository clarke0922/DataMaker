import Fastify from "fastify";
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { ApplicationServices } from "./services.js";
import type {
  ExportDictionaryInput,
  AuditLogQuery,
  LoginInput,
  ManagementModule,
  MetadataTableQuery,
  SaveDataSourceInput,
  SaveManagementRecordInput,
  SavePermissionInput,
  SaveRelationInput,
  SaveRoleInput,
  SaveUserInput,
  UpdateMetadataObjectInput,
  UpdateQualityResultInput,
  UpdateQualityRuleInput,
} from "@datamaker/contracts";

export async function startHttpServer(services: ApplicationServices) {
  const server = Fastify({ logger: false, bodyLimit: 1024 * 1024 });
  const token = randomBytes(32).toString("base64url");
  const tokenExpiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  server.addHook("preValidation", async (request, reply) => {
    if (
      ["POST", "PATCH"].includes(request.method) &&
      (!request.body ||
        typeof request.body !== "object" ||
        Array.isArray(request.body))
    )
      return reply.code(400).send({
        ok: false,
        requestId: randomBytes(16).toString("hex"),
        error: {
          code: "INVALID_INPUT",
          category: "VALIDATION",
          message: "Request body must be a JSON object",
          retryable: false,
        },
      });
  });
  server.get("/api/v1/health", async () => ({ status: "ok" }));
  server.post("/api/v1/auth/login", async (request) =>
    services.authLogin(request.body as LoginInput),
  );
  server.post("/api/v1/auth/initialize", async (request) =>
    services.authInitialize(request.body as SaveUserInput),
  );
  server.addHook("onRequest", async (request, reply) => {
    if (
      request.url === "/api/v1/health" ||
      request.url === "/api/v1/auth/login" ||
      request.url === "/api/v1/auth/initialize"
    )
      return;
    const initialized = services.systemRequireInitialized();
    if (!initialized.ok) return reply.code(409).send(initialized);
    const supplied =
      request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
    const integration =
      Date.parse(tokenExpiresAt) > Date.now() &&
      supplied.length === token.length &&
      timingSafeEqual(Buffer.from(supplied), Buffer.from(token));
    if (integration) return;
    const permission =
      request.url.includes("/access/users") ||
      request.url.includes("/audit-logs")
        ? "system:user_manage"
        : request.url.includes("/access/roles")
          ? "system:role_manage"
          : request.url.includes("/access/permissions")
            ? "system:permission_manage"
            : request.url.includes("/quality") && request.method !== "GET"
              ? "quality:manage"
              : request.url.includes("/exports")
                ? "export:create"
                : request.url.includes("/sources") && request.method !== "GET"
                  ? "metadata:import"
                  : request.method === "GET"
                    ? "metadata:read"
                    : "metadata:manage";
    const authorized = services.authorize(supplied, permission);
    if (!authorized.ok)
      return reply
        .code(authorized.error.category === "AUTHENTICATION" ? 401 : 403)
        .send(authorized);
    services.enterActor(authorized.data.user.id);
  });
  server.get("/api/v1/system/info", async () => services.systemInfo());
  server.get("/api/v1/metadata/stats", async () => services.metadataStats());
  server.get("/api/v1/search", async (request) =>
    services.metadataSearch(String((request.query as { q?: string }).q ?? "")),
  );
  server.get("/api/v1/metadata/tables", async (request) => {
    const query = request.query as {
      page?: string;
      pageSize?: string;
      search?: string;
    };
    return services.metadataListTables({
      page: Number(query.page) || 1,
      pageSize: Number(query.pageSize) || 20,
      search: query.search,
    });
  });
  server.get("/api/v1/metadata/table-options", async () =>
    services.metadataListTableOptions(),
  );
  server.get("/api/v1/metadata/tables/:id", async (request) =>
    services.metadataGetTable((request.params as { id: string }).id),
  );
  server.get("/api/v1/metadata/relations", async () =>
    services.metadataListRelations(),
  );
  server.post("/api/v1/metadata/relations", async (request) =>
    services.metadataSaveRelation(request.body as SaveRelationInput),
  );
  server.delete("/api/v1/metadata/relations/:id", async (request) =>
    services.metadataRemoveRelation((request.params as { id: string }).id),
  );
  server.patch("/api/v1/metadata/objects/:id", async (request) =>
    services.metadataUpdateObject({
      ...(request.body as UpdateMetadataObjectInput),
      objectId: (request.params as { id: string }).id,
    }),
  );
  server.get("/api/v1/metadata/saved-queries", async () =>
    services.metadataListSavedQueries(),
  );
  server.post("/api/v1/metadata/saved-queries", async (request) => {
    const body = request.body as { name: string; query: string };
    return services.metadataSaveQuery(body.name, body.query);
  });
  server.delete("/api/v1/metadata/saved-queries/:id", async (request) =>
    services.metadataRemoveSavedQuery((request.params as { id: string }).id),
  );
  server.get("/api/v1/management/:module", async (request) =>
    services.managementList(
      (request.params as { module: ManagementModule }).module,
    ),
  );
  server.post("/api/v1/management/:module", async (request) =>
    services.managementSave(
      (request.params as { module: ManagementModule }).module,
      request.body as SaveManagementRecordInput,
    ),
  );
  server.delete("/api/v1/management/:module/:id", async (request) => {
    const params = request.params as { module: ManagementModule; id: string };
    return services.managementRemove(params.module, params.id);
  });
  server.get("/api/v1/quality/rules", async () => services.qualityListRules());
  server.get("/api/v1/quality/results", async (request) => {
    const query = request.query as {
      page?: string;
      pageSize?: string;
      search?: string;
      severity?: string;
      status?: "open" | "resolved" | "ignored";
      tableId?: string;
    };
    return services.qualityListResults({
      page: Number(query.page) || 1,
      pageSize: Number(query.pageSize) || 20,
      search: query.search,
      severity: query.severity,
      status: query.status,
      tableId: query.tableId,
    });
  });
  server.patch("/api/v1/quality/results/:id", async (request) =>
    services.qualityUpdateResult(
      (request.params as { id: string }).id,
      request.body as UpdateQualityResultInput,
    ),
  );
  server.post("/api/v1/quality/run", async () => services.qualityRun());
  server.get("/api/v1/quality/tasks/:id", async (request) =>
    services.qualityTask((request.params as { id: string }).id),
  );
  server.get("/api/v1/quality/tasks", async () => services.qualityListTasks());
  server.delete("/api/v1/quality/tasks/:id", async (request) =>
    services.qualityCancelTask((request.params as { id: string }).id),
  );
  server.patch("/api/v1/quality/rules/:id", async (request) =>
    services.qualityUpdateRule(
      (request.params as { id: string }).id,
      request.body as UpdateQualityRuleInput,
    ),
  );
  server.get("/api/v1/sources", async () => services.sourcesList());
  server.post("/api/v1/sources", async (request) =>
    services.sourcesSave(request.body as SaveDataSourceInput),
  );
  server.delete("/api/v1/sources/:id", async (request) =>
    services.sourcesRemove((request.params as { id: string }).id),
  );
  server.post("/api/v1/sources/:id/scan", async (request) =>
    services.sourcesScan((request.params as { id: string }).id),
  );
  server.get("/api/v1/sources/:id/preview", async (request) =>
    services.sourcesPreview((request.params as { id: string }).id),
  );
  server.get("/api/v1/tasks/:id", async (request) =>
    services.sourcesTask((request.params as { id: string }).id),
  );
  server.get("/api/v1/tasks", async () => services.sourcesListTasks());
  server.delete("/api/v1/tasks/:id", async (request) =>
    services.sourcesCancelTask((request.params as { id: string }).id),
  );
  server.post("/api/v1/exports/metadata-dictionary", async (request) =>
    services.exportMetadataDictionary(request.body as ExportDictionaryInput),
  );
  server.get("/api/v1/exports/tasks", async () => services.exportTasksList());
  server.get("/api/v1/exports/tasks/:id", async (request) =>
    services.exportTask((request.params as { id: string }).id),
  );
  server.delete("/api/v1/exports/tasks/:id", async (request) =>
    services.exportCancelTask((request.params as { id: string }).id),
  );
  server.get("/api/v1/audit-logs", async (request) => {
    const query = request.query as {
      page?: string;
      pageSize?: string;
      search?: string;
      result?: "success" | "failure";
    };
    return services.auditList({
      page: Number(query.page) || 1,
      pageSize: Number(query.pageSize) || 20,
      search: query.search,
      result: query.result,
    } satisfies AuditLogQuery);
  });
  server.get("/api/v1/access/users", async () => services.listUsers());
  server.post("/api/v1/access/users", async (request) =>
    services.saveUser(request.body as SaveUserInput),
  );
  server.delete("/api/v1/access/users/:id", async (request) =>
    services.removeUser((request.params as { id: string }).id),
  );
  server.get("/api/v1/access/roles", async () => services.listRoles());
  server.post("/api/v1/access/roles", async (request) =>
    services.saveRole(request.body as SaveRoleInput),
  );
  server.delete("/api/v1/access/roles/:id", async (request) =>
    services.removeRole((request.params as { id: string }).id),
  );
  server.get("/api/v1/access/permissions", async () =>
    services.listPermissions(),
  );
  server.post("/api/v1/access/permissions", async (request) =>
    services.savePermission(request.body as SavePermissionInput),
  );
  server.delete("/api/v1/access/permissions/:id", async (request) =>
    services.removePermission((request.params as { id: string }).id),
  );
  await server.listen({ host: "127.0.0.1", port: 0 });
  const address = server.server.address();
  return {
    server,
    token,
    tokenExpiresAt,
    port: typeof address === "object" && address ? address.port : 0,
  };
}
