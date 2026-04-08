import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isBun } from "./runtime";

/**
 * Get the directory of the current module.
 * Replaces Bun's `import.meta.dir` in a Node.js-compatible way.
 *
 * Usage: `getModuleDir(import.meta.url)` instead of `import.meta.dir`.
 */
export function getModuleDir(importMetaUrl: string): string {
  if (isBun && typeof (import.meta as any).dir === "string") {
    // Under Bun, import.meta.dir is directly available, but since
    // we receive the URL we can still derive it the same way.
  }
  return dirname(fileURLToPath(importMetaUrl));
}
