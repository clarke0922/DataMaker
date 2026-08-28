export type ErrorCategory =
  | "VALIDATION"
  | "AUTHENTICATION"
  | "AUTHORIZATION"
  | "NOT_FOUND"
  | "CONFLICT"
  | "SOURCE"
  | "PARSER"
  | "DATABASE"
  | "INTERNAL";

export interface AppErrorDto {
  code: string;
  category: ErrorCategory;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export type ApiResult<T> =
  | { ok: true; data: T; requestId: string }
  | { ok: false; error: AppErrorDto; requestId: string };

export interface SystemInfoDto {
  version: string;
  platform: string;
  databasePath: string;
  apiPort: number | null;
  initialized: boolean;
}
export interface UpdateStatusDto {
  state:
    | "idle"
    | "checking"
    | "up_to_date"
    | "available"
    | "downloading"
    | "downloaded"
    | "error";
  version: string | null;
  progress: number;
  error: string | null;
}

export interface MetadataStatsDto {
  sources: number;
  tables: number;
  columns: number;
  relations: number;
  qualityIssues: number;
}

export interface SearchHitDto {
  id: string;
  objectType: "table" | "column";
  name: string;
  path: string;
  comment: string | null;
}

export type ManagementModule =
  | "weights"
  | "dictionaries"
  | "dictionaryTree"
  | "factors"
  | "imports"
  | "tables"
  | "privateTables"
  | "dailyCounts"
  | "cubes"
  | "categories"
  | "dictionaryDefinitions"
  | "dictionaryValues";

export interface ManagementRecordDto {
  id: string;
  [key: string]: string | number | boolean | null;
}

export interface SaveManagementRecordInput {
  id?: string;
  values: Record<string, string | number | boolean | null>;
}

export type UserStatus = "active" | "locked" | "disabled";
export interface UserDto {
  id: string;
  username: string;
  displayName: string;
  status: UserStatus;
  roleIds: string[];
  failedLoginCount: number;
  lockedUntil: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface SaveUserInput {
  id?: string;
  username: string;
  displayName: string;
  status: UserStatus;
  password?: string;
  roleIds: string[];
}
export interface RoleDto {
  id: string;
  code: string;
  name: string;
  builtIn: boolean;
  permissionIds: string[];
}
export interface SaveRoleInput {
  id?: string;
  code: string;
  name: string;
  permissionIds: string[];
}
export interface PermissionDto {
  id: string;
  code: string;
  domain: string;
  action: string;
  description: string;
}
export interface SavePermissionInput {
  id?: string;
  code: string;
  domain: string;
  action: string;
  description: string;
}
export interface QualityRuleDto {
  id: string;
  code: string;
  name: string;
  ruleType: string;
  severity: "info" | "warning" | "error";
  enabled: boolean;
  issueCount: number;
  config: QualityRuleConfig;
}
export interface QualityRuleConfig {
  namingPattern?: string;
  identifierNames?: string[];
  identifierSuffixes?: string[];
}
export interface UpdateQualityRuleInput {
  enabled: boolean;
  severity: "info" | "warning" | "error";
  config: QualityRuleConfig;
}
export interface QualityResultDto {
  id: string;
  ruleId: string;
  ruleCode: string;
  ruleName: string;
  objectType: string;
  objectId: string;
  objectName: string;
  severity: string;
  message: string;
  status: "open" | "resolved" | "ignored";
  resolutionNote: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  createdAt: string;
}
export interface UpdateQualityResultInput {
  status: "open" | "resolved" | "ignored";
  resolutionNote?: string;
}
export interface QualityResultQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  severity?: string;
  status?: "open" | "resolved" | "ignored";
  tableId?: string;
}
export interface QualityResultPageDto {
  items: QualityResultDto[];
  total: number;
  page: number;
  pageSize: number;
  lastRunAt: string | null;
  stale: boolean;
}
export interface QualityRunSummaryDto {
  checkedRules: number;
  checkedObjects: number;
  issues: number;
  results: QualityResultDto[];
}
export type DataSourceType = "sqlite" | "sql_file";
export interface DataSourceDto {
  id: string;
  name: string;
  type: DataSourceType;
  filePath: string;
  status: string;
  lastError: string | null;
  lastScannedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface SaveDataSourceInput {
  id?: string;
  name: string;
  type: DataSourceType;
  filePath: string;
}
export interface ScanSummaryDto {
  sourceId: string;
  tables: number;
  columns: number;
  relations: number;
  added: number;
  updated: number;
  retired: number;
  scannedAt: string;
  warnings: string[];
}
export interface ScanPreviewDto {
  sourceId: string;
  added: string[];
  updated: string[];
  retired: string[];
  unchanged: number;
}
export interface TaskDto {
  id: string;
  kind: "scan";
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  progress: number;
  result: ScanSummaryDto | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface QualityTaskDto {
  id: string;
  kind: "quality";
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  progress: number;
  result: QualityRunSummaryDto | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface MetadataColumnDto {
  id: string;
  name: string;
  ordinal: number;
  rawType: string;
  normalizedType: string;
  nullable: boolean;
  defaultValue: string | null;
  comment: string | null;
  primaryKeyOrdinal: number | null;
  tags: string[];
}
export interface MetadataIndexDto {
  id: string;
  name: string;
  unique: boolean;
  origin: string;
  columns: string[];
  rawDdl: string | null;
}
export interface MetadataTableDto {
  id: string;
  sourceId: string;
  sourceName: string;
  schemaName: string;
  name: string;
  objectType: string;
  comment: string | null;
  rawDdl: string | null;
  retired: boolean;
  updatedAt: string;
  tags: string[];
  columns: MetadataColumnDto[];
  indexes: MetadataIndexDto[];
}
export interface MetadataTableQuery {
  page?: number;
  pageSize?: number;
  search?: string;
}
export interface MetadataTablePageDto {
  items: MetadataTableDto[];
  total: number;
  page: number;
  pageSize: number;
}
export interface MetadataTableOptionDto {
  id: string;
  sourceId: string;
  sourceName: string;
  schemaName: string;
  name: string;
  retired: boolean;
}
export interface UpdateMetadataObjectInput {
  objectType: "table" | "column";
  objectId: string;
  comment: string;
  tags: string[];
}
export interface RelationColumnMappingDto {
  sourceColumnId: string;
  sourceColumnName: string;
  targetColumnId: string;
  targetColumnName: string;
  ordinal: number;
}
export interface RelationDto {
  id: string;
  sourceTableId: string;
  sourceTableName: string;
  targetTableId: string;
  targetTableName: string;
  relationType: string;
  origin: "physical" | "inferred" | "manual";
  confidence: number | null;
  status: "candidate" | "confirmed" | "rejected";
  evidence: string | null;
  columnMappings: string[];
  columnMappingDetails: RelationColumnMappingDto[];
}
export interface RelationColumnMappingInput {
  sourceColumnId: string;
  targetColumnId: string;
}
export interface SaveRelationInput {
  id?: string;
  sourceTableId: string;
  targetTableId: string;
  relationType: string;
  status: "candidate" | "confirmed" | "rejected";
  evidence?: string;
  columnMappings?: RelationColumnMappingInput[];
}
export interface ExportDictionaryDto {
  fileName: string;
  content: string;
  tableCount: number;
  generatedAt: string;
}
export interface ExportDictionaryInput {
  sourceIds?: string[];
  tableIds?: string[];
  includeQuality?: boolean;
  includeRelations?: boolean;
  includeRawTypes?: boolean;
}
export interface ExportTaskDto {
  id: string;
  kind: "export";
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  progress: number;
  result: ExportDictionaryDto | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface AuditLogDto {
  id: string;
  actorUserId: string | null;
  actorUsername: string | null;
  action: string;
  objectType: string | null;
  objectId: string | null;
  result: string;
  context: string;
  occurredAt: string;
}
export interface AuditLogQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  result?: "success" | "failure";
}
export interface AuditLogPageDto {
  items: AuditLogDto[];
  total: number;
  page: number;
  pageSize: number;
}
export interface SavedQueryDto {
  id: string;
  name: string;
  query: string;
  createdAt: string;
}
export interface LoginInput {
  username: string;
  password: string;
}
export interface SessionDto {
  token: string;
  user: UserDto;
  permissions: string[];
  expiresAt: string;
}

export interface DesktopApi {
  auth: {
    initialize(input: SaveUserInput): Promise<ApiResult<SessionDto>>;
    login(input: LoginInput): Promise<ApiResult<SessionDto>>;
    logout(): Promise<ApiResult<void>>;
    session(): Promise<ApiResult<SessionDto | null>>;
  };
  system: {
    info(): Promise<ApiResult<SystemInfoDto>>;
    chooseImportFile(): Promise<ApiResult<string | null>>;
    saveTextFile(
      fileName: string,
      content: string,
    ): Promise<ApiResult<string | null>>;
    backupDatabase(): Promise<ApiResult<string | null>>;
    restoreDatabase(): Promise<ApiResult<boolean>>;
    checkForUpdates(): Promise<ApiResult<UpdateStatusDto>>;
    updateStatus(): Promise<ApiResult<UpdateStatusDto>>;
    installUpdate(): Promise<ApiResult<boolean>>;
  };
  metadata: {
    stats(): Promise<ApiResult<MetadataStatsDto>>;
    search(query: string): Promise<ApiResult<SearchHitDto[]>>;
    listTables(
      query?: MetadataTableQuery,
    ): Promise<ApiResult<MetadataTablePageDto>>;
    listTableOptions(): Promise<ApiResult<MetadataTableOptionDto[]>>;
    getTable(id: string): Promise<ApiResult<MetadataTableDto>>;
    listRelations(): Promise<ApiResult<RelationDto[]>>;
    saveRelation(input: SaveRelationInput): Promise<ApiResult<RelationDto>>;
    removeRelation(id: string): Promise<ApiResult<void>>;
    updateObject(input: UpdateMetadataObjectInput): Promise<ApiResult<void>>;
    listSavedQueries(): Promise<ApiResult<SavedQueryDto[]>>;
    saveQuery(name: string, query: string): Promise<ApiResult<SavedQueryDto>>;
    removeSavedQuery(id: string): Promise<ApiResult<void>>;
  };
  management: {
    list(module: ManagementModule): Promise<ApiResult<ManagementRecordDto[]>>;
    save(
      module: ManagementModule,
      input: SaveManagementRecordInput,
    ): Promise<ApiResult<ManagementRecordDto>>;
    remove(module: ManagementModule, id: string): Promise<ApiResult<void>>;
  };
  quality: {
    listRules(): Promise<ApiResult<QualityRuleDto[]>>;
    listResults(
      query?: QualityResultQuery,
    ): Promise<ApiResult<QualityResultPageDto>>;
    updateResult(
      id: string,
      input: UpdateQualityResultInput,
    ): Promise<ApiResult<QualityResultDto>>;
    run(): Promise<ApiResult<QualityTaskDto>>;
    listTasks(): Promise<ApiResult<QualityTaskDto[]>>;
    task(id: string): Promise<ApiResult<QualityTaskDto>>;
    cancelTask(id: string): Promise<ApiResult<QualityTaskDto>>;
    setRuleEnabled(
      id: string,
      enabled: boolean,
    ): Promise<ApiResult<QualityRuleDto>>;
    updateRule(
      id: string,
      input: UpdateQualityRuleInput,
    ): Promise<ApiResult<QualityRuleDto>>;
  };
  sources: {
    list(): Promise<ApiResult<DataSourceDto[]>>;
    save(input: SaveDataSourceInput): Promise<ApiResult<DataSourceDto>>;
    remove(id: string): Promise<ApiResult<void>>;
    scan(id: string): Promise<ApiResult<TaskDto>>;
    preview(id: string): Promise<ApiResult<ScanPreviewDto>>;
    task(id: string): Promise<ApiResult<TaskDto>>;
    listTasks(): Promise<ApiResult<TaskDto[]>>;
    cancelTask(id: string): Promise<ApiResult<TaskDto>>;
  };
  exports: {
    metadataDictionary(
      input?: ExportDictionaryInput,
    ): Promise<ApiResult<ExportTaskDto>>;
    task(id: string): Promise<ApiResult<ExportTaskDto>>;
    listTasks(): Promise<ApiResult<ExportTaskDto[]>>;
    cancelTask(id: string): Promise<ApiResult<ExportTaskDto>>;
  };
  audit: {
    list(query?: AuditLogQuery): Promise<ApiResult<AuditLogPageDto>>;
  };
  access: {
    listUsers(): Promise<ApiResult<UserDto[]>>;
    saveUser(input: SaveUserInput): Promise<ApiResult<UserDto>>;
    removeUser(id: string): Promise<ApiResult<void>>;
    listRoles(): Promise<ApiResult<RoleDto[]>>;
    saveRole(input: SaveRoleInput): Promise<ApiResult<RoleDto>>;
    removeRole(id: string): Promise<ApiResult<void>>;
    listPermissions(): Promise<ApiResult<PermissionDto[]>>;
    savePermission(
      input: SavePermissionInput,
    ): Promise<ApiResult<PermissionDto>>;
    removePermission(id: string): Promise<ApiResult<void>>;
  };
}

export const IPC_CHANNELS = {
  authInitialize: "auth:initialize",
  authLogin: "auth:login",
  authLogout: "auth:logout",
  authSession: "auth:session",
  systemInfo: "system:info",
  systemChooseImportFile: "system:choose-import-file",
  systemSaveTextFile: "system:save-text-file",
  systemBackupDatabase: "system:backup-database",
  systemRestoreDatabase: "system:restore-database",
  systemCheckForUpdates: "system:check-for-updates",
  systemUpdateStatus: "system:update-status",
  systemInstallUpdate: "system:install-update",
  metadataStats: "metadata:stats",
  metadataSearch: "metadata:search",
  metadataListTables: "metadata:tables:list",
  metadataListTableOptions: "metadata:tables:options",
  metadataGetTable: "metadata:tables:get",
  metadataListRelations: "metadata:relations:list",
  metadataSaveRelation: "metadata:relations:save",
  metadataRemoveRelation: "metadata:relations:remove",
  metadataUpdateObject: "metadata:object:update",
  metadataListSavedQueries: "metadata:queries:list",
  metadataSaveQuery: "metadata:queries:save",
  metadataRemoveSavedQuery: "metadata:queries:remove",
  managementList: "management:list",
  managementSave: "management:save",
  managementRemove: "management:remove",
  qualityListRules: "quality:rules:list",
  qualityListResults: "quality:results:list",
  qualityUpdateResult: "quality:results:update",
  qualityRun: "quality:run",
  qualitySetRuleEnabled: "quality:rules:enabled",
  qualityUpdateRule: "quality:rules:update",
  qualityTask: "quality:task",
  qualityListTasks: "quality:tasks:list",
  qualityCancelTask: "quality:task:cancel",
  sourcesList: "sources:list",
  sourcesSave: "sources:save",
  sourcesRemove: "sources:remove",
  sourcesScan: "sources:scan",
  sourcesPreview: "sources:preview",
  sourcesTask: "sources:task",
  sourcesListTasks: "sources:tasks:list",
  sourcesCancelTask: "sources:task:cancel",
  exportsMetadataDictionary: "exports:metadata-dictionary",
  exportsTask: "exports:task",
  exportsTasks: "exports:tasks",
  exportsCancelTask: "exports:cancel-task",
  auditList: "audit:list",
  accessListUsers: "access:users:list",
  accessSaveUser: "access:users:save",
  accessRemoveUser: "access:users:remove",
  accessListRoles: "access:roles:list",
  accessSaveRole: "access:roles:save",
  accessRemoveRole: "access:roles:remove",
  accessListPermissions: "access:permissions:list",
  accessSavePermission: "access:permissions:save",
  accessRemovePermission: "access:permissions:remove",
} as const;
