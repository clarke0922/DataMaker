import { randomUUID } from "node:crypto";
import type {
  ApiResult,
  AuditLogDto,
  AuditLogPageDto,
  AuditLogQuery,
  DataSourceDto,
  ExportDictionaryInput,
  ExportTaskDto,
  LoginInput,
  ManagementModule,
  ManagementRecordDto,
  MetadataStatsDto,
  MetadataTableDto,
  MetadataTableOptionDto,
  MetadataTablePageDto,
  MetadataTableQuery,
  PermissionDto,
  QualityResultDto,
  QualityResultPageDto,
  QualityResultQuery,
  QualityRuleDto,
  QualityTaskDto,
  RelationDto,
  RoleDto,
  SaveDataSourceInput,
  SaveManagementRecordInput,
  SavePermissionInput,
  SaveRelationInput,
  SaveRoleInput,
  SaveUserInput,
  SavedQueryDto,
  ScanPreviewDto,
  SearchHitDto,
  SessionDto,
  SystemInfoDto,
  TaskDto,
  UpdateMetadataObjectInput,
  UpdateQualityResultInput,
  UpdateQualityRuleInput,
  UserDto,
} from "@datamaker/contracts";
import type { MetadataDatabase } from "./database.js";
import type { MetadataManagementRepository } from "./management.js";
import type { AccessRepository } from "./access.js";
import type { QualityRepository } from "./quality.js";
import type { DataSourceRepository } from "./sources.js";
import type { MetadataRepository } from "./metadata.js";
import type { AuditRepository } from "./audit.js";
import type { AuthService } from "./auth.js";
import type { ScanTaskManager } from "./tasks.js";
import type { QualityTaskManager } from "./quality-tasks.js";
import type { ExportTaskManager } from "./export-tasks.js";

const ok = <T>(data: T): ApiResult<T> => ({
  ok: true,
  data,
  requestId: randomUUID(),
});
export const classifyError = (message: string) => {
  const category: import("@datamaker/contracts").ErrorCategory =
    message === "Authentication required" ||
    message === "Invalid username or password" ||
    /account is locked/i.test(message)
      ? "AUTHENTICATION"
      : message.startsWith("Permission required:")
        ? "AUTHORIZATION"
        : /not found/i.test(message)
          ? "NOT_FOUND"
          : /already|not initialized|not running|no longer running|cannot be (?:deleted|modified)|running data source|while checks are running|unique/i.test(
                message,
              )
            ? "CONFLICT"
            : /data source|source file|file does not exist|unable to open|SQLite source/i.test(
                  message,
                )
              ? "SOURCE"
              : /parse|parser|SQL syntax|supported CREATE TABLE/i.test(message)
                ? "PARSER"
                : /SQLITE_|schema migration|database is locked|database disk image|integrity check|constraint failed/i.test(
                      message,
                    )
                  ? "DATABASE"
                  : /required|invalid|must |cannot exceed|exceeds the allowed|at least|regular expression|password policy/i.test(
                        message,
                      )
                    ? "VALIDATION"
                    : "INTERNAL";
  const code =
    category === "AUTHENTICATION"
      ? "AUTH_REQUIRED"
      : category === "AUTHORIZATION"
        ? "FORBIDDEN"
        : category === "NOT_FOUND"
          ? "NOT_FOUND"
          : category === "CONFLICT"
            ? "CONFLICT"
            : category === "SOURCE"
              ? "SOURCE_ERROR"
              : category === "PARSER"
                ? "PARSE_ERROR"
                : category === "DATABASE"
                  ? "DATABASE_ERROR"
                  : category === "INTERNAL"
                    ? "INTERNAL_ERROR"
                    : "INVALID_INPUT";
  return {
    code,
    category,
    message,
    retryable: ["SOURCE", "DATABASE", "INTERNAL"].includes(category),
  };
};
const fail = (message: string): ApiResult<never> => {
  return {
    ok: false,
    requestId: randomUUID(),
    error: classifyError(message),
  };
};
const attempt = <T>(operation: () => T): ApiResult<T> => {
  try {
    return ok(operation());
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Operation failed");
  }
};

export class ApplicationServices {
  constructor(
    private readonly database: MetadataDatabase,
    private readonly management: MetadataManagementRepository,
    private readonly access: AccessRepository,
    private readonly quality: QualityRepository,
    private readonly sources: DataSourceRepository,
    private readonly metadata: MetadataRepository,
    private readonly audit: AuditRepository,
    private readonly auth: AuthService,
    private readonly tasks: ScanTaskManager,
    private readonly qualityTasks: QualityTaskManager,
    private readonly exportTasks: ExportTaskManager,
    private readonly infoFactory: () => SystemInfoDto,
  ) {}
  private mutation<T>(
    action: string,
    objectType: string,
    objectId: string | null,
    operation: () => T,
  ): ApiResult<T> {
    try {
      return ok(operation());
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Operation failed";
      try {
        this.audit.record(action, objectType, objectId, "failure", {
          error: message,
        });
      } catch {
        // The original operation error remains the actionable failure.
      }
      return fail(message);
    }
  }
  private async asyncMutation<T>(
    action: string,
    objectType: string,
    objectId: string | null,
    operation: () => Promise<T>,
  ): Promise<ApiResult<T>> {
    try {
      return ok(await operation());
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Operation failed";
      try {
        this.audit.record(action, objectType, objectId, "failure", {
          error: message,
        });
      } catch {
        // The original operation error remains the actionable failure.
      }
      return fail(message);
    }
  }
  authLogin(input: LoginInput): ApiResult<SessionDto> {
    try {
      const session = this.auth.login(input);
      this.audit.runAs(session.user.id, () =>
        this.audit.record("auth.login", "user", session.user.id, "success"),
      );
      return ok(session);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Login failed";
      this.audit.record("auth.login", "user", null, "failure", {
        username: input.username,
      });
      return fail(message);
    }
  }
  authInitialize(input: SaveUserInput): ApiResult<SessionDto> {
    return this.mutation("auth.initialize", "user", null, () => {
      if (this.database.initialized())
        throw new Error("Application is already initialized");
      const user = this.access.saveUser({
        ...input,
        status: "active",
        roleIds: [],
      });
      const session = this.auth.login({
        username: input.username,
        password: input.password!,
      });
      this.audit.runAs(user.id, () =>
        this.audit.record("auth.initialize", "user", user.id, "success"),
      );
      return session;
    });
  }
  authSession(token: string | undefined): ApiResult<SessionDto | null> {
    return attempt(() => this.auth.get(token));
  }
  authLogout(token: string | undefined): ApiResult<void> {
    return this.mutation("auth.logout", "session", null, () => {
      const session = this.auth.get(token);
      this.auth.logout(token);
      if (session)
        this.audit.runAs(session.user.id, () =>
          this.audit.record("auth.logout", "user", session.user.id, "success"),
        );
    });
  }
  authorize(token: string | undefined, permission?: string) {
    return attempt(() => this.auth.require(token, permission));
  }
  asActor<T>(actorUserId: string, operation: () => T): T {
    return this.audit.runAs(actorUserId, operation);
  }
  enterActor(actorUserId: string) {
    this.audit.enterActor(actorUserId);
  }
  systemInfo(): ApiResult<SystemInfoDto> {
    return ok(this.infoFactory());
  }
  systemRequireInitialized(): ApiResult<void> {
    return this.database.initialized()
      ? ok(undefined)
      : fail("Application is not initialized");
  }
  metadataStats(): ApiResult<MetadataStatsDto> {
    return ok(this.database.stats());
  }
  metadataSearch(query: string): ApiResult<SearchHitDto[]> {
    if (query.length > 100)
      return fail("Search queries cannot exceed 100 characters");
    return ok(this.database.search(query));
  }
  metadataListTables(
    query: MetadataTableQuery = {},
  ): ApiResult<MetadataTablePageDto> {
    return attempt(() => this.metadata.listTablePage(query));
  }
  metadataListTableOptions(): ApiResult<MetadataTableOptionDto[]> {
    return attempt(() => this.metadata.listTableOptions());
  }
  metadataGetTable(id: string): ApiResult<MetadataTableDto> {
    return attempt(() => this.metadata.getTable(id));
  }
  metadataListRelations(): ApiResult<RelationDto[]> {
    return attempt(() => this.metadata.listRelations());
  }
  metadataSaveRelation(input: SaveRelationInput): ApiResult<RelationDto> {
    return this.mutation(
      input.id ? "relation.update" : "relation.create",
      "relation",
      input.id ?? null,
      () => {
        const row = this.metadata.saveRelation(input);
        this.audit.record(
          input.id ? "relation.update" : "relation.create",
          "relation",
          row.id,
          "success",
        );
        return row;
      },
    );
  }
  metadataRemoveRelation(id: string): ApiResult<void> {
    return this.mutation("relation.delete", "relation", id, () => {
      this.metadata.removeRelation(id);
      this.audit.record("relation.delete", "relation", id, "success");
    });
  }
  metadataUpdateObject(input: UpdateMetadataObjectInput): ApiResult<void> {
    return this.mutation(
      "metadata.update",
      input.objectType,
      input.objectId,
      () => {
        this.metadata.updateObject(input);
        this.audit.record(
          "metadata.update",
          input.objectType,
          input.objectId,
          "success",
        );
      },
    );
  }
  metadataListSavedQueries(): ApiResult<SavedQueryDto[]> {
    return attempt(() =>
      this.metadata.listSavedQueries(this.audit.actorUserId()),
    );
  }
  metadataSaveQuery(name: string, query: string): ApiResult<SavedQueryDto> {
    return this.mutation("query.save", "saved_query", null, () => {
      const row = this.metadata.saveQuery(
        name,
        query,
        this.audit.actorUserId(),
      );
      this.audit.record("query.save", "saved_query", row.id, "success");
      return row;
    });
  }
  metadataRemoveSavedQuery(id: string): ApiResult<void> {
    return this.mutation("query.delete", "saved_query", id, () => {
      this.metadata.removeSavedQuery(id, this.audit.actorUserId());
      this.audit.record("query.delete", "saved_query", id, "success");
    });
  }
  managementList(module: ManagementModule): ApiResult<ManagementRecordDto[]> {
    return attempt(() => this.management.list(module));
  }
  managementSave(
    module: ManagementModule,
    input: SaveManagementRecordInput,
  ): ApiResult<ManagementRecordDto> {
    return this.mutation(
      input.id ? "management.update" : "management.create",
      module,
      input.id ?? null,
      () => {
        const row = this.management.save(module, input);
        this.audit.record(
          input.id ? "management.update" : "management.create",
          module,
          row.id,
          "success",
        );
        return row;
      },
    );
  }
  managementRemove(module: ManagementModule, id: string): ApiResult<void> {
    return this.mutation("management.delete", module, id, () => {
      this.management.remove(module, id);
      this.audit.record("management.delete", module, id, "success");
    });
  }
  qualityListRules(): ApiResult<QualityRuleDto[]> {
    return attempt(() => this.quality.listRules());
  }
  qualityListResults(
    query: QualityResultQuery = {},
  ): ApiResult<QualityResultPageDto> {
    return attempt(() => this.quality.listResultPage(query));
  }
  qualityUpdateResult(
    id: string,
    input: UpdateQualityResultInput,
  ): ApiResult<QualityResultDto> {
    return this.mutation("quality.result.update", "quality_result", id, () => {
      const row = this.quality.updateResult(
        id,
        input,
        this.audit.actorUserId(),
      );
      this.audit.record(
        "quality.result.update",
        "quality_result",
        id,
        "success",
        {
          status: input.status,
        },
      );
      return row;
    });
  }
  qualityRun(): ApiResult<QualityTaskDto> {
    return this.mutation("quality.run.start", "quality", null, () => {
      const task = this.qualityTasks.start(this.audit.actorUserId());
      this.audit.record("quality.run.start", "quality", null, "success", {
        taskId: task.id,
      });
      return task;
    });
  }
  qualityTask(id: string): ApiResult<QualityTaskDto> {
    return attempt(() => this.qualityTasks.get(id));
  }
  qualityListTasks(): ApiResult<QualityTaskDto[]> {
    return attempt(() => this.qualityTasks.list());
  }
  async qualityCancelTask(id: string): Promise<ApiResult<QualityTaskDto>> {
    return this.asyncMutation(
      "quality.run.cancel",
      "quality_task",
      id,
      async () => {
        const task = await this.qualityTasks.cancel(id);
        this.audit.record("quality.run.cancel", "quality_task", id, "success");
        return task;
      },
    );
  }
  qualitySetRuleEnabled(
    id: string,
    enabled: boolean,
  ): ApiResult<QualityRuleDto> {
    return this.mutation("quality.rule.toggle", "quality_rule", id, () => {
      const row = this.quality.setRuleEnabled(id, enabled);
      this.audit.record("quality.rule.toggle", "quality_rule", id, "success", {
        enabled,
      });
      return row;
    });
  }
  qualityUpdateRule(
    id: string,
    input: UpdateQualityRuleInput,
  ): ApiResult<QualityRuleDto> {
    return this.mutation("quality.rule.update", "quality_rule", id, () => {
      const row = this.quality.updateRule(id, input);
      this.audit.record("quality.rule.update", "quality_rule", id, "success", {
        enabled: input.enabled,
        severity: input.severity,
        config: input.config,
      });
      return row;
    });
  }
  sourcesList(): ApiResult<DataSourceDto[]> {
    return attempt(() => this.sources.list());
  }
  sourcesSave(input: SaveDataSourceInput): ApiResult<DataSourceDto> {
    return this.mutation(
      input.id ? "source.update" : "source.create",
      "data_source",
      input.id ?? null,
      () => {
        const row = this.sources.save(input);
        this.audit.record(
          input.id ? "source.update" : "source.create",
          "data_source",
          row.id,
          "success",
        );
        return row;
      },
    );
  }
  sourcesRemove(id: string): ApiResult<void> {
    return this.mutation("source.delete", "data_source", id, () => {
      this.sources.remove(id);
      this.audit.record("source.delete", "data_source", id, "success");
    });
  }
  sourcesScan(id: string): ApiResult<TaskDto> {
    return this.mutation("source.scan.start", "data_source", id, () => {
      const task = this.tasks.start(id, this.audit.actorUserId());
      this.audit.record("source.scan.start", "data_source", id, "success", {
        taskId: task.id,
      });
      return task;
    });
  }
  sourcesPreview(id: string): ApiResult<ScanPreviewDto> {
    return attempt(() => this.sources.preview(id));
  }
  sourcesTask(id: string): ApiResult<TaskDto> {
    return attempt(() => this.tasks.get(id));
  }
  sourcesListTasks(): ApiResult<TaskDto[]> {
    return attempt(() => this.tasks.list());
  }
  async sourcesCancelTask(id: string): Promise<ApiResult<TaskDto>> {
    return this.asyncMutation(
      "source.scan.cancel",
      "scan_task",
      id,
      async () => {
        const task = await this.tasks.cancel(id);
        this.audit.record("source.scan.cancel", "scan_task", id, "success");
        return task;
      },
    );
  }
  exportMetadataDictionary(
    input: ExportDictionaryInput = {},
  ): ApiResult<ExportTaskDto> {
    return this.mutation("export.dictionary.start", "export_task", null, () => {
      const task = this.exportTasks.start(input, this.audit.actorUserId());
      this.audit.record(
        "export.dictionary.start",
        "export_task",
        task.id,
        "success",
        {
          sourceCount: input.sourceIds?.length ?? 0,
          selectedTableCount: input.tableIds?.length ?? 0,
          includeQuality: input.includeQuality !== false,
          includeRelations: input.includeRelations !== false,
        },
      );
      return task;
    });
  }
  exportTask(id: string): ApiResult<ExportTaskDto> {
    return attempt(() => this.exportTasks.get(id));
  }
  exportTasksList(): ApiResult<ExportTaskDto[]> {
    return attempt(() => this.exportTasks.list());
  }
  async exportCancelTask(id: string): Promise<ApiResult<ExportTaskDto>> {
    return this.asyncMutation(
      "export.dictionary.cancel",
      "export_task",
      id,
      async () => {
        const task = await this.exportTasks.cancel(id);
        this.audit.record(
          "export.dictionary.cancel",
          "export_task",
          id,
          "success",
        );
        return task;
      },
    );
  }
  auditList(query: AuditLogQuery = {}): ApiResult<AuditLogPageDto> {
    return attempt(() => this.audit.list(query));
  }
  listUsers(): ApiResult<UserDto[]> {
    return attempt(() => this.access.listUsers());
  }
  saveUser(input: SaveUserInput): ApiResult<UserDto> {
    return this.mutation(
      input.id ? "user.update" : "user.create",
      "user",
      input.id ?? null,
      () => {
        const row = this.access.saveUser(input);
        if (input.id) this.auth.revokeUser(row.id);
        this.audit.record(
          input.id ? "user.update" : "user.create",
          "user",
          row.id,
          "success",
        );
        return row;
      },
    );
  }
  removeUser(id: string): ApiResult<void> {
    return this.mutation("user.delete", "user", id, () => {
      this.access.removeUser(id);
      this.auth.revokeUser(id);
      this.audit.record("user.delete", "user", id, "success");
    });
  }
  listRoles(): ApiResult<RoleDto[]> {
    return attempt(() => this.access.listRoles());
  }
  saveRole(input: SaveRoleInput): ApiResult<RoleDto> {
    return this.mutation(
      input.id ? "role.update" : "role.create",
      "role",
      input.id ?? null,
      () => {
        const row = this.access.saveRole(input);
        this.auth.revokeAll();
        this.audit.record(
          input.id ? "role.update" : "role.create",
          "role",
          row.id,
          "success",
        );
        return row;
      },
    );
  }
  removeRole(id: string): ApiResult<void> {
    return this.mutation("role.delete", "role", id, () => {
      this.access.removeRole(id);
      this.auth.revokeAll();
      this.audit.record("role.delete", "role", id, "success");
    });
  }
  listPermissions(): ApiResult<PermissionDto[]> {
    return attempt(() => this.access.listPermissions());
  }
  savePermission(input: SavePermissionInput): ApiResult<PermissionDto> {
    return this.mutation(
      input.id ? "permission.update" : "permission.create",
      "permission",
      input.id ?? null,
      () => {
        const row = this.access.savePermission(input);
        this.auth.revokeAll();
        this.audit.record(
          input.id ? "permission.update" : "permission.create",
          "permission",
          row.id,
          "success",
        );
        return row;
      },
    );
  }
  removePermission(id: string): ApiResult<void> {
    return this.mutation("permission.delete", "permission", id, () => {
      this.access.removePermission(id);
      this.auth.revokeAll();
      this.audit.record("permission.delete", "permission", id, "success");
    });
  }
}
