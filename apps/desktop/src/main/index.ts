import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IPC_CHANNELS } from '@datamaker/contracts';
import { MetadataDatabase } from './database.js';
import { ApplicationServices } from './services.js';
import { startHttpServer } from './http.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
let database: MetadataDatabase | undefined;
let http: Awaited<ReturnType<typeof startHttpServer>> | undefined;

async function bootstrap() {
  const databasePath = path.join(app.getPath('userData'), 'datamaker.db');
  database = new MetadataDatabase(databasePath);
  let apiPort: number | null = null;
  const services = new ApplicationServices(database, () => ({ version: app.getVersion(), platform: process.platform, databasePath, apiPort, initialized: database!.initialized() }));
  http = await startHttpServer(services);
  apiPort = http.port;

  ipcMain.handle(IPC_CHANNELS.systemInfo, () => services.systemInfo());
  ipcMain.handle(IPC_CHANNELS.metadataStats, () => services.metadataStats());
  ipcMain.handle(IPC_CHANNELS.metadataSearch, (_event, query: unknown) => services.metadataSearch(typeof query === 'string' ? query : ''));

  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    webPreferences: {
      preload: path.join(currentDir, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  });
  window.once('ready-to-show', () => window.show());
  if (process.env.VITE_DEV_SERVER_URL) await window.loadURL(process.env.VITE_DEV_SERVER_URL);
  else await window.loadFile(path.join(currentDir, '../renderer/index.html'));
}

app.whenReady().then(bootstrap);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { void http?.server.close(); database?.close(); });
