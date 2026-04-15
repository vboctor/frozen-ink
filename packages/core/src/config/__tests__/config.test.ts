import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { configSchema } from "../schema";
import { defaultConfig } from "../defaults";
import { loadConfig, getFrozenInkHome } from "../loader";

const TEST_DIR = join(import.meta.dir, ".test-config");

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  // Clear all FROZENINK_ env vars
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("FROZENINK_")) {
      delete process.env[key];
    }
  }
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("FROZENINK_")) {
      delete process.env[key];
    }
  }
});

describe("Config Schema", () => {
  it("validates a complete valid config", () => {
    const config = configSchema.parse({
      sync: { interval: 600 },
      ui: { port: 8080 },
    });

    expect(config.sync.interval).toBe(600);
    expect(config.ui.port).toBe(8080);
  });

  it("applies defaults for empty config", () => {
    const config = configSchema.parse({});

    expect(config.sync.interval).toBe(900);
    expect(config.ui.port).toBe(3000);
  });

  it("rejects negative sync interval", () => {
    expect(() =>
      configSchema.parse({ sync: { interval: -1 } }),
    ).toThrow();
  });

  it("rejects non-integer port", () => {
    expect(() =>
      configSchema.parse({ ui: { port: 3.5 } }),
    ).toThrow();
  });
});

describe("Default Config", () => {
  it("passes schema validation", () => {
    const config = configSchema.parse(defaultConfig);
    expect(config).toEqual(defaultConfig);
  });

  it("has sensible default values", () => {
    expect(defaultConfig.sync.interval).toBe(900);
    expect(defaultConfig.ui.port).toBe(3000);
  });
});

describe("getFrozenInkHome", () => {
  it("returns ~/.frozenink by default", () => {
    delete process.env.FROZENINK_HOME;
    const home = getFrozenInkHome();
    expect(home).toMatch(/\.frozenink$/);
  });

  it("respects FROZENINK_HOME env var", () => {
    process.env.FROZENINK_HOME = "/custom/path";
    const home = getFrozenInkHome();
    expect(home).toBe("/custom/path");
  });
});

describe("Config Loader", () => {
  it("returns defaults when no config file exists", () => {
    process.env.FROZENINK_HOME = join(TEST_DIR, "empty");
    mkdirSync(join(TEST_DIR, "empty"), { recursive: true });

    const config = loadConfig();
    expect(config.sync.interval).toBe(900);
    expect(config.ui.port).toBe(3000);
  });

  it("reads and merges frozenink.yml", () => {
    const configDir = join(TEST_DIR, "with-config");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "frozenink.yml"),
      "sync:\n  interval: 300\n",
    );

    process.env.FROZENINK_HOME = configDir;
    const config = loadConfig();

    // Overridden values
    expect(config.sync.interval).toBe(300);

    // Defaults preserved
    expect(config.ui.port).toBe(3000);
  });

  it("applies FROZENINK_* env var overrides", () => {
    process.env.FROZENINK_HOME = join(TEST_DIR, "env-test");
    mkdirSync(join(TEST_DIR, "env-test"), { recursive: true });

    process.env.FROZENINK_SYNC_INTERVAL = "60";
    process.env.FROZENINK_UI_PORT = "8080";

    const config = loadConfig();

    expect(config.sync.interval).toBe(60);
    expect(config.ui.port).toBe(8080);
  });

  it("env vars override frozenink.yml values", () => {
    const configDir = join(TEST_DIR, "env-override");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "frozenink.yml"),
      "ui:\n  port: 4000\n",
    );

    process.env.FROZENINK_HOME = configDir;
    process.env.FROZENINK_UI_PORT = "9999";

    const config = loadConfig();
    expect(config.ui.port).toBe(9999);
  });

});
