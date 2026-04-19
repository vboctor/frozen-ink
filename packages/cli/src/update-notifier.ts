/**
 * Lightweight update notifier for the fink CLI.
 *
 * Mirrors the behavior of the `update-notifier` npm package but is inlined so
 * it works inside both the esbuild-bundled npm payload and the `bun build --compile`
 * standalone binaries. Neither ships the child-process `check.js` file that the
 * upstream package forks to.
 *
 * - Once per 24h, fetches the latest version from the npm registry.
 * - Caches the result under `~/.frozenink/update-cache.json`.
 * - Prints a boxed banner when a newer version is available, with channel-aware
 *   upgrade instructions (npm vs. standalone binary).
 */
import { join } from "path";
import { homedir } from "os";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";

export const NPM_PACKAGE_NAME = "@vboctor/fink";
export const GITHUB_RELEASES_URL = "https://github.com/vboctor/frozen-ink/releases/latest";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

interface CacheFile {
  lastCheck: number;
  latestVersion: string | null;
}

function cachePath(): string {
  const dir = process.env.FROZENINK_HOME || join(homedir(), ".frozenink");
  return join(dir, "update-cache.json");
}

function readCache(): CacheFile {
  try {
    return JSON.parse(readFileSync(cachePath(), "utf-8")) as CacheFile;
  } catch {
    return { lastCheck: 0, latestVersion: null };
  }
}

function writeCache(cache: CacheFile): void {
  try {
    const p = cachePath();
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, JSON.stringify(cache));
  } catch {
    // Best-effort — do not fail the command because of cache write errors.
  }
}

/** Detects if the running CLI is a standalone Bun-compiled binary. */
export function isStandaloneBinary(): boolean {
  const exec = process.execPath || "";
  return /fink-(darwin|linux|windows)/.test(exec);
}

/** Compare semver-ish strings. Returns 1 if a > b, -1 if a < b, 0 if equal. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => v.replace(/^v/, "").split("-")[0].split(".").map((n) => parseInt(n, 10) || 0);
  const av = parse(a);
  const bv = parse(b);
  const len = Math.max(av.length, bv.length);
  for (let i = 0; i < len; i++) {
    const ai = av[i] ?? 0;
    const bi = bv[i] ?? 0;
    if (ai > bi) return 1;
    if (ai < bi) return -1;
  }
  return 0;
}

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${NPM_PACKAGE_NAME}/latest`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return data.version ?? null;
  } catch {
    return null;
  }
}

/** Explicit check — used by `fink upgrade --check`. */
export async function checkForUpdate(currentVersion: string): Promise<{ current: string; latest: string | null; hasUpdate: boolean }> {
  const latest = await fetchLatestVersion();
  if (latest) writeCache({ lastCheck: Date.now(), latestVersion: latest });
  return {
    current: currentVersion,
    latest,
    hasUpdate: latest !== null && compareVersions(latest, currentVersion) > 0,
  };
}

function banner(currentVersion: string, latestVersion: string): string {
  const upgradeCmd = isStandaloneBinary()
    ? `Download: ${GITHUB_RELEASES_URL}`
    : `Run: npm i -g ${NPM_PACKAGE_NAME}@latest`;
  const lines = [
    `Update available ${currentVersion} → ${latestVersion}`,
    upgradeCmd,
  ];
  const width = Math.max(...lines.map((l) => l.length)) + 2;
  const top = `╭${"─".repeat(width)}╮`;
  const bot = `╰${"─".repeat(width)}╯`;
  const body = lines.map((l) => `│ ${l}${" ".repeat(width - l.length - 1)}│`).join("\n");
  return `\n${top}\n${body}\n${bot}\n`;
}

/**
 * Print an upgrade banner to stderr if a cached check says an update is available,
 * and asynchronously refresh the cache in the background if it's stale. Safe to call
 * on every invocation; never blocks the current command.
 */
export function notifyIfUpdateAvailable(currentVersion: string): void {
  // Honor opt-out used by both `update-notifier` and Node tooling in general.
  if (process.env.NO_UPDATE_NOTIFIER === "1" || process.env.CI) return;

  const cache = readCache();

  if (cache.latestVersion && compareVersions(cache.latestVersion, currentVersion) > 0) {
    process.stderr.write(banner(currentVersion, cache.latestVersion));
  }

  if (Date.now() - cache.lastCheck > CHECK_INTERVAL_MS) {
    // Fire and forget — do not await.
    fetchLatestVersion()
      .then((latest) => {
        writeCache({ lastCheck: Date.now(), latestVersion: latest });
      })
      .catch(() => {});
  }
}
