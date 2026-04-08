import { app, BrowserWindow, ipcMain, shell, nativeImage } from "electron";
import { join, dirname } from "path";
import { existsSync } from "fs";
import { fileURLToPath } from "url";

const __desktopFilename = fileURLToPath(import.meta.url);
const __desktopDirname = dirname(__desktopFilename);
import { getLastWorkspace, openWorkspace, createWorkspace, listRecentWorkspaces } from "./workspace-manager";
import { registerIpcHandlers } from "./ipc-handlers";
import { createTray, updateTrayMenu, destroyTray } from "./tray";
import { setAppMode } from "../../../cli/src/commands/management-api";
import { createApiServer } from "../../../cli/src/commands/serve";

let mainWindow: BrowserWindow | null = null;
let apiServer: { port: number; stop?: () => void } | null = null;

async function startApiServer(workspacePath: string): Promise<{ port: number; stop?: () => void }> {
  // Set environment before importing core modules
  process.env.VEECONTEXT_HOME = workspacePath;

  setAppMode("desktop");

  // createApiServer returns a Promise under Node.js/Electron (resolves when listening)
  const server = await Promise.resolve(createApiServer(workspacePath, 0));
  console.log(`API server listening on port ${server.port}`);
  return server;
}

function stopApiServer() {
  if (apiServer?.stop) {
    apiServer.stop();
    apiServer = null;
  }
}

async function switchWorkspace(workspacePath: string): Promise<void> {
  stopApiServer();
  openWorkspace(workspacePath);
  apiServer = await startApiServer(workspacePath);
  if (mainWindow) {
    mainWindow.loadURL(`http://localhost:${apiServer.port}`);
  }
}

function createMainWindow(): BrowserWindow {
  // After esbuild bundles to dist/main/index.mjs, __desktopDirname = dist/main/
  const preloadPath = join(__desktopDirname, "../preload/index.js");
  const iconPath = join(__desktopDirname, "../../build/icon.png");

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    title: "VeeContext",
    icon: existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: existsSync(preloadPath) ? preloadPath : undefined,
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: "default",
  });

  // Open external links (target="_blank") in the system browser, not in Electron
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });

  win.on("closed", () => {
    mainWindow = null;
  });

  return win;
}

app.whenReady().then(async () => {
  // Set dock/taskbar icon (macOS dock icon isn't set by BrowserWindow.icon)
  const appIconPath = join(__desktopDirname, "../../build/icon.png");
  if (existsSync(appIconPath)) {
    const icon = nativeImage.createFromPath(appIconPath);
    if (process.platform === "darwin" && app.dock) {
      app.dock.setIcon(icon);
    }
  }

  mainWindow = createMainWindow();

  // Register IPC handlers
  registerIpcHandlers(() => mainWindow);

  // Handle workspace switching via IPC
  ipcMain.handle("switch-workspace", async (_event, path: string) => {
    await switchWorkspace(path);
    return { ok: true };
  });

  // Create system tray
  createTray({
    onSyncAll: () => {
      if (apiServer) {
        fetch(`http://localhost:${apiServer.port}/api/sync`, { method: "POST" }).catch(() => {});
      }
    },
    onShowApp: () => {
      mainWindow?.show();
      mainWindow?.focus();
    },
  });

  // Check for last workspace
  const lastWorkspace = getLastWorkspace();

  if (lastWorkspace && existsSync(lastWorkspace)) {
    // Auto-open last workspace
    try {
      apiServer = await startApiServer(lastWorkspace);
      mainWindow.loadURL(`http://localhost:${apiServer.port}`);
    } catch (err) {
      console.error("Failed to start API server:", err);
      showWelcomeScreen();
    }
  } else {
    showWelcomeScreen();
  }
});

function showWelcomeScreen() {
  // Load a simple HTML welcome page that uses IPC to create/open workspaces
  const welcomeHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>VeeContext</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, sans-serif;
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          margin: 0;
          background: #f6f8fa;
          color: #1f2328;
        }
        .welcome {
          text-align: center;
          max-width: 400px;
        }
        h1 { font-size: 28px; margin-bottom: 8px; }
        p { color: #656d76; margin-bottom: 24px; }
        .actions { display: flex; gap: 12px; justify-content: center; }
        button {
          padding: 10px 20px;
          font-size: 14px;
          border-radius: 6px;
          cursor: pointer;
          font-family: inherit;
        }
        .btn-primary {
          background: #0969da;
          color: white;
          border: none;
        }
        .btn-primary:hover { background: #0860ca; }
        .btn-secondary {
          background: white;
          border: 1px solid #d0d7de;
          color: #1f2328;
        }
        .btn-secondary:hover { background: #f6f8fa; }
      </style>
    </head>
    <body>
      <div class="welcome">
        <h1>VeeContext</h1>
        <p>Choose a workspace to get started</p>
        <div class="actions">
          <button class="btn-primary" onclick="createWorkspace()">Create Workspace</button>
          <button class="btn-secondary" onclick="openWorkspace()">Open Existing</button>
        </div>
      </div>
      <script>
        async function createWorkspace() {
          const path = await window.veecontext?.openDirectoryPicker();
          if (!path) return;
          const name = path.split('/').pop() || 'Workspace';
          await window.veecontext?.createWorkspace(name, path);
          await window.veecontext?.switchWorkspace(path);
        }
        async function openWorkspace() {
          const path = await window.veecontext?.openDirectoryPicker();
          if (!path) return;
          await window.veecontext?.openWorkspace(path);
          await window.veecontext?.switchWorkspace(path);
        }
      </script>
    </body>
    </html>
  `;

  mainWindow?.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(welcomeHtml)}`);
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    stopApiServer();
    destroyTray();
    app.quit();
  }
});

app.on("activate", () => {
  if (mainWindow === null) {
    mainWindow = createMainWindow();
    if (apiServer) {
      mainWindow.loadURL(`http://localhost:${apiServer.port}`);
    } else {
      showWelcomeScreen();
    }
  }
});

app.on("before-quit", () => {
  stopApiServer();
  destroyTray();
});
