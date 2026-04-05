import { Command } from "commander";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { getVeeContextHome, loadConfig } from "@veecontext/core";

function getConfigPath(): string {
  return join(getVeeContextHome(), "config.json");
}

function readConfigFile(): Record<string, unknown> {
  const configPath = getConfigPath();
  if (!existsSync(configPath)) {
    return {};
  }
  return JSON.parse(readFileSync(configPath, "utf-8")) as Record<
    string,
    unknown
  >;
}

function writeConfigFile(config: Record<string, unknown>): void {
  writeFileSync(getConfigPath(), JSON.stringify(config, null, 2));
}

function getNestedValue(
  obj: Record<string, unknown>,
  key: string,
): unknown {
  const parts = key.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function setNestedValue(
  obj: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  const parts = key.split(".");
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current) || typeof current[part] !== "object" || current[part] === null) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

function parseValue(value: string): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  const num = Number(value);
  if (!isNaN(num) && value.trim() !== "") return num;
  return value;
}

const getCommand = new Command("get")
  .description("Get a configuration value")
  .argument("<key>", "Config key (e.g., sync.interval)")
  .action((key: string) => {
    const config = loadConfig();
    const value = getNestedValue(
      config as unknown as Record<string, unknown>,
      key,
    );
    if (value === undefined) {
      console.error(`Config key "${key}" not found`);
      process.exit(1);
    }
    console.log(typeof value === "object" ? JSON.stringify(value, null, 2) : String(value));
  });

const setCommand = new Command("set")
  .description("Set a configuration value")
  .argument("<key>", "Config key (e.g., sync.interval)")
  .argument("<value>", "Config value")
  .action((key: string, value: string) => {
    const configPath = getConfigPath();
    if (!existsSync(configPath)) {
      console.error("VeeContext not initialized. Run: vctx init");
      process.exit(1);
    }

    const fileConfig = readConfigFile();
    setNestedValue(fileConfig, key, parseValue(value));
    writeConfigFile(fileConfig);
    console.log(`Set ${key} = ${value}`);
  });

const listConfigCommand = new Command("list")
  .description("List all configuration values")
  .action(() => {
    const config = loadConfig();
    console.log(JSON.stringify(config, null, 2));
  });

export const configCommand = new Command("config")
  .description("Manage configuration")
  .addCommand(getCommand)
  .addCommand(setCommand)
  .addCommand(listConfigCommand);
