import { afterEach, describe, expect, it } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { resolveWrangler } from "../resources";

const originalHome = process.env.HOME;
const originalNvmDir = process.env.NVM_DIR;
let testDir: string;

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalNvmDir === undefined) delete process.env.NVM_DIR;
  else process.env.NVM_DIR = originalNvmDir;
  if (testDir) rmSync(testDir, { recursive: true, force: true });
});

describe("resolveWrangler", () => {
  it("finds a Wrangler install under NVM when the app PATH omits it", async () => {
    testDir = mkdtempSync(join(tmpdir(), "frozenink-wrangler-"));
    process.env.HOME = testDir;
    delete process.env.NVM_DIR;

    const binDir = join(testDir, ".nvm", "versions", "node", "v20.19.5", "bin");
    mkdirSync(binDir, { recursive: true });
    const nodePath = join(binDir, "node");
    const wranglerPath = join(binDir, "wrangler");
    writeFileSync(nodePath, "#!/bin/sh\nexit 0\n");
    writeFileSync(wranglerPath, "#!/bin/sh\nexit 0\n");
    chmodSync(nodePath, 0o755);
    chmodSync(wranglerPath, 0o755);

    await expect(resolveWrangler(join(testDir, "packaged-app"))).resolves.toBe(wranglerPath);
  });
});
