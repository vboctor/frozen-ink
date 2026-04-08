import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { getModuleDir } from "./paths";
import { spawnProcess } from "./subprocess";

/**
 * Walk up from a starting directory to find the monorepo root
 * (directory containing a package.json with "workspaces").
 * Returns null if not found (e.g. running from a packaged app).
 */
export function findMonorepoRoot(startDir: string): string | null {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        if (pkg.workspaces) return dir;
      } catch {}
    }
    const parent = join(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Resolve the path to the built worker bundle (worker.js).
 *
 * Search order:
 * 1. Electron packaged app: (process as any).resourcesPath + /worker-dist/worker.js
 * 2. Monorepo dev: packages/worker/dist/worker.js
 */
export function resolveWorkerBundle(moduleDir: string): string | null {
  // Electron packaged app
  if ((process as any).resourcesPath) {
    const packaged = join((process as any).resourcesPath, "worker-dist", "worker.js");
    if (existsSync(packaged)) return packaged;
  }

  // Monorepo dev
  const root = findMonorepoRoot(moduleDir);
  if (root) {
    const dev = join(root, "packages/worker/dist/worker.js");
    if (existsSync(dev)) return dev;
  }

  return null;
}

/**
 * Resolve the path to the built UI dist directory.
 *
 * Search order:
 * 1. Electron packaged app: (process as any).resourcesPath + /ui-dist/
 * 2. Monorepo dev: packages/ui/dist/
 */
export function resolveUiDist(moduleDir: string): string | null {
  // Electron packaged app
  if ((process as any).resourcesPath) {
    const packaged = join((process as any).resourcesPath, "ui-dist");
    if (existsSync(packaged)) return packaged;
  }

  // Monorepo dev
  const root = findMonorepoRoot(moduleDir);
  if (root) {
    const dev = join(root, "packages/ui/dist");
    if (existsSync(dev)) return dev;
  }

  return null;
}

const WRANGLER_INSTALL_URL = "https://developers.cloudflare.com/workers/wrangler/install-and-update/";

/**
 * Resolve the wrangler binary path.
 *
 * Search order:
 * 1. User-configured path (from config.json "wranglerPath")
 * 2. Monorepo dev: node_modules/.bin/wrangler
 * 3. System PATH: "wrangler" (via `which`)
 *
 * Returns the path, or throws with install instructions.
 */
export async function resolveWrangler(moduleDir: string, configuredPath?: string): Promise<string> {
  // 1. User-configured path
  if (configuredPath && existsSync(configuredPath)) {
    return configuredPath;
  }

  // 2. Monorepo dev: check local node_modules
  const root = findMonorepoRoot(moduleDir);
  if (root) {
    const localBin = join(root, "packages/worker/node_modules/.bin/wrangler");
    if (existsSync(localBin)) return localBin;

    const rootBin = join(root, "node_modules/.bin/wrangler");
    if (existsSync(rootBin)) return rootBin;
  }

  // 3. System PATH
  try {
    const { stdout, exitCode } = await spawnProcess(["which", "wrangler"]);
    if (exitCode === 0 && stdout.trim()) return stdout.trim();
  } catch {}

  // On Windows, try "where" instead of "which"
  if (process.platform === "win32") {
    try {
      const { stdout, exitCode } = await spawnProcess(["where", "wrangler"]);
      if (exitCode === 0 && stdout.trim()) return stdout.trim().split("\n")[0].trim();
    } catch {}
  }

  throw new Error(
    `Wrangler CLI not found. Install it to publish to Cloudflare:\n` +
    `  npm install -g wrangler\n` +
    `Or visit: ${WRANGLER_INSTALL_URL}\n\n` +
    `If wrangler is installed at a custom path, set "wranglerPath" in your workspace config.json.`
  );
}
