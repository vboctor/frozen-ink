/**
 * Notify-only auto-updater.
 *
 * Because the desktop builds are unsigned on macOS and Windows, silent
 * self-replacement via electron-updater is unsafe (Gatekeeper / SmartScreen
 * will block an uninstalled update). Instead, we check GitHub Releases on
 * launch + every 4h, and when a newer version is published we notify the
 * renderer which shows a banner linking to the release page. The user
 * downloads and installs the new build manually.
 */
import type { BrowserWindow } from "electron";
import { app } from "electron";
import { autoUpdater } from "electron-updater";

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const RELEASES_PAGE = "https://github.com/vboctor/frozen-ink/releases/latest";

export function initAutoUpdater(window: BrowserWindow): void {
  // In dev (unpackaged) the auto-update config files are missing and the
  // check would just produce noise.
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  // electron-updater ships its own logger slot; stderr console is fine for now.
  autoUpdater.logger = console;

  autoUpdater.on("update-available", (info) => {
    if (window.isDestroyed()) return;
    window.webContents.send("update:available", {
      version: info.version,
      releaseNotes: typeof info.releaseNotes === "string" ? info.releaseNotes : null,
      releaseUrl: RELEASES_PAGE,
    });
  });

  autoUpdater.on("error", (err) => {
    console.warn("[auto-updater]", err?.message ?? err);
  });

  autoUpdater.checkForUpdates().catch(() => {});
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, CHECK_INTERVAL_MS);
}
