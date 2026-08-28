import {
  app,
  BrowserWindow,
  crashReporter,
  dialog,
  ipcMain,
  shell,
} from "electron";
import { backup as backupSqlite } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  IPC_CHANNELS,
  type ManagementModule,
  type SaveManagementRecordInput,
  type SavePermissionInput,
  type SaveRoleInput,
  type SaveUserInput,
  type UpdateQualityResultInput,
  type UpdateQualityRuleInput,
} from "@datamaker/contracts";
import { MetadataDatabase } from "./database.js";
import { ApplicationServices } from "./services.js";
import { startHttpServer } from "./http.js";
import { MetadataManagementRepository } from "./management.js";
import { AccessRepository } from "./access.js";
import { QualityRepository } from "./quality.js";
import { DataSourceRepository } from "./sources.js";
import { MetadataRepository } from "./metadata.js";
import { AuditRepository } from "./audit.js";
import { ExportTaskManager } from "./export-tasks.js";
import { AuthService } from "./auth.js";
import { ScanTaskManager } from "./tasks.js";
import { QualityTaskManager } from "./quality-tasks.js";
import { createFileLogger } from "./logger.js";
import {
  createAutomaticBackup,
  createPreMigrationBackup,
  validateRestoreCandidate,
} from "./backups.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
let database: MetadataDatabase | undefined;
let http: Awaited<ReturnType<typeof startHttpServer>> | undefined;
let mainWindow: BrowserWindow | undefined;
let integrationStatePath: string | undefined;
let scanTasks: ScanTaskManager | undefined;
let qualityTaskManager: QualityTaskManager | undefined;
let exportTaskManager: ExportTaskManager | undefined;
let shutdownStarted = false;
let shutdownComplete = false;

app.setName("DataMaker");
app.setAppLogsPath();
const logger = createFileLogger(app.getPath("logs"));
crashReporter.start({ uploadToServer: false });
const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();
app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

async function bootstrap() {
  logger.info("Application bootstrap started", {
    version: app.getVersion(),
    platform: process.platform,
  });
  const databasePath = path.join(app.getPath("userData"), "datamaker.db");
  const pendingRestore = `${databasePath}.restore-pending`;
  let restored = false;
  if (fs.existsSync(pendingRestore)) {
    try {
      validateRestoreCandidate(pendingRestore);
      fs.copyFileSync(pendingRestore, databasePath);
      fs.unlinkSync(pendingRestore);
      restored = true;
    } catch (error) {
      fs.unlinkSync(pendingRestore);
      logger.error(
        "Pending restore was rejected; current database retained",
        error,
      );
    }
  }
  try {
    const migrationBackup = await createPreMigrationBackup(
      databasePath,
      path.join(app.getPath("userData"), "backups"),
    );
    if (migrationBackup)
      logger.info("Pre-migration database backup created", {
        path: migrationBackup,
      });
  } catch (error) {
    logger.error("Pre-migration database backup failed", error);
  }
  database = new MetadataDatabase(databasePath);
  if (restored) {
    database.rebuildSearchIndex();
    logger.info("Restored database search index rebuilt");
  }
  try {
    const backup = await createAutomaticBackup(
      database.db,
      databasePath,
      path.join(app.getPath("userData"), "backups"),
    );
    if (backup)
      logger.info("Automatic database backup created", { path: backup });
  } catch (error) {
    logger.error("Automatic database backup failed", error);
  }
  const management = new MetadataManagementRepository(database.db);
  const access = new AccessRepository(database.db);
  const quality = new QualityRepository(database.db);
  const sources = new DataSourceRepository(database.db);
  const metadata = new MetadataRepository(database.db);
  const audit = new AuditRepository(database.db);
  const auth = new AuthService(access);
  const recordAs = (actorUserId: string | null, operation: () => void) => {
    if (actorUserId) audit.runAs(actorUserId, operation);
    else operation();
  };
  const tasks = (scanTasks = new ScanTaskManager(
    database.db,
    databasePath,
    (id, sourceId, result, error, actorUserId) => {
      recordAs(actorUserId, () =>
        audit.record(
          "source.scan",
          "scan_task",
          id,
          error ? "failure" : "success",
          error
            ? { sourceId, error }
            : {
                sourceId,
                tables: result?.tables ?? 0,
                columns: result?.columns ?? 0,
                relations: result?.relations ?? 0,
              },
        ),
      );
    },
  ));
  const qualityTasks = (qualityTaskManager = new QualityTaskManager(
    database.db,
    databasePath,
    (id, result, error, actorUserId) =>
      recordAs(actorUserId, () =>
        audit.record(
          "quality.run",
          "quality_task",
          id,
          error ? "failure" : "success",
          error
            ? { error }
            : {
                checkedRules: result?.checkedRules ?? 0,
                checkedObjects: result?.checkedObjects ?? 0,
                issues: result?.issues ?? 0,
              },
        ),
      ),
  ));
  const exportTasks = (exportTaskManager = new ExportTaskManager(
    database.db,
    databasePath,
    (id, result, error, actorUserId) => {
      const record = () =>
        audit.record(
          "export.dictionary",
          "export_task",
          id,
          error ? "failure" : "success",
          error
            ? { error }
            : {
                tables: result?.tableCount ?? 0,
                generatedAt: result?.generatedAt,
              },
        );
      recordAs(actorUserId, record);
    },
  ));
  let apiPort: number | null = null;
  const services = new ApplicationServices(
    database,
    management,
    access,
    quality,
    sources,
    metadata,
    audit,
    auth,
    tasks,
    qualityTasks,
    exportTasks,
    () => ({
      version: app.getVersion(),
      platform: process.platform,
      databasePath,
      apiPort,
      initialized: database!.initialized(),
    }),
  );
  const secure =
    (permission: string, operation: (...args: any[]) => unknown) =>
    (_event: unknown, token: string | undefined, ...args: any[]) => {
      const authorized = services.authorize(token, permission);
      return authorized.ok
        ? services.asActor(authorized.data.user.id, () => operation(...args))
        : authorized;
    };
  http = await startHttpServer(services);
  apiPort = http.port;
  integrationStatePath = path.join(app.getPath("userData"), "local-api.json");
  fs.writeFileSync(
    integrationStatePath,
    JSON.stringify(
      {
        host: "127.0.0.1",
        port: http.port,
        token: http.token,
        tokenExpiresAt: http.tokenExpiresAt,
        pid: process.pid,
      },
      null,
      2,
    ),
    { encoding: "utf8", mode: 0o600 },
  );
  logger.info("Loopback API started", { host: "127.0.0.1", port: http.port });

  ipcMain.handle(IPC_CHANNELS.authInitialize, (_event, input: SaveUserInput) =>
    services.authInitialize(input),
  );
  ipcMain.handle(IPC_CHANNELS.authLogin, (_event, input) =>
    services.authLogin(input),
  );
  ipcMain.handle(
    IPC_CHANNELS.authSession,
    (_event, token: string | undefined) => services.authSession(token),
  );
  ipcMain.handle(IPC_CHANNELS.authLogout, (_event, token: string | undefined) =>
    services.authLogout(token),
  );

  ipcMain.handle(IPC_CHANNELS.systemInfo, () => services.systemInfo());
  ipcMain.handle(
    IPC_CHANNELS.systemChooseImportFile,
    async (_event, token: string | undefined) => {
      const authorized = services.authorize(token, "metadata:import");
      if (!authorized.ok) return authorized;
      const result = await dialog.showOpenDialog({
        properties: ["openFile"],
        filters: [
          {
            name: "Supported data files",
            extensions: ["sql", "sqlite", "sqlite3", "db", "xlsx", "xls"],
          },
          { name: "All files", extensions: ["*"] },
        ],
      });
      return {
        ok: true,
        data: result.canceled ? null : (result.filePaths[0] ?? null),
        requestId: crypto.randomUUID(),
      };
    },
  );
  ipcMain.handle(
    IPC_CHANNELS.systemSaveTextFile,
    async (
      _event,
      token: string | undefined,
      fileName: string,
      content: string,
    ) => {
      const authorized = services.authorize(token, "export:create");
      if (!authorized.ok) return authorized;
      return services.asActor(authorized.data.user.id, async () => {
        try {
          const result = await dialog.showSaveDialog({
            defaultPath: fileName,
            filters: [{ name: "Markdown", extensions: ["md"] }],
          });
          if (result.canceled || !result.filePath)
            return { ok: true, data: null, requestId: crypto.randomUUID() };
          const temporaryPath = path.join(
            path.dirname(result.filePath),
            `.${path.basename(result.filePath)}.${crypto.randomUUID()}.tmp`,
          );
          try {
            fs.writeFileSync(temporaryPath, content, "utf8");
            fs.renameSync(temporaryPath, result.filePath);
          } finally {
            if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
          }
          audit.record("export.dictionary.save", "file", null, "success", {
            fileName: path.basename(result.filePath),
          });
          return {
            ok: true,
            data: result.filePath,
            requestId: crypto.randomUUID(),
          };
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "File save failed";
          audit.record("export.dictionary.save", "file", null, "failure", {
            error: message,
          });
          return {
            ok: false,
            error: {
              code: "FILE_SAVE_FAILED",
              category: "INTERNAL",
              message,
              retryable: true,
            },
            requestId: crypto.randomUUID(),
          };
        }
      });
    },
  );
  ipcMain.handle(
    IPC_CHANNELS.systemBackupDatabase,
    async (_event, token: string | undefined) => {
      const authorized = services.authorize(token, "export:create");
      if (!authorized.ok) return authorized;
      return services.asActor(authorized.data.user.id, async () => {
        try {
          const result = await dialog.showSaveDialog({
            defaultPath: `datamaker-backup-${new Date().toISOString().slice(0, 10)}.db`,
            filters: [{ name: "SQLite database", extensions: ["db"] }],
          });
          if (result.canceled || !result.filePath)
            return { ok: true, data: null, requestId: crypto.randomUUID() };
          await backupSqlite(database!.db, result.filePath);
          audit.record("system.backup", "database", null, "success", {
            fileName: path.basename(result.filePath),
          });
          return {
            ok: true,
            data: result.filePath,
            requestId: crypto.randomUUID(),
          };
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Backup failed";
          audit.record("system.backup", "database", null, "failure", {
            error: message,
          });
          return {
            ok: false,
            error: {
              code: "BACKUP_FAILED",
              category: "DATABASE",
              message,
              retryable: true,
            },
            requestId: crypto.randomUUID(),
          };
        }
      });
    },
  );
  ipcMain.handle(
    IPC_CHANNELS.systemRestoreDatabase,
    async (_event, token: string | undefined) => {
      const authorized = services.authorize(token, "system:user_manage");
      if (!authorized.ok) return authorized;
      return services.asActor(authorized.data.user.id, async () => {
        try {
          const result = await dialog.showOpenDialog({
            properties: ["openFile"],
            filters: [
              {
                name: "SQLite database",
                extensions: ["db", "sqlite", "sqlite3"],
              },
            ],
          });
          if (result.canceled || !result.filePaths[0])
            return { ok: true, data: false, requestId: crypto.randomUUID() };
          validateRestoreCandidate(result.filePaths[0]);
          const backupDirectory = path.join(app.getPath("userData"), "backups");
          fs.mkdirSync(backupDirectory, { recursive: true });
          const safetyBackup = path.join(
            backupDirectory,
            `datamaker-before-restore-${new Date()
              .toISOString()
              .replace(/[:.]/g, "-")}.db`,
          );
          await backupSqlite(database!.db, safetyBackup);
          fs.copyFileSync(result.filePaths[0], pendingRestore);
          audit.record("system.restore.schedule", "database", null, "success", {
            safetyBackup,
          });
          setTimeout(() => {
            app.relaunch();
            app.exit(0);
          }, 200);
          return { ok: true, data: true, requestId: crypto.randomUUID() };
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Restore failed";
          audit.record("system.restore.schedule", "database", null, "failure", {
            error: message,
          });
          return {
            ok: false,
            error: {
              code: "RESTORE_FAILED",
              category: "DATABASE",
              message,
              retryable: false,
            },
            requestId: crypto.randomUUID(),
          };
        }
      });
    },
  );
  ipcMain.handle(
    IPC_CHANNELS.systemCheckForUpdates,
    secure("metadata:read", async () => {
      const updater = await import("./updater.js");
      return {
        ok: true,
        data: await updater.checkForUpdates(),
        requestId: crypto.randomUUID(),
      };
    }),
  );
  ipcMain.handle(
    IPC_CHANNELS.systemUpdateStatus,
    secure("metadata:read", async () => {
      const updater = await import("./updater.js");
      return {
        ok: true,
        data: updater.getUpdateStatus(),
        requestId: crypto.randomUUID(),
      };
    }),
  );
  ipcMain.handle(
    IPC_CHANNELS.systemInstallUpdate,
    secure("metadata:read", async () => {
      const updater = await import("./updater.js");
      const installing = updater.installUpdate();
      if (installing)
        audit.record("system.update.install", "application", null, "success", {
          version: updater.getUpdateStatus().version,
        });
      return {
        ok: true,
        data: installing,
        requestId: crypto.randomUUID(),
      };
    }),
  );
  ipcMain.handle(
    IPC_CHANNELS.metadataStats,
    secure("metadata:read", () => services.metadataStats()),
  );
  ipcMain.handle(
    IPC_CHANNELS.metadataSearch,
    secure("metadata:read", (query: unknown) =>
      services.metadataSearch(typeof query === "string" ? query : ""),
    ),
  );
  ipcMain.handle(
    IPC_CHANNELS.metadataListTables,
    secure("metadata:read", (query) => services.metadataListTables(query)),
  );
  ipcMain.handle(
    IPC_CHANNELS.metadataListTableOptions,
    secure("metadata:read", () => services.metadataListTableOptions()),
  );
  ipcMain.handle(
    IPC_CHANNELS.metadataGetTable,
    secure("metadata:read", (id) => services.metadataGetTable(id)),
  );
  ipcMain.handle(
    IPC_CHANNELS.metadataListRelations,
    secure("metadata:read", () => services.metadataListRelations()),
  );
  ipcMain.handle(
    IPC_CHANNELS.metadataSaveRelation,
    secure("metadata:manage", (input) => services.metadataSaveRelation(input)),
  );
  ipcMain.handle(
    IPC_CHANNELS.metadataRemoveRelation,
    secure("metadata:manage", (id) => services.metadataRemoveRelation(id)),
  );
  ipcMain.handle(
    IPC_CHANNELS.metadataUpdateObject,
    secure("metadata:manage", (input) => services.metadataUpdateObject(input)),
  );
  ipcMain.handle(
    IPC_CHANNELS.metadataListSavedQueries,
    secure("metadata:read", () => services.metadataListSavedQueries()),
  );
  ipcMain.handle(
    IPC_CHANNELS.metadataSaveQuery,
    secure("metadata:read", (name, query) =>
      services.metadataSaveQuery(name, query),
    ),
  );
  ipcMain.handle(
    IPC_CHANNELS.metadataRemoveSavedQuery,
    secure("metadata:read", (id) => services.metadataRemoveSavedQuery(id)),
  );
  ipcMain.handle(
    IPC_CHANNELS.managementList,
    secure("metadata:read", (module) => services.managementList(module)),
  );
  ipcMain.handle(
    IPC_CHANNELS.managementSave,
    secure("metadata:manage", (module, input) =>
      services.managementSave(module, input),
    ),
  );
  ipcMain.handle(
    IPC_CHANNELS.managementRemove,
    secure("metadata:manage", (module, id) =>
      services.managementRemove(module, id),
    ),
  );
  ipcMain.handle(
    IPC_CHANNELS.qualityListRules,
    secure("metadata:read", () => services.qualityListRules()),
  );
  ipcMain.handle(
    IPC_CHANNELS.qualityListResults,
    secure("metadata:read", (query) => services.qualityListResults(query)),
  );
  ipcMain.handle(
    IPC_CHANNELS.qualityUpdateResult,
    secure("quality:manage", (id: string, input: UpdateQualityResultInput) =>
      services.qualityUpdateResult(id, input),
    ),
  );
  ipcMain.handle(
    IPC_CHANNELS.qualityRun,
    secure("quality:manage", () => services.qualityRun()),
  );
  ipcMain.handle(
    IPC_CHANNELS.qualityTask,
    secure("metadata:read", (id) => services.qualityTask(id)),
  );
  ipcMain.handle(
    IPC_CHANNELS.qualityListTasks,
    secure("metadata:read", () => services.qualityListTasks()),
  );
  ipcMain.handle(
    IPC_CHANNELS.qualityCancelTask,
    secure("quality:manage", (id) => services.qualityCancelTask(id)),
  );
  ipcMain.handle(
    IPC_CHANNELS.qualitySetRuleEnabled,
    secure("quality:manage", (id, enabled) =>
      services.qualitySetRuleEnabled(id, enabled),
    ),
  );
  ipcMain.handle(
    IPC_CHANNELS.qualityUpdateRule,
    secure("quality:manage", (id: string, input: UpdateQualityRuleInput) =>
      services.qualityUpdateRule(id, input),
    ),
  );
  ipcMain.handle(
    IPC_CHANNELS.sourcesList,
    secure("metadata:read", () => services.sourcesList()),
  );
  ipcMain.handle(
    IPC_CHANNELS.sourcesSave,
    secure("metadata:import", (input) => services.sourcesSave(input)),
  );
  ipcMain.handle(
    IPC_CHANNELS.sourcesRemove,
    secure("metadata:import", (id) => services.sourcesRemove(id)),
  );
  ipcMain.handle(
    IPC_CHANNELS.sourcesScan,
    secure("metadata:import", (id) => services.sourcesScan(id)),
  );
  ipcMain.handle(
    IPC_CHANNELS.sourcesPreview,
    secure("metadata:import", (id) => services.sourcesPreview(id)),
  );
  ipcMain.handle(
    IPC_CHANNELS.sourcesTask,
    secure("metadata:read", (id) => services.sourcesTask(id)),
  );
  ipcMain.handle(
    IPC_CHANNELS.sourcesListTasks,
    secure("metadata:read", () => services.sourcesListTasks()),
  );
  ipcMain.handle(
    IPC_CHANNELS.sourcesCancelTask,
    secure("metadata:import", (id) => services.sourcesCancelTask(id)),
  );
  ipcMain.handle(
    IPC_CHANNELS.exportsMetadataDictionary,
    secure("export:create", (input) =>
      services.exportMetadataDictionary(input),
    ),
  );
  ipcMain.handle(
    IPC_CHANNELS.exportsTask,
    secure("export:create", (id) => services.exportTask(id)),
  );
  ipcMain.handle(
    IPC_CHANNELS.exportsTasks,
    secure("export:create", () => services.exportTasksList()),
  );
  ipcMain.handle(
    IPC_CHANNELS.exportsCancelTask,
    secure("export:create", (id) => services.exportCancelTask(id)),
  );
  ipcMain.handle(
    IPC_CHANNELS.auditList,
    secure("system:user_manage", (query) => services.auditList(query)),
  );
  ipcMain.handle(
    IPC_CHANNELS.accessListUsers,
    secure("system:user_manage", () => services.listUsers()),
  );
  ipcMain.handle(
    IPC_CHANNELS.accessSaveUser,
    secure("system:user_manage", (input) => services.saveUser(input)),
  );
  ipcMain.handle(
    IPC_CHANNELS.accessRemoveUser,
    secure("system:user_manage", (id) => services.removeUser(id)),
  );
  ipcMain.handle(
    IPC_CHANNELS.accessListRoles,
    secure("system:role_manage", () => services.listRoles()),
  );
  ipcMain.handle(
    IPC_CHANNELS.accessSaveRole,
    secure("system:role_manage", (input) => services.saveRole(input)),
  );
  ipcMain.handle(
    IPC_CHANNELS.accessRemoveRole,
    secure("system:role_manage", (id) => services.removeRole(id)),
  );
  ipcMain.handle(
    IPC_CHANNELS.accessListPermissions,
    secure("system:permission_manage", () => services.listPermissions()),
  );
  ipcMain.handle(
    IPC_CHANNELS.accessSavePermission,
    secure("system:permission_manage", (input) =>
      services.savePermission(input),
    ),
  );
  ipcMain.handle(
    IPC_CHANNELS.accessRemovePermission,
    secure("system:permission_manage", (id) => services.removePermission(id)),
  );

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    webPreferences: {
      preload: path.join(currentDir, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.webContents.once("did-finish-load", () => mainWindow?.show());
  mainWindow.webContents.on("render-process-gone", (_event, details) =>
    logger.error("Renderer process terminated", details),
  );
  mainWindow.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL) =>
      logger.error("Renderer failed to load", {
        errorCode,
        errorDescription,
        validatedURL,
      }),
  );
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible())
      mainWindow.show();
  }, 1500);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const current = mainWindow?.webContents.getURL();
    if (current && url !== current) event.preventDefault();
  });
  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });
  if (process.env.VITE_DEV_SERVER_URL)
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  else
    await mainWindow.loadFile(path.join(currentDir, "../renderer/index.html"));
}

if (ownsInstance)
  app
    .whenReady()
    .then(bootstrap)
    .catch((error) => {
      logger.error("Application bootstrap failed", error);
      console.error("DataMaker bootstrap failed:", error);
      dialog.showErrorBox(
        "DataMaker recovery mode",
        "The metadata database could not be opened safely. DataMaker stopped before making further changes. Restore a valid backup from the backups directory, then restart the application. Diagnostic details were written to the logs directory.",
      );
      app.exit(1);
    });
process.on("uncaughtException", (error) =>
  logger.error("Uncaught exception", error),
);
process.on("unhandledRejection", (reason) =>
  logger.error("Unhandled rejection", reason),
);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", (event) => {
  if (shutdownComplete) return;
  event.preventDefault();
  if (shutdownStarted) return;
  shutdownStarted = true;
  logger.info("Application shutdown started");
  void (async () => {
    try {
      await Promise.allSettled([
        scanTasks?.shutdown(),
        qualityTaskManager?.shutdown(),
        exportTaskManager?.shutdown(),
      ]);
      await http?.server.close();
      if (integrationStatePath && fs.existsSync(integrationStatePath))
        fs.unlinkSync(integrationStatePath);
      database?.close();
      logger.info("Application shutdown completed");
    } catch (error) {
      logger.error("Application shutdown failed", error);
    } finally {
      shutdownComplete = true;
      app.quit();
    }
  })();
});
