import { Command } from "commander";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import {
  getVeeContextHome,
  getMasterDb,
  collections,
  loadConfig,
  SyncEngine,
  ThemeEngine,
  LocalStorageBackend,
} from "@veecontext/core";
import { createDefaultRegistry, gitHubTheme, obsidianTheme, gitTheme } from "@veecontext/crawlers";

function getPidPath(): string {
  return join(getVeeContextHome(), "daemon.pid");
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
  const home = getVeeContextHome();
  const masterDbPath = join(home, "master.db");

  const doSync = async () => {
    if (!existsSync(masterDbPath)) return;

    const db = getMasterDb(masterDbPath);
    const collectionRows = db
      .select()
      .from(collections)
      .all()
      .filter((c) => c.enabled);

    if (collectionRows.length === 0) return;

    const registry = createDefaultRegistry();
    const themeEngine = new ThemeEngine();
    themeEngine.register(gitHubTheme);
    themeEngine.register(obsidianTheme);
    themeEngine.register(gitTheme);

    for (const col of collectionRows) {
      const factory = registry.get(col.crawlerType);
      if (!factory) continue;

      const crawler = factory();
      try {
        await crawler.initialize(
          col.config as Record<string, unknown>,
          col.credentials as Record<string, unknown>,
        );

        const collectionDir = join(home, "collections", col.name);
        const storage = new LocalStorageBackend(collectionDir);

        const engine = new SyncEngine({
          crawler,
          dbPath: col.dbPath,
          collectionName: col.name,
          themeEngine,
          storage,
          markdownBasePath: "markdown",
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
    const home = getVeeContextHome();
    const masterDbPath = join(home, "master.db");

    if (!existsSync(masterDbPath)) {
      console.error("VeeContext not initialized. Run: vctx init");
      process.exit(1);
    }

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
    const proc = Bun.spawn(
      ["bun", "run", import.meta.path, "__daemon-run", String(intervalMs)],
      {
        stdio: ["ignore", "ignore", "ignore"],
        env: { ...process.env, VEECONTEXT_HOME: home },
      },
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
