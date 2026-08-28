import { app } from "electron";
import { autoUpdater } from "electron-updater";
import type { UpdateStatusDto } from "@datamaker/contracts";

let status: UpdateStatusDto = {
  state: "idle",
  version: null,
  progress: 0,
  error: null,
};
let configured = false;

function configure() {
  if (configured) return;
  configured = true;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("checking-for-update", () => {
    status = { state: "checking", version: null, progress: 0, error: null };
  });
  autoUpdater.on("update-available", (info) => {
    status = {
      state: "available",
      version: info.version,
      progress: 0,
      error: null,
    };
  });
  autoUpdater.on("update-not-available", (info) => {
    status = {
      state: "up_to_date",
      version: info.version,
      progress: 100,
      error: null,
    };
  });
  autoUpdater.on("download-progress", (progress) => {
    status = {
      ...status,
      state: "downloading",
      progress: Math.round(progress.percent),
    };
  });
  autoUpdater.on("update-downloaded", (info) => {
    status = {
      state: "downloaded",
      version: info.version,
      progress: 100,
      error: null,
    };
  });
  autoUpdater.on("error", (error) => {
    status = { ...status, state: "error", error: error.message };
  });
}

export async function checkForUpdates(): Promise<UpdateStatusDto> {
  if (!app.isPackaged) {
    status = {
      state: "up_to_date",
      version: app.getVersion(),
      progress: 100,
      error: null,
    };
    return status;
  }
  configure();
  status = { state: "checking", version: null, progress: 0, error: null };
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    status = {
      ...status,
      state: "error",
      error: error instanceof Error ? error.message : "Update check failed",
    };
  }
  return status;
}

export function getUpdateStatus() {
  return status;
}

export function installUpdate() {
  if (status.state !== "downloaded") return false;
  setImmediate(() => autoUpdater.quitAndInstall(false, true));
  return true;
}
