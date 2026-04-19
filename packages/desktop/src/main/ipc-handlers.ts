import { ipcMain, dialog, shell, BrowserWindow } from "electron";
import {
  loadWorkspaces,
  createWorkspace,
  openWorkspace,
  listRecentWorkspaces,
} from "./workspace-manager";

export function registerIpcHandlers(getMainWindow: () => BrowserWindow | null): void {
  // Directory picker
  ipcMain.handle("open-directory-picker", async () => {
    const win = getMainWindow();
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      properties: ["openDirectory", "createDirectory"],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  // Workspace operations
  ipcMain.handle("get-workspaces", () => {
    return listRecentWorkspaces();
  });

  ipcMain.handle("create-workspace", async (_event, name: string, path: string) => {
    createWorkspace(name, path);
    return { ok: true };
  });

  ipcMain.handle("open-workspace", async (_event, path: string) => {
    openWorkspace(path);
    return { ok: true };
  });

  ipcMain.handle("get-app-version", () => {
    const { app } = require("electron");
    return app.getVersion();
  });

  ipcMain.handle("get-platform", () => {
    return process.platform;
  });

  // Open a release page in the user's default browser. URL is validated to
  // avoid the IPC channel being repurposed to open arbitrary links.
  ipcMain.handle("update:open-release-page", async (_event, url: string) => {
    try {
      const parsed = new URL(url);
      if (parsed.host !== "github.com") return { ok: false };
      await shell.openExternal(parsed.toString());
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });
}
