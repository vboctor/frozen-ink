import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import yaml from "js-yaml";
import { configSchema, type FrozenInkConfig } from "./schema";
import { defaultConfig } from "./defaults";

export function getFrozenInkHome(): string {
  return process.env.FROZENINK_HOME ?? join(homedir(), ".frozenink");
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

const ENV_MAPPING: Record<string, [keyof FrozenInkConfig, string]> = {
  FROZENINK_SYNC_INTERVAL: ["sync", "interval"],
  FROZENINK_UI_PORT: ["ui", "port"],
};

const NUMERIC_FIELDS = new Set([
  "interval",
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

export function loadConfig(): FrozenInkConfig {
  const home = getFrozenInkHome();
  const ymlPath = join(home, "frozenink.yml");

  let fileConfig: Record<string, unknown> = {};
  if (existsSync(ymlPath)) {
    const raw = readFileSync(ymlPath, "utf-8");
    fileConfig = (yaml.load(raw) as Record<string, unknown>) ?? {};
  }

  const merged = deepMerge(
    defaultConfig as unknown as Record<string, unknown>,
    fileConfig,
  );

  const withEnv = applyEnvOverrides(merged);

  return configSchema.parse(withEnv);
}
