import { isBun } from "./runtime";
import { spawn as nodeSpawn } from "node:child_process";

export interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  pid: number;
}

export interface SpawnOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  stdio?: ("pipe" | "ignore")[];
}

/**
 * Spawn a subprocess and collect output.
 * Under Bun: uses Bun.spawn.
 * Under Node.js/Electron: uses child_process.spawn.
 */
export async function spawnProcess(
  cmd: string[],
  opts?: SpawnOptions,
): Promise<SpawnResult> {
  if (isBun) {
    const proc = Bun.spawn(cmd, {
      cwd: opts?.cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: opts?.env ?? { ...process.env },
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;
    return { stdout, stderr, exitCode, pid: proc.pid };
  }

  // Node.js / Electron
  return new Promise((resolve, reject) => {
    const child = nodeSpawn(cmd[0], cmd.slice(1), {
      cwd: opts?.cwd,
      env: (opts?.env ?? process.env) as NodeJS.ProcessEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout?.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
        stderr: Buffer.concat(stderrChunks).toString("utf-8"),
        exitCode: code ?? 1,
        pid: child.pid ?? 0,
      });
    });
  });
}

/**
 * Spawn a background (detached) process.
 * Under Bun: uses Bun.spawn with unref.
 * Under Node.js/Electron: uses child_process.spawn with detached + unref.
 */
export function spawnDetached(
  cmd: string[],
  opts?: { env?: Record<string, string | undefined> },
): { pid: number; unref: () => void } {
  if (isBun) {
    const proc = Bun.spawn(cmd, {
      stdio: ["ignore", "ignore", "ignore"],
      env: opts?.env ?? { ...process.env },
    });
    return { pid: proc.pid, unref: () => proc.unref() };
  }

  const child = nodeSpawn(cmd[0], cmd.slice(1), {
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
    env: (opts?.env ?? process.env) as NodeJS.ProcessEnv,
  });
  return {
    pid: child.pid ?? 0,
    unref: () => child.unref(),
  };
}
