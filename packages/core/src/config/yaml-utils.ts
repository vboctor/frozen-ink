import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "fs";
import { dirname } from "path";
import { randomBytes } from "crypto";
import yaml from "js-yaml";

export function atomicWriteYaml(filePath: string, data: unknown): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const content = yaml.dump(data, { lineWidth: -1, noRefs: true, sortKeys: false });
  const tmpPath = `${filePath}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmpPath, content, "utf-8");
  renameSync(tmpPath, filePath);
}

export function readYaml<T>(filePath: string): T | null {
  if (!existsSync(filePath)) return null;
  const raw = readFileSync(filePath, "utf-8");
  return (yaml.load(raw) as T) ?? null;
}
