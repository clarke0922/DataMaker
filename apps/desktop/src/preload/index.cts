import { contextBridge, ipcRenderer } from "electron";
import type {
  DesktopApi,
  AuditLogQuery,
  AuditStatisticsQuery,
  ChangePasswordInput,
  ExportDictionaryInput,
  LoginInput,
  ManagementModule,
  MetadataTableQuery,
  QualityResultQuery,
  SaveDataSourceInput,
  SaveManagementRecordInput,
  SavePermissionInput,
  SaveRelationInput,
  SaveRoleInput,
  SaveUserInput,
  UpdateMetadataObjectInput,
  UpdateProfileInput,
  UpdateQualityResultInput,
  UpdateQualityRuleInput,
} from "@datamaker/contracts";

// Preload runs as sandboxed CommonJS. Keep runtime channel names local so this
// bridge never requires the ESM contracts package at startup.
const channels = {
  authInitialize: "auth:initialize",
  authLogin: "auth:login",
  authLogout: "auth:logout",
  authSession: "auth:session",
  authUpdateProfile: "auth:update-profile",
  authChangePassword: "auth:change-password",
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
  auditStatistics: "audit:statistics",
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

let sessionToken: string | undefined;
const invoke = (channel: string, ...args: unknown[]) =>
  ipcRenderer.invoke(channel, sessionToken, ...args);

const api: DesktopApi = Object.freeze({
  auth: Object.freeze({
    initialize: async (input: SaveUserInput) => {
      const result = await ipcRenderer.invoke(channels.authInitialize, input);
      if (result.ok) sessionToken = result.data.token;
      return result;
    },
    login: async (input: LoginInput) => {
      const result = await ipcRenderer.invoke(channels.authLogin, input);
      if (result.ok) sessionToken = result.data.token;
      return result;
    },
    logout: async () => {
      const result = await ipcRenderer.invoke(
        channels.authLogout,
        sessionToken,
      );
      sessionToken = undefined;
      return result;
    },
    session: () => ipcRenderer.invoke(channels.authSession, sessionToken),
    updateProfile: (input: UpdateProfileInput) =>
      invoke(channels.authUpdateProfile, input),
    changePassword: (input: ChangePasswordInput) =>
      invoke(channels.authChangePassword, input),
  }),
  system: Object.freeze({
    info: () => ipcRenderer.invoke(channels.systemInfo),
    chooseImportFile: () => invoke(channels.systemChooseImportFile),
    saveTextFile: (fileName: string, content: string) =>
      invoke(channels.systemSaveTextFile, fileName, content),
    backupDatabase: () => invoke(channels.systemBackupDatabase),
    restoreDatabase: () => invoke(channels.systemRestoreDatabase),
    checkForUpdates: () => invoke(channels.systemCheckForUpdates),
    updateStatus: () => invoke(channels.systemUpdateStatus),
    installUpdate: () => invoke(channels.systemInstallUpdate),
  }),
  metadata: Object.freeze({
    stats: () => invoke(channels.metadataStats),
    search: (query: string) => invoke(channels.metadataSearch, query),
    listTables: (query?: MetadataTableQuery) =>
      invoke(channels.metadataListTables, query ?? {}),
    listTableOptions: () => invoke(channels.metadataListTableOptions),
    getTable: (id: string) => invoke(channels.metadataGetTable, id),
    listRelations: () => invoke(channels.metadataListRelations),
    saveRelation: (input: SaveRelationInput) =>
      invoke(channels.metadataSaveRelation, input),
    removeRelation: (id: string) => invoke(channels.metadataRemoveRelation, id),
    updateObject: (input: UpdateMetadataObjectInput) =>
      invoke(channels.metadataUpdateObject, input),
    listSavedQueries: () => invoke(channels.metadataListSavedQueries),
    saveQuery: (name: string, query: string) =>
      invoke(channels.metadataSaveQuery, name, query),
    removeSavedQuery: (id: string) =>
      invoke(channels.metadataRemoveSavedQuery, id),
  }),
  management: Object.freeze({
    list: (module: ManagementModule) => invoke(channels.managementList, module),
    save: (module: ManagementModule, input: SaveManagementRecordInput) =>
      invoke(channels.managementSave, module, input),
    remove: (module: ManagementModule, id: string) =>
      invoke(channels.managementRemove, module, id),
  }),
  quality: Object.freeze({
    listRules: () => invoke(channels.qualityListRules),
    listResults: (query?: QualityResultQuery) =>
      invoke(channels.qualityListResults, query ?? {}),
    updateResult: (id: string, input: UpdateQualityResultInput) =>
      invoke(channels.qualityUpdateResult, id, input),
    run: () => invoke(channels.qualityRun),
    task: (id: string) => invoke(channels.qualityTask, id),
    listTasks: () => invoke(channels.qualityListTasks),
    cancelTask: (id: string) => invoke(channels.qualityCancelTask, id),
    setRuleEnabled: (id: string, enabled: boolean) =>
      invoke(channels.qualitySetRuleEnabled, id, enabled),
    updateRule: (id: string, input: UpdateQualityRuleInput) =>
      invoke(channels.qualityUpdateRule, id, input),
  }),
  sources: Object.freeze({
    list: () => invoke(channels.sourcesList),
    save: (input: SaveDataSourceInput) => invoke(channels.sourcesSave, input),
    remove: (id: string) => invoke(channels.sourcesRemove, id),
    scan: (id: string) => invoke(channels.sourcesScan, id),
    preview: (id: string) => invoke(channels.sourcesPreview, id),
    task: (id: string) => invoke(channels.sourcesTask, id),
    listTasks: () => invoke(channels.sourcesListTasks),
    cancelTask: (id: string) => invoke(channels.sourcesCancelTask, id),
  }),
  exports: Object.freeze({
    metadataDictionary: (input?: ExportDictionaryInput) =>
      invoke(channels.exportsMetadataDictionary, input ?? {}),
    task: (id: string) => invoke(channels.exportsTask, id),
    listTasks: () => invoke(channels.exportsTasks),
    cancelTask: (id: string) => invoke(channels.exportsCancelTask, id),
  }),
  audit: Object.freeze({
    list: (query?: AuditLogQuery) => invoke(channels.auditList, query ?? {}),
    statistics: (query: AuditStatisticsQuery) => invoke(channels.auditStatistics, query),
  }),
  access: Object.freeze({
    listUsers: () => invoke(channels.accessListUsers),
    saveUser: (input: SaveUserInput) => invoke(channels.accessSaveUser, input),
    removeUser: (id: string) => invoke(channels.accessRemoveUser, id),
    listRoles: () => invoke(channels.accessListRoles),
    saveRole: (input: SaveRoleInput) => invoke(channels.accessSaveRole, input),
    removeRole: (id: string) => invoke(channels.accessRemoveRole, id),
    listPermissions: () => invoke(channels.accessListPermissions),
    savePermission: (input: SavePermissionInput) =>
      invoke(channels.accessSavePermission, input),
    removePermission: (id: string) =>
      invoke(channels.accessRemovePermission, id),
  }),
});

contextBridge.exposeInMainWorld("datamaker", api);
