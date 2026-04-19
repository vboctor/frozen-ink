/**
 * Build script for the Frozen Ink CLI.
 *
 * Produces two outputs:
 *   1. dist/fink.mjs  — Minified ESM bundle for npm publishing (runs via Node/Bun)
 *   2. dist/fink-*     — Standalone Bun executables for direct download
 *
 * All @frozenink/* workspace packages are inlined. External native dependencies
 * (better-sqlite3, bun:sqlite) are resolved at runtime.
 */
import { build } from "esbuild";
import { execSync } from "child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, chmodSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, "dist");

// ── Step 1: Bundle with esbuild ────────────────────────────────────────

async function bundleJS() {
  mkdirSync(distDir, { recursive: true });

  await build({
    entryPoints: [join(__dirname, "src/index.ts")],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "esm",
    outfile: join(distDir, "fink.mjs"),
    minify: true,
    treeShaking: true,
    sourcemap: false,
    legalComments: "none",
    // ESM shim for packages that use require()
    banner: {
      js: [
        "#!/usr/bin/env node",
        'import { createRequire } from "node:module";',
        "const require = createRequire(import.meta.url);",
      ].join("\n"),
    },
    external: [
      // Native SQLite — resolved at runtime via the compat layer
      "better-sqlite3",
      "bun:sqlite",
      "drizzle-orm/bun-sqlite",
      // Native Node modules
      "fsevents",
      // Optional dev dependency of ink
      "react-devtools-core",
    ],
    resolveExtensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
    // Ensure JSX is handled
    jsx: "automatic",
    loader: { ".tsx": "tsx", ".ts": "ts" },
  });

  // Strip duplicate shebang — source has #!/usr/bin/env bun which esbuild
  // preserves alongside the banner's #!/usr/bin/env node.  Only keep the
  // banner shebang (node) so the npm bundle runs under Node.
  const outPath = join(distDir, "fink.mjs");
  let code = readFileSync(outPath, "utf-8");
  code = code.replace(/^#!\/usr\/bin\/env bun\n/, "");
  writeFileSync(outPath, code);
  chmodSync(outPath, 0o755);

  console.log("✓ Bundled dist/fink.mjs");
}

// ── Step 2: Compile standalone Bun executables ─────────────────────────

async function compileBunExecutables() {
  // Bun's `bun build --compile` resolves all imports including native ones.
  // For Bun executables, bun:sqlite is built-in and better-sqlite3 is not needed.
  // We compile directly from source — Bun handles TypeScript natively.
  //
  // Note: Cross-compilation (e.g., building linux binary on macOS) requires
  // that the target runtime can resolve all imports. We compile only the
  // current platform by default; CI builds each platform natively.

  const targets = [
    { name: "fink-darwin-arm64", target: "bun-darwin-arm64" },
    { name: "fink-darwin-x64", target: "bun-darwin-x64" },
    { name: "fink-linux-x64", target: "bun-linux-x64" },
    { name: "fink-linux-arm64", target: "bun-linux-arm64" },
    { name: "fink-windows-x64.exe", target: "bun-windows-x64" },
  ];

  for (const { name, target } of targets) {
    const outPath = join(distDir, name);
    try {
      execSync(
        `bun build --compile --minify --target=${target} src/index.ts --outfile ${outPath} --external better-sqlite3 --external react-devtools-core`,
        { cwd: __dirname, stdio: "pipe" },
      );
      console.log(`✓ Compiled ${name}`);
    } catch (err) {
      // Cross-compilation may fail for some targets — that's expected
      const stderr = err.stderr ? err.stderr.toString().split("\n")[0] : "";
      console.warn(`⚠ Skipped ${name}${stderr ? ": " + stderr : ""}`);
    }
  }
}

// ── Step 3: Generate npm package.json for dist ─────────────────────────

function generateDistPackageJson() {
  const pkg = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf-8"));

  const distPkg = {
    name: "@vboctor/fink",
    version: pkg.version,
    description: "Frozen Ink CLI — crawl, sync, search, and publish local data replicas",
    license: "MIT",
    author: "Victor Boctor",
    repository: {
      type: "git",
      url: "https://github.com/vboctor/fink",
    },
    homepage: "https://github.com/vboctor/fink#readme",
    bugs: {
      url: "https://github.com/vboctor/fink/issues",
    },
    keywords: [
      "cli",
      "data-sync",
      "obsidian",
      "github",
      "git",
      "markdown",
      "mcp",
      "cloudflare-workers",
      "sqlite",
      "full-text-search",
    ],
    type: "module",
    bin: {
      fink: "./fink.mjs",
    },
    engines: {
      node: ">=20.0.0",
    },
    files: ["fink.mjs", "README.md", "LICENSE"],
    // Runtime deps that are externalized from the bundle
    dependencies: {
      "better-sqlite3": "^11.0.0",
    },
  };

  writeFileSync(join(distDir, "package.json"), JSON.stringify(distPkg, null, 2));
  console.log("✓ Generated dist/package.json");
}

// ── Main ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const bundleOnly = args.includes("--bundle-only");
const exeOnly = args.includes("--exe-only");
const all = !bundleOnly && !exeOnly;

if (all || bundleOnly) {
  await bundleJS();
  generateDistPackageJson();

  // Copy README for npm, stripping maintainer-only sections
  const readmeSrc = join(__dirname, "README.md");
  if (existsSync(readmeSrc)) {
    let readme = readFileSync(readmeSrc, "utf-8");
    // Remove "Publishing to npm" section (maintainer docs, not for end users)
    readme = readme.replace(/\n## Publishing to npm\n[\s\S]*?(?=\n## )/m, "");
    // Collapse any resulting multiple blank lines
    readme = readme.replace(/\n{3,}/g, "\n\n");
    writeFileSync(join(distDir, "README.md"), readme);
    console.log("✓ Copied README.md to dist/ (stripped maintainer sections)");
  }
  const licenseSrc = join(__dirname, "LICENSE");
  if (existsSync(licenseSrc)) {
    copyFileSync(licenseSrc, join(distDir, "LICENSE"));
    console.log("✓ Copied LICENSE to dist/");
  }
}

if (all || exeOnly) {
  await compileBunExecutables();
}

console.log("\nBuild complete.");
