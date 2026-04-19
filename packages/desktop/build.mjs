/**
 * Build script for the Electron desktop app.
 * Bundles TypeScript source (main process + preload) into JavaScript
 * that Electron's Node.js runtime can load.
 *
 * - Inlines all @frozenink/* workspace packages (they're TypeScript)
 * - Externalizes electron, better-sqlite3, and Node builtins (native / provided at runtime)
 */
import { build } from "esbuild";
import { execSync } from "child_process";

const common = {
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  sourcemap: true,
  // ESM output requires a require() shim for packages that use require()
  banner: {
    js: `import { createRequire } from "node:module";
const require = createRequire(import.meta.url);`,
  },
  external: [
    "electron",
    "electron-updater",
    "better-sqlite3",
    // Bun-specific modules — only reached at runtime when isBun===true (never in Electron)
    "bun:sqlite",
    "drizzle-orm/bun-sqlite",
    // Native Node modules that shouldn't be bundled
    "fsevents",
  ],
  // Resolve workspace packages from the monorepo
  resolveExtensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
};

// Main process — output as .mjs so Electron loads it as ESM
await build({
  ...common,
  entryPoints: ["src/main/index.ts"],
  outfile: "dist/main/index.mjs",
});

// Preload script — must be CJS (Electron preload doesn't support ESM)
await build({
  ...common,
  format: "cjs",
  banner: { js: "" },
  entryPoints: ["src/preload/index.ts"],
  outfile: "dist/preload/index.js",
});

// Rebuild native modules (better-sqlite3) against Electron's Node.js version
console.log("Rebuilding native modules for Electron...");
execSync("electron-rebuild -m .", { stdio: "inherit" });

console.log("Desktop build complete: dist/main/index.mjs, dist/preload/index.js");
