import { contextBridge, ipcRenderer } from "electron";

export interface UpdateInfo {
  version: string;
  releaseNotes: string | null;
  releaseUrl: string;
}

contextBridge.exposeInMainWorld("frozenink", {
  openDirectoryPicker: () => ipcRenderer.invoke("open-directory-picker"),
  getWorkspaces: () => ipcRenderer.invoke("get-workspaces"),
  createWorkspace: (name: string, path: string) =>
    ipcRenderer.invoke("create-workspace", name, path),
  openWorkspace: (path: string) => ipcRenderer.invoke("open-workspace", path),
  switchWorkspace: (path: string) => ipcRenderer.invoke("switch-workspace", path),
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  platform: process.platform,
  onUpdateAvailable: (cb: (info: UpdateInfo) => void) => {
    const handler = (_: unknown, info: UpdateInfo) => cb(info);
    ipcRenderer.on("update:available", handler);
    return () => ipcRenderer.removeListener("update:available", handler);
  },
  openReleasePage: (url: string) => ipcRenderer.invoke("update:open-release-page", url),
});
