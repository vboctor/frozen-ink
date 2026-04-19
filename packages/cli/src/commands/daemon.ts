import { Command } from "commander";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import {
  getFrozenInkHome,
  ensureInitialized,
  listCollections,
  getCollectionDbPath,
  loadConfig,
  SyncEngine,
  ThemeEngine,
  LocalStorageBackend,
  spawnDetached,
  resolveCredentials,
} from "@frozenink/core";
import { createDefaultRegistry, gitHubTheme, obsidianTheme, gitTheme } from "@frozenink/crawlers";

function getPidPath(): string {
  return join(getFrozenInkHome(), "daemon.pid");
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function runSyncLoop(intervalMs: number): Promise<void> {
  const home = getFrozenInkHome();

  const doSync = async () => {
    ensureInitialized();

    const collectionRows = listCollections().filter((c) => c.enabled);

    if (collectionRows.length === 0) return;

    const registry = createDefaultRegistry();
    const themeEngine = new ThemeEngine();
    themeEngine.register(gitHubTheme);
    themeEngine.register(obsidianTheme);
    themeEngine.register(gitTheme);

    for (const col of collectionRows) {
      const factory = registry.get(col.crawler);
      if (!factory) continue;

      const crawler = factory();
      try {
        await crawler.initialize(
          col.config as Record<string, unknown>,
          resolveCredentials(col.credentials),
        );

        const collectionDir = join(home, "collections", col.name);
        const storage = new LocalStorageBackend(collectionDir);

        const engine = new SyncEngine({
          crawler,
          dbPath: getCollectionDbPath(col.name),
          collectionName: col.name,
          themeEngine,
          storage,
          markdownBasePath: "content",
          assetConfig: col.assets as { extensions?: string[]; maxSize?: number } | undefined,
        });

        await engine.run();
      } catch (err) {
        console.error(`Sync failed for "${col.name}": ${err}`);
      } finally {
        await crawler.dispose();
      }
    }
  };

  // Run immediately on start
  await doSync();

  // Then run on interval
  setInterval(doSync, intervalMs);
}

const startCommand = new Command("start")
  .description("Start the sync daemon in the background")
  .action(async () => {
    ensureInitialized();

    const home = getFrozenInkHome();
    const pidPath = getPidPath();

    // Check if already running
    if (existsSync(pidPath)) {
      const existingPid = parseInt(readFileSync(pidPath, "utf-8").trim(), 10);
      if (isProcessRunning(existingPid)) {
        console.log(`Daemon already running (PID: ${existingPid})`);
        return;
      }
      // Stale PID file, clean up
      unlinkSync(pidPath);
    }

    const config = loadConfig();
    const intervalMs = config.sync.interval * 1000;

    // Fork a background process
    const modulePath = fileURLToPath(import.meta.url);
    const proc = spawnDetached(
      ["bun", "run", modulePath, "__daemon-run", String(intervalMs)],
      { env: { ...process.env, FROZENINK_HOME: home } },
    );

    const pid = proc.pid;
    writeFileSync(pidPath, String(pid));
    proc.unref();

    console.log(`Daemon started (PID: ${pid})`);
    console.log(`Sync interval: ${config.sync.interval}s`);
  });

const stopCommand = new Command("stop")
  .description("Stop the sync daemon")
  .action(() => {
    const pidPath = getPidPath();

    if (!existsSync(pidPath)) {
      console.log("Daemon is not running");
      return;
    }

    const pid = parseInt(readFileSync(pidPath, "utf-8").trim(), 10);

    if (!isProcessRunning(pid)) {
      unlinkSync(pidPath);
      console.log("Daemon is not running (cleaned up stale PID file)");
      return;
    }

    try {
      process.kill(pid, "SIGTERM");
      unlinkSync(pidPath);
      console.log(`Daemon stopped (PID: ${pid})`);
    } catch (err) {
      console.error(`Failed to stop daemon: ${err}`);
    }
  });

const statusSubCommand = new Command("status")
  .description("Check daemon status")
  .action(() => {
    const pidPath = getPidPath();

    if (!existsSync(pidPath)) {
      console.log("Daemon is not running");
      return;
    }

    const pid = parseInt(readFileSync(pidPath, "utf-8").trim(), 10);

    if (isProcessRunning(pid)) {
      console.log(`Daemon is running (PID: ${pid})`);
    } else {
      unlinkSync(pidPath);
      console.log("Daemon is not running (cleaned up stale PID file)");
    }
  });

export const daemonCommand = new Command("daemon")
  .description("Manage the background sync daemon")
  .addHelpText("after", `
Examples:
  fink daemon start
  fink daemon status
  fink daemon stop
`)
  .addCommand(startCommand)
  .addCommand(stopCommand)
  .addCommand(statusSubCommand);

// When invoked as __daemon-run, start the sync loop directly
if (
  process.argv.includes("__daemon-run")
) {
  const intervalArg = process.argv[process.argv.indexOf("__daemon-run") + 1];
  const intervalMs = parseInt(intervalArg, 10) || 900000;
  runSyncLoop(intervalMs).catch((err) => {
    console.error(`Daemon error: ${err}`);
    process.exit(1);
  });
}
