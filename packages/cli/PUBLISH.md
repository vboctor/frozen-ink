# Publishing @vboctor/fink to npm

This guide covers how to build, version, and publish the Frozen Ink CLI to npm.

The CLI is published as `@vboctor/fink`. The build script bundles all workspace
packages into a single ESM file (`dist/fink.mjs`) so users only need Node.js
and `better-sqlite3` (installed automatically as a dependency).

## Prerequisites

1. **Node.js >= 20** and **Bun** installed locally
2. **npm account** with access to the `@vboctor` scope:

   ```bash
   npm login
   npm whoami  # should print your npm username
   ```

3. If this is the first publish under the `@vboctor` scope, ensure the scope
   is available (either as your npm username or an npm org you own).

## Version management

The version is defined in one place: `packages/cli/package.json` in the
`version` field. Both the CLI (`fink --version`) and the published npm package
read from it automatically — the build script inlines the version at bundle
time.

Bump the version before publishing:

```bash
cd packages/cli
npm version patch   # 0.1.0 -> 0.1.1
npm version minor   # 0.1.0 -> 0.2.0
npm version major   # 0.1.0 -> 1.0.0
```

## Build

```bash
cd packages/cli

# Bundle only (for npm)
bun run build

# Bundle + standalone executables
bun run build:all
```

This produces:

| Output | Purpose |
|--------|---------|
| `dist/fink.mjs` | Minified ESM bundle with `#!/usr/bin/env node` shebang |
| `dist/package.json` | Auto-generated with correct `bin`, `files`, `engines`, and `dependencies` |
| `dist/README.md` | Copied from source (maintainer sections stripped) |
| `dist/LICENSE` | Copied from source |
| `dist/fink-*` | Standalone Bun executables (only with `build:all` or `build:exe`) |

### What the build does

1. **Bundles** all source TypeScript + workspace packages (`@frozenink/core`,
   `@frozenink/crawlers`, `@frozenink/mcp`) into a single `dist/fink.mjs` via
   esbuild, targeting Node 20 ESM.
2. **Externalizes** `better-sqlite3` (native module installed at runtime by npm).
3. **Generates** `dist/package.json` with the npm package name `@vboctor/fink`,
   correct `bin`, `engines`, `files`, and `dependencies`.
4. **Copies** `README.md` (with the "Publishing to npm" section stripped) and
   `LICENSE` into `dist/`.
5. **Rewrites** the shebang to `#!/usr/bin/env node` so the npm package runs
   under Node, not Bun.

## Publish

```bash
# One-step build + publish
bun run publish:npm
```

This runs `bun build.mjs --bundle-only && cd dist && npm publish --access public`.

For a dry run first:

```bash
bun run build
cd dist && npm publish --access public --dry-run
```

## Verify

After publishing, verify the package is installable:

```bash
npm install -g @vboctor/fink
fink --version
fink --help
```

## Full publish checklist

1. Ensure all changes are committed and CI passes (`bun run ci`)
2. Bump the version: `cd packages/cli && npm version patch`
3. Dry run: `bun run build && cd dist && npm publish --access public --dry-run`
4. Publish: `bun run publish:npm`
5. Verify: `npm install -g @vboctor/fink && fink --version`
6. Commit the version bump and push

## Package naming

| Context | Name |
|---------|------|
| Monorepo workspace | `@frozenink/cli` (in `packages/cli/package.json`) |
| Published npm package | `@vboctor/fink` (generated in `dist/package.json`) |
| CLI binary | `fink` |

The source `package.json` has `"private": true` — this is intentional. The
`publish:npm` script runs from `dist/`, which has its own generated
`package.json` without the `private` flag.
