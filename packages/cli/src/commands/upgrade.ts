import { Command } from "commander";
import { spawnProcess } from "@frozenink/core";
import pkg from "../../package.json";
import {
  NPM_PACKAGE_NAME,
  GITHUB_RELEASES_URL,
  checkForUpdate,
  isStandaloneBinary,
} from "../update-notifier";

export const upgradeCommand = new Command("upgrade")
  .description("Upgrade fink to the latest release")
  .option("--check", "Print current and latest versions without upgrading")
  .action(async (opts: { check?: boolean }) => {
    const current: string = pkg.version;
    const { latest, hasUpdate } = await checkForUpdate(current);

    if (!latest) {
      console.error("Could not determine the latest version (registry unreachable).");
      process.exit(1);
    }

    if (opts.check) {
      console.log(`current ${current}, latest ${latest}`);
      process.exit(hasUpdate ? 1 : 0);
    }

    if (!hasUpdate) {
      console.log(`fink is up to date (${current}).`);
      return;
    }

    if (isStandaloneBinary()) {
      console.log(`A newer version (${latest}) is available.`);
      console.log(`Download the matching binary from: ${GITHUB_RELEASES_URL}`);
      return;
    }

    console.log(`Upgrading fink ${current} → ${latest}...`);
    const result = await spawnProcess(
      ["npm", "install", "-g", `${NPM_PACKAGE_NAME}@latest`],
      { env: process.env as Record<string, string | undefined> },
    );
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.exitCode !== 0) {
      console.error(`npm install exited with code ${result.exitCode}.`);
      process.exit(result.exitCode);
    }
    console.log("Upgrade complete.");
  });
