import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("veecontext", {
  openDirectoryPicker: () => ipcRenderer.invoke("open-directory-picker"),
  getWorkspaces: () => ipcRenderer.invoke("get-workspaces"),
  createWorkspace: (name: string, path: string) =>
    ipcRenderer.invoke("create-workspace", name, path),
  openWorkspace: (path: string) => ipcRenderer.invoke("open-workspace", path),
  switchWorkspace: (path: string) => ipcRenderer.invoke("switch-workspace", path),
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  platform: process.platform,
});
