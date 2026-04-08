import { Tray, Menu, nativeImage, app } from "electron";
import { join, dirname } from "path";
import { existsSync } from "fs";
import { fileURLToPath } from "url";

const __trayDirname = dirname(fileURLToPath(import.meta.url));

let tray: Tray | null = null;

export function createTray(callbacks: {
  onSyncAll: () => void;
  onShowApp: () => void;
}): Tray {
  // After esbuild bundles to dist/main/, dir = dist/main/
  const iconPath = join(__trayDirname, "../../build/icon.png");
  const icon = existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
    : nativeImage.createEmpty();

  tray = new Tray(icon);
  tray.setToolTip("VeeContext");

  updateTrayMenu("idle", callbacks);

  return tray;
}

export function updateTrayMenu(
  status: "idle" | "syncing",
  callbacks: {
    onSyncAll: () => void;
    onShowApp: () => void;
  },
): void {
  if (!tray) return;

  const contextMenu = Menu.buildFromTemplate([
    {
      label: status === "syncing" ? "Syncing..." : "Sync All",
      click: callbacks.onSyncAll,
      enabled: status !== "syncing",
    },
    { type: "separator" },
    {
      label: "Open VeeContext",
      click: callbacks.onShowApp,
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => app.quit(),
    },
  ]);

  tray.setContextMenu(contextMenu);
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}
