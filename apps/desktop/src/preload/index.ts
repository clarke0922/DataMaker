import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, type DesktopApi } from '@datamaker/contracts';

const api: DesktopApi = Object.freeze({
  system: Object.freeze({ info: () => ipcRenderer.invoke(IPC_CHANNELS.systemInfo) }),
  metadata: Object.freeze({
    stats: () => ipcRenderer.invoke(IPC_CHANNELS.metadataStats),
    search: (query: string) => ipcRenderer.invoke(IPC_CHANNELS.metadataSearch, query)
  })
});

contextBridge.exposeInMainWorld('datamaker', api);
