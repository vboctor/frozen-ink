import { join } from "path";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { homedir } from "os";
import { randomBytes } from "crypto";
import { getModuleDir, spawnProcess, resolveWrangler as resolveWranglerPath, getVeeContextHome } from "@veecontext/core";

const __moduleDir = getModuleDir(import.meta.url);

// --- Wrangler binary resolution ---

let cachedWranglerPath: string | null = null;

async function resolveWranglerBin(): Promise<string> {
  if (cachedWranglerPath) return cachedWranglerPath;

  // Check user-configured path in workspace config.json
  let configuredPath: string | undefined;
  try {
    const home = getVeeContextHome();
    const configPath = join(home, "config.json");
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      configuredPath = config.wranglerPath;
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

export async function checkWranglerAuth(): Promise<void> {
  try {
    await getCredentials();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
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
  await runWrangler(["d1", "execute", dbName, "--remote", "--file", sqlFilePath, "--yes"]);
}

export async function executeD1Command(dbName: string, sql: string): Promise<string> {
  const { stdout } = await runWrangler(["d1", "execute", dbName, "--remote", "--command", sql, "--json", "--yes"]);
  return stdout;
}

export async function deleteD1(dbName: string): Promise<void> {
  await runWrangler(["d1", "delete", dbName, "-y"], { allowFailure: true });
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
  const { apiToken, accountId } = await getCredentials();
  const body = readFileSync(filePath);
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/objects/${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      ...(contentType ? { "Content-Type": contentType } : {}),
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`R2 upload failed for ${key}: ${res.status} ${text.slice(0, 200)}`);
  }
}

export async function deleteR2Object(bucket: string, key: string): Promise<void> {
  const { apiToken, accountId } = await getCredentials();
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/objects/${encodeURIComponent(key)}`;
  await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${apiToken}` },
  });
}

export async function deleteR2Bucket(name: string): Promise<void> {
  await runWrangler(["r2", "bucket", "delete", name], { allowFailure: true });
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
}): string {
  return `name = "${config.workerName}"
main = "${config.mainScript}"
compatibility_date = "2024-01-01"

[vars]
PASSWORD_HASH = "${config.passwordHash}"
WORKER_NAME = "${config.workerName}"

[[d1_databases]]
binding = "DB"
database_name = "${config.d1DatabaseName}"
database_id = "${config.d1DatabaseId}"

[[r2_buckets]]
binding = "BUCKET"
bucket_name = "${config.r2BucketName}"
`;
}

// --- Temp file helpers ---

export function writeTempFile(content: string, extension: string): string {
  const tmpDir = process.env.TMPDIR || "/tmp";
  const name = `vctx-${randomBytes(6).toString("hex")}${extension}`;
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
