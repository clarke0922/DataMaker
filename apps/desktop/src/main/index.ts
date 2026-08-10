import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { IPC_CHANNELS, type ManagementModule, type SaveManagementRecordInput } from '@datamaker/contracts';
import { MetadataDatabase } from './database.js';
import { ApplicationServices } from './services.js';
import { startHttpServer } from './http.js';
import { MetadataManagementRepository } from './management.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
let database: MetadataDatabase | undefined;
let http: Awaited<ReturnType<typeof startHttpServer>> | undefined;
let mainWindow: BrowserWindow | undefined;

async function bootstrap() {
  const databasePath = path.join(app.getPath('userData'), 'datamaker.db');
  database = new MetadataDatabase(databasePath);
  const management = new MetadataManagementRepository(database.db);
  let apiPort: number | null = null;
  const services = new ApplicationServices(database, management, () => ({ version: app.getVersion(), platform: process.platform, databasePath, apiPort, initialized: database!.initialized() }));
  http = await startHttpServer(services);
  apiPort = http.port;

  ipcMain.handle(IPC_CHANNELS.systemInfo, () => services.systemInfo());
  ipcMain.handle(IPC_CHANNELS.systemChooseImportFile, async () => {
    const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [
      { name: '支持的数据文件', extensions: ['sql', 'sqlite', 'sqlite3', 'db', 'xlsx', 'xls'] },
      { name: '所有文件', extensions: ['*'] }
    ] });
    return { ok: true, data: result.canceled ? null : result.filePaths[0] ?? null, requestId: crypto.randomUUID() };
  });
  ipcMain.handle(IPC_CHANNELS.metadataStats, () => services.metadataStats());
  ipcMain.handle(IPC_CHANNELS.metadataSearch, (_event, query: unknown) => services.metadataSearch(typeof query === 'string' ? query : ''));
  ipcMain.handle(IPC_CHANNELS.managementList, (_event, module: ManagementModule) => services.managementList(module));
  ipcMain.handle(IPC_CHANNELS.managementSave, (_event, module: ManagementModule, input: SaveManagementRecordInput) => services.managementSave(module, input));
  ipcMain.handle(IPC_CHANNELS.managementRemove, (_event, module: ManagementModule, id: string) => services.managementRemove(module, id));

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    webPreferences: {
      preload: path.join(currentDir, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => { mainWindow = undefined; });
  if (process.env.VITE_DEV_SERVER_URL) await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  else await mainWindow.loadFile(path.join(currentDir, '../renderer/index.html'));
}

app.whenReady().then(bootstrap).catch(error => {
  console.error('DataMaker bootstrap failed:', error);
  app.exit(1);
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { void http?.server.close(); database?.close(); });
