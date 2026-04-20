import { join } from "path";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { homedir } from "os";
import { randomBytes } from "crypto";
import { getModuleDir, spawnProcess, resolveWrangler as resolveWranglerPath, getFrozenInkHome } from "@frozenink/core";

const __moduleDir = getModuleDir(import.meta.url);

// --- Wrangler binary resolution ---

let cachedWranglerPath: string | null = null;

async function resolveWranglerBin(): Promise<string> {
  if (cachedWranglerPath) return cachedWranglerPath;

  // Check user-configured path in workspace frozenink.yml
  let configuredPath: string | undefined;
  try {
    const yaml = require("js-yaml");
    const home = getFrozenInkHome();
    const configPath = join(home, "frozenink.yml");
    if (existsSync(configPath)) {
      const config = (yaml.load(readFileSync(configPath, "utf-8")) as Record<string, unknown>) ?? {};
      configuredPath = config.wranglerPath as string | undefined;
    }
  } catch {}

  const resolved = await resolveWranglerPath(__moduleDir, configuredPath);
  cachedWranglerPath = resolved;
  return resolved;
}

// --- ANSI stripping ---

function stripAnsi(str: string): string {
  return str.replace(/\u001b\[[0-9;]*m/g, "").replace(/\u001b\[\d+;\d+\[.*?\]/g, "");
}

// --- Core subprocess helper ---

export class WranglerError extends Error {
  constructor(
    public command: string[],
    public exitCode: number,
    public stdout: string,
    public stderr: string,
  ) {
    const detail = stripAnsi(stderr || stdout).trim();
    super(detail || `Wrangler command failed (exit ${exitCode})`);
  }
}

async function runWrangler(
  args: string[],
  opts?: { cwd?: string; allowFailure?: boolean },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const bin = await resolveWranglerBin();
  const { stdout, stderr, exitCode } = await spawnProcess([bin, ...args], {
    cwd: opts?.cwd,
    env: { ...process.env },
  });

  if (exitCode !== 0 && !opts?.allowFailure) {
    throw new WranglerError(args, exitCode, stdout, stderr);
  }

  return { stdout, stderr, exitCode };
}

// --- Auth: extract credentials from wrangler ---

interface CfCredentials {
  apiToken: string;
  accountId: string;
}

let cachedCredentials: CfCredentials | null = null;

export async function getCredentials(): Promise<CfCredentials> {
  if (cachedCredentials) return cachedCredentials;

  // Get API token: prefer env var, fall back to wrangler's OAuth token file
  let apiToken = process.env.CLOUDFLARE_API_TOKEN || "";
  if (!apiToken) {
    const configPaths = [
      join(homedir(), "Library/Preferences/.wrangler/config/default.toml"),
      join(homedir(), ".wrangler/config/default.toml"),
      join(homedir(), ".config/.wrangler/config/default.toml"),
    ];
    for (const p of configPaths) {
      if (existsSync(p)) {
        const content = readFileSync(p, "utf-8");
        const match = content.match(/oauth_token\s*=\s*"([^"]+)"/);
        if (match) {
          apiToken = match[1];
          break;
        }
      }
    }
  }

  if (!apiToken) {
    throw new Error("Not authenticated. Run `wrangler login` or set CLOUDFLARE_API_TOKEN.");
  }

  // Get account ID from wrangler whoami
  let accountId = process.env.CLOUDFLARE_ACCOUNT_ID || "";
  if (!accountId) {
    const { stdout } = await runWrangler(["whoami", "--json"]);
    const whoami = JSON.parse(stdout);
    accountId = whoami.accounts?.[0]?.id || "";
  }

  if (!accountId) {
    throw new Error("Could not determine Cloudflare account ID. Set CLOUDFLARE_ACCOUNT_ID.");
  }

  cachedCredentials = { apiToken, accountId };
  return cachedCredentials;
}

/**
 * Force re-read of credentials on the next getCredentials() call.
 * Useful when an API call returns 401 — typically because wrangler's OAuth
 * token on disk was refreshed while we held a stale cached copy in memory
 * (common in long-running processes like the desktop app).
 */
export function invalidateCredentials(): void {
  cachedCredentials = null;
}

export async function checkWranglerAuth(): Promise<void> {
  try {
    await getCredentials();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// --- Retry helper for transient Cloudflare/network errors ---

function isTransientError(err: unknown): boolean {
  if (!(err instanceof WranglerError)) return false;
  const msg = (err.stderr + err.stdout).toLowerCase();
  return (
    msg.includes("503") ||
    msg.includes("502") ||
    msg.includes("500") ||
    msg.includes("429") ||
    msg.includes("service unavailable") ||
    msg.includes("malformed response") ||
    msg.includes("timeout") ||
    msg.includes("econnreset") ||
    msg.includes("econnrefused")
  );
}

async function retryWithBackoff<T>(fn: () => Promise<T>, maxRetries = 5): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxRetries || !isTransientError(err)) throw err;
      const delay = Math.min(2000 * 2 ** attempt, 30000);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("unreachable");
}

// --- D1 operations (via wrangler CLI) ---

export async function createD1(name: string): Promise<{ uuid: string; name: string }> {
  try {
    const { stdout, stderr } = await runWrangler(["d1", "create", name]);
    const combined = stdout + stderr;
    const idMatch = combined.match(/"database_id":\s*"([^"]+)"/);
    if (idMatch) return { uuid: idMatch[1], name };
    throw new Error(`Could not parse database_id from d1 create output:\n${stripAnsi(combined)}`);
  } catch (err) {
    if (err instanceof WranglerError && (err.stderr.includes("already exists") || err.stdout.includes("already exists"))) {
      const { stdout } = await runWrangler(["d1", "list", "--json"]);
      const databases = JSON.parse(stdout) as Array<{ uuid: string; name: string }>;
      const existing = databases.find((db) => db.name === name);
      if (existing) return { uuid: existing.uuid, name };
      throw new Error(`D1 database "${name}" reportedly exists but not found in d1 list`);
    }
    throw err;
  }
}

export async function executeD1File(dbName: string, sqlFilePath: string): Promise<void> {
  await retryWithBackoff(() =>
    runWrangler(["d1", "execute", dbName, "--remote", "--file", sqlFilePath, "--yes"]),
  );
}

/**
 * Execute SQL against D1 via the REST API directly. Much faster than spawning
 * a wrangler subprocess per batch (saves ~500ms-1s per call).
 */
export async function executeD1Query(databaseId: string, sql: string): Promise<void> {
  const res = await fetchCloudflareApi(({ apiToken, accountId }) => ({
    url: `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`,
    init: {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql }),
    },
  }));
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`D1 query failed: ${res.status} ${text.slice(0, 500)}`);
  }
  const data = (await res.json()) as { success: boolean; errors?: Array<{ code?: number; message: string }> };
  if (!data.success) {
    const errs = (data.errors ?? []).map((e) => `[${e.code ?? "?"}] ${e.message}`).join("; ");
    throw new Error(`D1 query failed: ${errs || "unknown error"}`);
  }
}

export async function executeD1Command(dbName: string, sql: string): Promise<string> {
  const { stdout } = await runWrangler(["d1", "execute", dbName, "--remote", "--command", sql, "--json", "--yes"]);
  return stdout;
}

export async function deleteD1(dbName: string): Promise<void> {
  await runWrangler(["d1", "delete", dbName, "-y"], { allowFailure: true });
}

// --- Retry helper for HTTP APIs ---

let throttleUntil = 0;

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxRetries = 5,
): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const now = Date.now();
    if (throttleUntil > now) {
      await new Promise((r) => setTimeout(r, throttleUntil - now));
    }
    const res = await fetch(url, init);
    if (res.ok || res.status === 404) return res;
    if (res.status === 429 && attempt < maxRetries) {
      const delay = Math.min(2000 * 2 ** attempt, 30000);
      throttleUntil = Date.now() + delay;
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }
    return res;
  }
  return fetch(url, init);
}

/**
 * Make an authenticated Cloudflare API request. On 401, invalidates the
 * cached OAuth token and retries once with fresh credentials — long-running
 * processes (desktop app) can hold a stale cached token after wrangler
 * refreshes it on disk.
 */
async function fetchCloudflareApi(
  build: (creds: CfCredentials) => { url: string; init: RequestInit },
): Promise<Response> {
  const { url, init } = build(await getCredentials());
  let res = await fetchWithRetry(url, init);
  if (res.status === 401) {
    invalidateCredentials();
    const fresh = build(await getCredentials());
    res = await fetchWithRetry(fresh.url, fresh.init);
  }
  return res;
}

// --- R2 operations (bucket via wrangler CLI, objects via HTTP for speed) ---

export async function createR2Bucket(name: string): Promise<void> {
  try {
    await runWrangler(["r2", "bucket", "create", name]);
  } catch (err) {
    if (err instanceof WranglerError && (err.stderr.includes("already exists") || err.stdout.includes("already exists"))) {
      return;
    }
    throw err;
  }
}

export async function putR2Object(
  bucket: string,
  key: string,
  filePath: string,
  contentType?: string,
): Promise<void> {
  const body = readFileSync(filePath);
  const res = await fetchCloudflareApi(({ apiToken, accountId }) => ({
    url: `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/objects/${encodeURIComponent(key)}`,
    init: {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        ...(contentType ? { "Content-Type": contentType } : {}),
      },
      body,
    },
  }));
  if (!res.ok) {
    const text = await res.text();
    const hint = res.status === 401
      ? " — the Cloudflare OAuth token looks expired. Run `wrangler login` again, or restart the desktop app to refresh the cached credentials."
      : "";
    throw new Error(`R2 upload failed for ${key}: ${res.status} ${text.slice(0, 200)}${hint}`);
  }
}

export async function putR2String(
  bucket: string,
  key: string,
  content: string,
  contentType: string = "text/plain",
): Promise<void> {
  const res = await fetchCloudflareApi(({ apiToken, accountId }) => ({
    url: `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/objects/${encodeURIComponent(key)}`,
    init: {
      method: "PUT",
      headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": contentType },
      body: content,
    },
  }));
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`R2 upload failed for ${key}: ${res.status} ${text.slice(0, 200)}`);
  }
}

export async function getR2String(bucket: string, key: string): Promise<string | null> {
  const res = await fetchCloudflareApi(({ apiToken, accountId }) => ({
    url: `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/objects/${encodeURIComponent(key)}`,
    init: {
      method: "GET",
      headers: { Authorization: `Bearer ${apiToken}` },
    },
  }));
  if (res.status === 404) return null;
  if (!res.ok) return null;
  return res.text();
}

export async function deleteR2Object(bucket: string, key: string): Promise<void> {
  const res = await fetchCloudflareApi(({ apiToken, accountId }) => ({
    url: `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/objects/${encodeURIComponent(key)}`,
    init: {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiToken}` },
    },
  }));
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`R2 delete failed for ${key}: ${res.status} ${text.slice(0, 200)}`);
  }
}

export async function deleteR2Objects(bucket: string, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const CONCURRENCY = 3;
  let index = 0;
  async function worker() {
    while (index < keys.length) {
      const key = keys[index++];
      await deleteR2Object(bucket, key);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, keys.length) }, () => worker()));
}

export async function deleteR2Bucket(name: string): Promise<void> {
  await runWrangler(["r2", "bucket", "delete", name], { allowFailure: true });
}

export async function listR2Objects(bucket: string, prefix?: string): Promise<Array<{ key: string; size: number; etag: string }>> {
  const objects: Array<{ key: string; size: number; etag: string }> = [];
  let cursor: string | undefined;
  for (;;) {
    const pageCursor = cursor;
    const res = await fetchCloudflareApi(({ apiToken, accountId }) => {
      const params = new URLSearchParams({ per_page: "1000" });
      if (prefix) params.set("prefix", prefix);
      if (pageCursor) params.set("cursor", pageCursor);
      return {
        url: `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/objects?${params}`,
        init: {
          method: "GET",
          headers: { Authorization: `Bearer ${apiToken}` },
        },
      };
    });
    if (!res.ok) break;
    const data = await res.json() as { result: Array<{ key: string; size: number; etag?: string }>; result_info?: { cursor?: string } };
    for (const obj of data.result ?? []) objects.push({ key: obj.key, size: obj.size ?? 0, etag: (obj.etag ?? "").replace(/"/g, "") });
    cursor = data.result_info?.cursor;
    if (!cursor || (data.result ?? []).length === 0) break;
  }
  return objects;
}

export async function putR2ObjectFromString(
  bucket: string,
  key: string,
  content: string,
  contentType: string = "text/plain",
): Promise<void> {
  return putR2String(bucket, key, content, contentType);
}

// --- Worker operations (via wrangler CLI) ---

export async function deployWorker(tomlPath: string): Promise<string> {
  const { stdout, stderr } = await runWrangler(["deploy", "--config", tomlPath]);
  const combined = stdout + stderr;
  const urlMatch = combined.match(/https:\/\/[^\s]+\.workers\.dev/);
  return urlMatch ? urlMatch[0] : "";
}

export async function deleteWorker(name: string): Promise<void> {
  await runWrangler(["delete", name, "--force"], { allowFailure: true });
}

// --- Wrangler.toml generation ---

export function generateWranglerToml(config: {
  workerName: string;
  mainScript: string;
  d1DatabaseName: string;
  d1DatabaseId: string;
  r2BucketName: string;
  passwordHash: string;
  toolDescription?: string;
}): string {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

  return `name = "${esc(config.workerName)}"
main = "${esc(config.mainScript)}"
compatibility_date = "2024-01-01"

[vars]
PASSWORD_HASH = "${esc(config.passwordHash)}"
WORKER_NAME = "${esc(config.workerName)}"
TOOL_DESCRIPTION = "${esc(config.toolDescription ?? "")}"

[[d1_databases]]
binding = "DB"
database_name = "${esc(config.d1DatabaseName)}"
database_id = "${esc(config.d1DatabaseId)}"

[[r2_buckets]]
binding = "BUCKET"
bucket_name = "${esc(config.r2BucketName)}"
`;
}

// --- Temp file helpers ---

export function writeTempFile(content: string, extension: string): string {
  const tmpDir = process.env.TMPDIR || "/tmp";
  const name = `fink-${randomBytes(6).toString("hex")}${extension}`;
  const path = join(tmpDir, name);
  writeFileSync(path, content, "utf-8");
  return path;
}

export function cleanupTempFile(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // Ignore cleanup failures
  }
}
