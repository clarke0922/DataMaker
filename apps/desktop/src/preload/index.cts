import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi, ManagementModule, SaveManagementRecordInput } from '@datamaker/contracts';

// Preload runs as sandboxed CommonJS. Keep runtime channel names local so this
// bridge never requires the ESM contracts package at startup.
const channels = {
  systemInfo: 'system:info',
  systemChooseImportFile: 'system:choose-import-file',
  metadataStats: 'metadata:stats',
  metadataSearch: 'metadata:search',
  managementList: 'management:list',
  managementSave: 'management:save',
  managementRemove: 'management:remove'
} as const;

const api: DesktopApi = Object.freeze({
  system: Object.freeze({
    info: () => ipcRenderer.invoke(channels.systemInfo),
    chooseImportFile: () => ipcRenderer.invoke(channels.systemChooseImportFile)
  }),
  metadata: Object.freeze({
    stats: () => ipcRenderer.invoke(channels.metadataStats),
    search: (query: string) => ipcRenderer.invoke(channels.metadataSearch, query)
  }),
  management: Object.freeze({
    list: (module: ManagementModule) => ipcRenderer.invoke(channels.managementList, module),
    save: (module: ManagementModule, input: SaveManagementRecordInput) => ipcRenderer.invoke(channels.managementSave, module, input),
    remove: (module: ManagementModule, id: string) => ipcRenderer.invoke(channels.managementRemove, module, id)
  })
});

contextBridge.exposeInMainWorld('datamaker', api);
