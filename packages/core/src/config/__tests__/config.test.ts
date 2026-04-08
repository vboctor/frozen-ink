import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
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
      db: { mode: "turso", tursoUrl: "https://db.turso.io", tursoToken: "tok" },
      storage: { mode: "s3", s3Bucket: "my-bucket", s3Region: "us-east-1" },
      sync: { interval: 600, concurrency: 4, retries: 5 },
      ui: { port: 8080 },
      mcp: { transport: "sse", port: 9090 },
      logging: { level: "debug", file: "/var/log/frozenink.log" },
    });

    expect(config.db.mode).toBe("turso");
    expect(config.db.tursoUrl).toBe("https://db.turso.io");
    expect(config.storage.mode).toBe("s3");
    expect(config.storage.s3Bucket).toBe("my-bucket");
    expect(config.sync.interval).toBe(600);
    expect(config.sync.concurrency).toBe(4);
    expect(config.ui.port).toBe(8080);
    expect(config.mcp.transport).toBe("sse");
    expect(config.logging.level).toBe("debug");
    expect(config.logging.file).toBe("/var/log/frozenink.log");
  });

  it("applies defaults for empty config", () => {
    const config = configSchema.parse({});

    expect(config.db.mode).toBe("local");
    expect(config.storage.mode).toBe("local");
    expect(config.sync.interval).toBe(900);
    expect(config.sync.concurrency).toBe(2);
    expect(config.sync.retries).toBe(3);
    expect(config.ui.port).toBe(3000);
    expect(config.mcp.transport).toBe("stdio");
    expect(config.mcp.port).toBe(3001);
    expect(config.logging.level).toBe("info");
  });

  it("rejects invalid db mode", () => {
    expect(() =>
      configSchema.parse({ db: { mode: "postgres" } }),
    ).toThrow();
  });

  it("rejects invalid logging level", () => {
    expect(() =>
      configSchema.parse({ logging: { level: "verbose" } }),
    ).toThrow();
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

  it("rejects invalid turso URL", () => {
    expect(() =>
      configSchema.parse({ db: { mode: "turso", tursoUrl: "not-a-url" } }),
    ).toThrow();
  });
});

describe("Default Config", () => {
  it("passes schema validation", () => {
    const config = configSchema.parse(defaultConfig);
    expect(config).toEqual(defaultConfig);
  });

  it("has sensible default values", () => {
    expect(defaultConfig.db.mode).toBe("local");
    expect(defaultConfig.storage.mode).toBe("local");
    expect(defaultConfig.sync.interval).toBe(900);
    expect(defaultConfig.ui.port).toBe(3000);
    expect(defaultConfig.mcp.transport).toBe("stdio");
    expect(defaultConfig.logging.level).toBe("info");
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
    expect(config.db.mode).toBe("local");
    expect(config.sync.interval).toBe(900);
    expect(config.ui.port).toBe(3000);
  });

  it("reads and merges config.json", () => {
    const configDir = join(TEST_DIR, "with-config");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({
        db: { mode: "turso", tursoUrl: "https://db.turso.io" },
        sync: { interval: 300 },
      }),
    );

    process.env.FROZENINK_HOME = configDir;
    const config = loadConfig();

    // Overridden values
    expect(config.db.mode).toBe("turso");
    expect(config.db.tursoUrl).toBe("https://db.turso.io");
    expect(config.sync.interval).toBe(300);

    // Defaults preserved
    expect(config.storage.mode).toBe("local");
    expect(config.ui.port).toBe(3000);
    expect(config.sync.concurrency).toBe(2);
  });

  it("applies FROZENINK_* env var overrides", () => {
    process.env.FROZENINK_HOME = join(TEST_DIR, "env-test");
    mkdirSync(join(TEST_DIR, "env-test"), { recursive: true });

    process.env.FROZENINK_DB_MODE = "turso";
    process.env.FROZENINK_SYNC_INTERVAL = "60";
    process.env.FROZENINK_UI_PORT = "8080";
    process.env.FROZENINK_LOGGING_LEVEL = "debug";

    const config = loadConfig();

    expect(config.db.mode).toBe("turso");
    expect(config.sync.interval).toBe(60);
    expect(config.ui.port).toBe(8080);
    expect(config.logging.level).toBe("debug");
  });

  it("env vars override config.json values", () => {
    const configDir = join(TEST_DIR, "env-override");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({ ui: { port: 4000 } }),
    );

    process.env.FROZENINK_HOME = configDir;
    process.env.FROZENINK_UI_PORT = "9999";

    const config = loadConfig();
    expect(config.ui.port).toBe(9999);
  });

  it("rejects invalid config.json with clear errors", () => {
    const configDir = join(TEST_DIR, "invalid");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({ db: { mode: "postgres" } }),
    );

    process.env.FROZENINK_HOME = configDir;
    expect(() => loadConfig()).toThrow();
  });
});
