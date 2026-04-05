import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { configSchema, type VeeContextConfig } from "./schema";
import { defaultConfig } from "./defaults";

export function getVeeContextHome(): string {
  return process.env.VEECONTEXT_HOME ?? join(homedir(), ".veecontext");
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const sourceVal = source[key];
    const targetVal = result[key];
    if (
      sourceVal !== null &&
      typeof sourceVal === "object" &&
      !Array.isArray(sourceVal) &&
      targetVal !== null &&
      typeof targetVal === "object" &&
      !Array.isArray(targetVal)
    ) {
      result[key] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>,
      );
    } else {
      result[key] = sourceVal;
    }
  }
  return result;
}

const ENV_MAPPING: Record<string, [keyof VeeContextConfig, string]> = {
  VEECONTEXT_DB_MODE: ["db", "mode"],
  VEECONTEXT_DB_TURSO_URL: ["db", "tursoUrl"],
  VEECONTEXT_DB_TURSO_TOKEN: ["db", "tursoToken"],
  VEECONTEXT_STORAGE_MODE: ["storage", "mode"],
  VEECONTEXT_STORAGE_S3_BUCKET: ["storage", "s3Bucket"],
  VEECONTEXT_STORAGE_S3_REGION: ["storage", "s3Region"],
  VEECONTEXT_STORAGE_S3_ENDPOINT: ["storage", "s3Endpoint"],
  VEECONTEXT_STORAGE_S3_ACCESS_KEY_ID: ["storage", "s3AccessKeyId"],
  VEECONTEXT_STORAGE_S3_SECRET_ACCESS_KEY: ["storage", "s3SecretAccessKey"],
  VEECONTEXT_SYNC_INTERVAL: ["sync", "interval"],
  VEECONTEXT_SYNC_CONCURRENCY: ["sync", "concurrency"],
  VEECONTEXT_SYNC_RETRIES: ["sync", "retries"],
  VEECONTEXT_UI_PORT: ["ui", "port"],
  VEECONTEXT_MCP_TRANSPORT: ["mcp", "transport"],
  VEECONTEXT_MCP_PORT: ["mcp", "port"],
  VEECONTEXT_LOGGING_LEVEL: ["logging", "level"],
  VEECONTEXT_LOGGING_FILE: ["logging", "file"],
};

const NUMERIC_FIELDS = new Set([
  "interval",
  "concurrency",
  "retries",
  "port",
]);

function applyEnvOverrides(config: Record<string, unknown>): Record<string, unknown> {
  const result = JSON.parse(JSON.stringify(config)) as Record<string, unknown>;

  for (const [envVar, [section, field]] of Object.entries(ENV_MAPPING)) {
    const value = process.env[envVar];
    if (value === undefined) continue;

    if (!(section in result) || typeof result[section] !== "object" || result[section] === null) {
      result[section] = {};
    }

    const sectionObj = result[section] as Record<string, unknown>;
    sectionObj[field] = NUMERIC_FIELDS.has(field) ? Number(value) : value;
  }

  return result;
}

export function loadConfig(): VeeContextConfig {
  const home = getVeeContextHome();
  const configPath = join(home, "config.json");

  let fileConfig: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    const raw = readFileSync(configPath, "utf-8");
    fileConfig = JSON.parse(raw) as Record<string, unknown>;
  }

  const merged = deepMerge(
    defaultConfig as unknown as Record<string, unknown>,
    fileConfig,
  );

  const withEnv = applyEnvOverrides(merged);

  return configSchema.parse(withEnv);
}
