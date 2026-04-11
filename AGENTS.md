# Agents Guide

This file helps AI agents navigate and work effectively in the Frozen Ink codebase.

## Project Overview

Frozen Ink is a TypeScript monorepo that crawls data sources, stores them in SQLite, renders Obsidian-compatible markdown, and serves via a web UI and MCP server. Collections can be published to Cloudflare as password-protected websites with remote MCP access, or managed through an Electron desktop app. The codebase runs under both **Bun** (CLI, tests) and **Node.js** (Electron desktop) via a compatibility layer. See [README.md](README.md) for the full overview.

## Repository Layout

```
packages/
  core/src/               Foundation package
    compat/               Runtime compatibility layer (Bun ↔ Node.js/Electron)
      runtime.ts          isBun detection
      crypto.ts           CryptoHasher shim (Bun.CryptoHasher ↔ node:crypto)
      sqlite.ts           SQLite driver factory (bun:sqlite ↔ better-sqlite3)
      subprocess.ts       spawn() wrapper (Bun.spawn ↔ child_process.spawn)
      paths.ts            getModuleDir() replaces import.meta.dir
    config/               Zod schemas, defaults, loader (reads ~/.frozenink/config.json)
                          context.ts — context.yml management (collections + deployments CRUD)
    crawler/              Crawler interface, CrawlerRegistry, SyncEngine
    db/                   Drizzle ORM schemas (collection-schema.ts), client factory
    export/               Static site export (markdown + HTML)
      static-site.ts      exportStaticSite() with progress callbacks
    search/               FTS5 search indexer
    storage/              StorageBackend interface + LocalStorageBackend
    theme/                Theme interface, ThemeEngine, Obsidian markdown helpers (frontmatter, wikilink, callout, embed)

  crawlers/src/           Data source crawlers + markdown generators
    github/               GitHub REST API crawler (issues, PRs)
    obsidian/             Local Obsidian vault crawler (notes, attachments)
    git/                  Local Git repo crawler (commits, branches, tags)
    mantisbt/             MantisBT REST API crawler (issues, attachments)
    index.ts              createDefaultRegistry() + theme exports

  mcp/src/                MCP server
    server.ts             McpServer setup with STDIO transport
    tools/                5 registered tools (collection_list, entity_search, entity_get_data, entity_get_markdown, entity_get_attachment)
    resources/            Collection + entity resource templates

  cli/src/                CLI entry point
    index.ts              Commander program with all subcommands
    commands/             init, add, sync, status, collections, search, config, serve, daemon, generate, index, publish, unpublish
    commands/wrangler-api.ts     Wrangler CLI subprocess helpers (D1, R2, Workers)
    commands/management-api.ts   Management REST API (collection CRUD, sync, publish, export, config)
    commands/publish.ts          publishCollections() reusable function + CLI command

  worker/src/             Cloudflare Worker (published deployments)
    index.ts              Worker entry (export default { fetch })
    router.ts             Hono router with auth middleware
    auth.ts               Password auth (SHA-256, cookie + Bearer)
    login.ts              Login/logout HTML page
    types.ts              Env bindings (D1, R2, PASSWORD_HASH, WORKER_NAME)
    handlers/api.ts       REST API (reads from D1 + R2)
    handlers/ui.ts        Static UI serving from R2
    handlers/mcp.ts       JSON-RPC MCP endpoint (5 tools)
    db/client.ts          D1 query helpers
    db/search.ts          FTS5 search on D1
    storage/r2.ts         R2 object retrieval

  ui/src/                 Vite + React web viewer
    App.tsx               Root component with state management, theme switching, mode switching
    App.css               All CSS including 6 display themes + management UI styles
    components/           Layout, CollectionPicker, FileTree, MarkdownView, SearchBar, ThemeSwitcher, ModeSwitcher
    components/manage/    Management UI (CollectionList, CollectionForm, SyncPanel, PublishPanel, ExportPanel, SettingsPanel)
    types.ts              Collection, TreeNode, SearchResult + management types (AppInfo, SyncProgress, Deployment, etc.)

  desktop/                Electron desktop app
    src/main/index.ts     Main process (window, API server lifecycle, workspace management)
    src/main/workspace-manager.ts  Workspace CRUD (~/.frozenink/workspaces.json)
    src/main/ipc-handlers.ts       IPC bridge (file picker, workspace ops)
    src/main/tray.ts      System tray (sync status, quick actions)
    src/preload/index.ts  Context bridge for secure IPC
    build/                App icons (icon.icns, icon.png)
    electron-builder.yml  Build config (macOS DMG, Windows NSIS, Linux AppImage)
```

## Key Patterns

### Runtime Compatibility Layer

The codebase runs in two runtimes: **Bun** (CLI, tests) and **Node.js** (Electron desktop app). The compatibility layer in `packages/core/src/compat/` shims the differences. Key design decisions:

**Sync `require()` for drizzle driver selection.** `db/client.ts` uses synchronous `require("drizzle-orm/bun-sqlite")` or `require("drizzle-orm/better-sqlite3")` — not `await import()` — because `getCollectionDb()` is synchronous and used everywhere. The `isBun` check at runtime picks the right driver.

**Type shim for `SQLQueryBindings`.** The `bun:sqlite` type `SQLQueryBindings` doesn't exist in `better-sqlite3`. `SearchIndexer` uses `(string | number | null)[]` instead.

**`import.meta.dir` → `getModuleDir(import.meta.url)`.** Bun's non-standard `import.meta.dir` is replaced with `dirname(fileURLToPath(import.meta.url))`. Call sites pass `import.meta.url` and get back the directory. Test files still use `import.meta.dir` directly since tests always run under Bun.

**Import paths within `core/`.** Internal modules must import from specific files, not the barrel index:
- `getFrozenInkHome` is in `config/loader.ts`, NOT `config/context.ts`
- `getCollectionDb` is in `db/client.ts`, NOT `config/context.ts`
- The barrel `core/src/index.ts` re-exports everything, but circular or missing re-exports can cause `SyntaxError: Export named 'X' not found` at runtime — always verify the source module when adding new internal imports.

### Server Architecture (serve.ts)

The API server supports both runtimes via a `handleRequest(req: Request): Response` function:

- **Bun**: wraps `handleRequest` in `Bun.serve({ fetch: handleRequest })`
- **Node.js/Electron**: wraps it in `http.createServer` with a manual adapter that collects request body chunks, constructs a `Request`, calls `handleRequest`, then writes the `Response` back

Management API endpoints can return `Promise<Response>` (for async operations like reading request body, running sync). The `handleAsync()` helper casts `Promise<Response>` to `Response`. This works because Bun.serve's `fetch` handler accepts `Promise<Response>`, and the Node adapter uses `await Promise.resolve(handleRequest(req))`.

Management routes are checked first via `handleManagementRequest(req)` which returns `Response | null`. On `null`, the request falls through to browse API routes.

### UI Mode Architecture

The same React app (`packages/ui`) serves all three contexts:

| Context | `GET /api/app-info` returns | UI shows |
|---------|---------------------------|----------|
| Published (Cloudflare Worker) | `{ mode: "published" }` | Browse only |
| Local (`fink serve`) | `{ mode: "local" }` | Browse only |
| Desktop (Electron) | `{ mode: "desktop" }` | Browse + Manage toggle |

The mode is set by calling `setAppMode("desktop")` from the Electron main process before starting the API server. The management API endpoints are always registered but only meaningful in desktop mode.

In `App.tsx`, the main content area renders `manageContent || browseContent` — two separate JSX trees. The manage tree includes `CollectionList`, `SyncPanel`, `PublishPanel`, `ExportPanel`, `SettingsPanel` selected via `ManageNav`. The browse tree is the existing viewer (toolbar, tabs, markdown/HTML view, links panel).

### Workspace Model (Desktop Only)

A **workspace** maps to a `FROZENINK_HOME` directory. The Electron main process manages workspaces:

1. `~/.frozenink/workspaces.json` stores workspace metadata (name, path, lastOpened)
2. On launch, auto-opens the last workspace (or shows a welcome screen)
3. `process.env.FROZENINK_HOME` is set to the workspace path before any core module is loaded
4. The API server is started bound to that workspace
5. **Switching workspaces restarts the API server** — the main process calls `stop()` on the current server, updates `FROZENINK_HOME`, and creates a new server. Brief loading screen during the switch.

Each workspace is a standard Frozen Ink home directory (same structure as CLI's `~/.frozenink/`), so CLI and desktop can operate on the same data.

### Progress Reporting Pattern

Sync, publish, and export all use the same pattern for progress reporting:

1. An **in-memory state object** (e.g., `syncProgress`, `publishProgress`) is updated by callbacks during the operation
2. The UI **polls** a status endpoint every 500ms (`GET /api/sync/status`, etc.)
3. When `active === false`, the UI stops polling and shows the final result

No SSE or WebSocket — polling is simpler and works across all deployment contexts (Bun, Node, packaged Electron).

For publish specifically, the core logic is in `publishCollections(options, onProgress)`:
- **CLI** passes `(step, detail) => console.log(...)` as the callback
- **Management API** passes `(step, detail) => { publishProgress = { ...publishProgress, step, detail }; }`
- Same logic, different output channels

### Terminology
- **Crawler** = code that syncs data from an external source (implements `Crawler` interface)
- **Theme** (core) = markdown generator that renders entity data into Obsidian-compatible markdown (implements `Theme` interface)
- **Theme** (UI) = CSS display theme for the web viewer (6 options, selected via ThemeSwitcher)
- **Website** (when used in task requests) = the marketing website in `packages/website`, deployed to the `frozenink` Cloudflare Worker
- **Worker** (when used in task requests) = a Cloudflare Worker that hosts a collections site using the app UI (published collection deployment)

### Adding a New Crawler

1. Create `packages/crawlers/src/<name>/types.ts` with config and credential interfaces
2. Create `packages/crawlers/src/<name>/crawler.ts` implementing the `Crawler` interface from `@frozenink/core`
   - Use `createCryptoHasher()` from `@frozenink/core` for hashing (NOT `Bun.CryptoHasher`)
3. Create `packages/crawlers/src/<name>/theme.ts` implementing the `Theme` interface (markdown generator)
4. Register in `packages/crawlers/src/index.ts`: add to `createDefaultRegistry()` and export the theme
5. Update `packages/cli/src/commands/add.ts` with crawler-specific CLI flags
6. Register the theme in `sync.ts`, `daemon.ts`, and `generate.ts`
7. Add crawler type to `CollectionForm.tsx` — add entry to `CRAWLER_TYPES` array, add config/credential field renderers in `renderConfigFields()` and `renderCredentialFields()`
8. Write tests in `<name>/__tests__/`
9. Create `<name>/README.md` and link from the main README

### Crawler Interface

```typescript
interface Crawler {
  metadata: CrawlerMetadata;
  initialize(config, credentials): Promise<void>;
  sync(cursor: SyncCursor | null): Promise<SyncResult>;
  validateCredentials(credentials): Promise<boolean>;
  dispose(): Promise<void>;
}
```

`sync()` returns `{ entities, nextCursor, hasMore, deletedExternalIds }`. The SyncEngine calls it in a loop until `hasMore === false`.

### Collection Registry (context.yml)

Frozen Ink uses `~/.frozenink/context.yml` as the collection registry (replacing the previous `master.db`). The file is managed by `packages/core/src/config/context.ts` with atomic writes and Zod validation.

```yaml
collections:
  my-github:
    title: "My GitHub Issues"     # optional, defaults to name
    crawler: github
    enabled: true                 # optional, defaults to true
    syncInterval: 3600            # optional
    config:
      owner: user
      repo: repo
    credentials:
      token: ghp_xxx

deployments:
  my-pub:
    url: https://my-pub.example.workers.dev
    mcpUrl: https://my-pub.example.workers.dev/mcp
    collections: [my-github, my-notes]
    d1DatabaseId: abc-123-def
    r2BucketName: my-pub-files
    cfAccountId: abc123
    passwordProtected: true
    publishedAt: "2026-04-05T12:00:00Z"
```

Key functions: `loadContext()`, `saveContext()`, `getCollection()`, `listCollections()`, `addCollection()`, `getCollectionDbPath()`, `addDeployment()`, `getDeployment()`.

Collection DB path is inferred: `~/.frozenink/collections/{name}/data.db` (no explicit `dbPath` stored).

### SQLite Schema

Each collection has its own SQLite database.

#### Collection DBs (`~/.frozenink/collections/<name>/data.db`)

```sql
entities
  id              INTEGER PRIMARY KEY AUTOINCREMENT
  external_id     TEXT NOT NULL              -- source identifier (e.g. "commit:abc123", "notes/daily.md")
  entity_type     TEXT NOT NULL              -- "issue", "pull_request", "note", "commit", "branch", "tag"
  title           TEXT NOT NULL
  data            TEXT NOT NULL DEFAULT '{}' -- JSON: full structured data from crawler
  content_hash    TEXT                       -- SHA-256 for change detection (skip re-render if unchanged)
  markdown_path   TEXT                       -- relative path to rendered .md file on disk
  url             TEXT                       -- link to original source
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))

entity_tags
  id              INTEGER PRIMARY KEY AUTOINCREMENT
  entity_id       INTEGER NOT NULL REFERENCES entities(id)
  tag             TEXT NOT NULL

attachments
  id              INTEGER PRIMARY KEY AUTOINCREMENT
  entity_id       INTEGER NOT NULL REFERENCES entities(id)
  filename        TEXT NOT NULL
  mime_type       TEXT NOT NULL
  storage_path    TEXT NOT NULL              -- relative path to file on disk
  backend         TEXT NOT NULL              -- "local"

sync_state                                   -- sync cursors (persisted in DB, NOT filesystem)
  id              INTEGER PRIMARY KEY AUTOINCREMENT
  crawler_type    TEXT NOT NULL
  cursor          TEXT                       -- JSON: crawler-specific cursor (page, timestamp, known hashes)
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))

sync_runs                                    -- audit log of sync operations
  id              INTEGER PRIMARY KEY AUTOINCREMENT
  status          TEXT NOT NULL              -- "running", "completed", "failed"
  entities_created INTEGER NOT NULL DEFAULT 0
  entities_updated INTEGER NOT NULL DEFAULT 0
  entities_deleted INTEGER NOT NULL DEFAULT 0
  errors          TEXT                       -- JSON array
  started_at      TEXT NOT NULL DEFAULT (datetime('now'))
  completed_at    TEXT

entity_relations
  id              INTEGER PRIMARY KEY AUTOINCREMENT
  source_entity_id INTEGER NOT NULL REFERENCES entities(id)
  target_entity_id INTEGER NOT NULL REFERENCES entities(id)
  relation_type    TEXT NOT NULL             -- "references", "closes", etc.

entity_links
  id              INTEGER PRIMARY KEY AUTOINCREMENT
  source_entity_id INTEGER NOT NULL REFERENCES entities(id)
  source_markdown_path TEXT NOT NULL
  target_path      TEXT NOT NULL
```

#### FTS5 Virtual Table (created by `SearchIndexer`)

```sql
entities_fts (title, content, tags, entity_id UNINDEXED, entity_type UNINDEXED, external_id UNINDEXED)
```

Tables are created via raw SQL `CREATE IF NOT EXISTS` in `client.ts` (no migrations).

### What's in the DB vs Filesystem

| Content | Storage | Rationale |
|---------|---------|-----------|
| Crawler config, credentials | context.yml | Human-readable YAML, single source of truth |
| Deployment metadata | context.yml (`deployments` section) | No secrets — only URLs, resource IDs |
| Entity metadata + structured data | Collection DB (`entities.data` JSON) | Queryable, FTS-indexed |
| Sync cursors / pagination state | Collection DB (`sync_state.cursor` JSON) | Survives restarts, enables incremental sync |
| Sync run audit log | Collection DB (`sync_runs`) | Queryable history |
| Content change hashes | Collection DB (`entities.content_hash`) | Skip re-render on unchanged data |
| Tags and relations | Collection DB (`entity_tags`, `entity_relations`) | Queryable associations |
| Attachment metadata | Collection DB (`attachments`) | Path + MIME lookup |
| Rendered markdown files | Filesystem (`collections/<name>/markdown/`) | Large, rebuildable from DB data |
| Attachment binary files | Filesystem (`collections/<name>/attachments/`) | Large binaries, served by HTTP |
| FTS search index | Collection DB (`entities_fts` virtual table) | SQLite FTS5 for fast text search |
| Desktop workspace list | `~/.frozenink/workspaces.json` | App-level metadata, not per-workspace |

### Filesystem Layout

```
~/.frozenink/                               -- default workspace (CLI + desktop)
  config.json                                -- app configuration
  context.yml                                -- collection registry + deployment metadata
  workspaces.json                            -- desktop app workspace registry
  collections/
    <name>/
      data.db                                -- collection database (entities, sync state, etc.)
      markdown/                              -- rendered markdown files
        commits/abc1234-fix-bug.md
        issues/42-login-error.md
        notes/daily/2024-01-15.md
      attachments/                           -- binary files (images, etc.)
        images/photo.png
        git/abc1234/logo.png
```

A workspace is any directory with a `context.yml` and `collections/` subdirectory. The CLI defaults to `~/.frozenink/`. The desktop app can create and switch between multiple workspaces at arbitrary paths, each functioning as an independent `FROZENINK_HOME`.

### Publishing to Cloudflare

The `fink publish` command uses the `wrangler` CLI for all Cloudflare operations. Authentication is handled by wrangler — run `wrangler login` once, or set `CLOUDFLARE_API_TOKEN`. No API tokens or account IDs are passed on the command line.

Three CF resources are created per deployment:

1. **D1 Database** (`{workerName}-db`) — entities, tags, links, FTS5 search index, R2 manifest
2. **R2 Bucket** (`{workerName}-files`) — markdown files, attachments, static UI assets (organized by `{collection}/markdown/...`, `{collection}/attachments/...`, `_ui/...`)
3. **Worker** (`{workerName}`) — Hono server with D1 + R2 bindings, password auth, REST API, MCP

The publish flow:
- All SQL (schema DDL + data INSERTs + FTS5) is written to a single temp `.sql` file and executed via `wrangler d1 execute --file`
- Files are uploaded via `wrangler r2 object put`
- Worker is deployed by generating a temp `wrangler.toml` and running `wrangler deploy --config`

Re-running `fink publish --name <existing>` **updates** an existing deployment:
- D1 tables are dropped and recreated with fresh data
- R2 files are uploaded, then stale files are detected via the `r2_manifest` D1 table and deleted
- Worker is redeployed with the same bindings

The worker implements MCP via direct JSON-RPC (not the SDK's StreamableHTTPServerTransport, which requires Node.js APIs unavailable in Workers).

#### When to do a full publish vs. worker-only

| Scenario | Command |
|----------|---------|
| Changed crawler data, synced new entities | Full publish: `fink publish <collections...> --name <name>` |
| Changed `packages/worker/src/**` (server logic, HTML rendering, routes) | Worker-only (after rebuild): see below |
| Changed `packages/ui/src/**` (React components, CSS) | Worker-only (after rebuild): see below |
| Changed `packages/crawlers/src/mantisbt/theme.ts` (HTML renderer) | Worker-only — HTML is rendered on-the-fly by the worker at request time, not pre-stored |

#### Build steps required before publishing

**Always build before publishing** — the CLI uploads pre-built artifacts, not source files:

```bash
# After changing packages/ui/src/** (React, CSS):
cd packages/ui && bun run build          # outputs to packages/ui/dist/

# After changing packages/worker/src/** (server, routes, renderers):
cd packages/worker && bun run build      # outputs to packages/worker/dist/worker.js

# Then deploy (worker + UI assets only, no D1/R2 data change):
bun run packages/cli/src/index.ts publish --worker-only --name <deployment-name>
```

Skipping the build means the old compiled bundle is deployed — source changes have no effect.

**Note:** `wrangler` is not globally installed; invoke it via `bunx wrangler` or use the CLI which calls it as a subprocess automatically.

### Build & Test Commands

```bash
bun run typecheck          # tsc --build (all packages)
bun test packages/core/src/
bun test packages/crawlers/src/
bun test packages/mcp/src/
bun test packages/cli/src/
cd packages/ui && npx vitest run   # UI uses vitest + happy-dom, not bun:test
cd packages/ui && npx vite build   # Production build
cd packages/worker && bun run build  # esbuild worker bundle
```

### Desktop App Build

The Electron desktop app lives in `packages/desktop/`. It uses esbuild to bundle all TypeScript (main process + all `@frozenink/*` workspace packages) into a single ESM file (`dist/main/index.mjs`) that Electron loads directly.

```bash
bun install                           # install all workspace deps (from repo root, NOT npm)
bun run build:ui                      # build the React UI (packages/ui/dist/)
cd packages/desktop && bun run start  # compile + run in dev mode
```

`bun run start` runs `bun build.mjs && electron .` — the build step takes ~1s.

For distribution packaging:
```bash
cd packages/desktop
npx @electron/rebuild -m .            # rebuild better-sqlite3 for Electron's Node ABI
bun run dist                          # package for all platforms (output: release/)
```

**Important:** Always use `bun install` from the repo root. Do NOT run `npm install` in the desktop directory or anywhere in the monorepo — npm doesn't support the `workspace:*` protocol used by sibling packages.

**Build details:**
- `build.mjs` uses esbuild with `format: "esm"` and a banner that shims `require()` via `createRequire(import.meta.url)`
- `electron`, `better-sqlite3`, `bun:sqlite`, and `drizzle-orm/bun-sqlite` are externalized (not bundled)
- The preload script is bundled separately as CJS (Electron requires CJS for preload)
- `import.meta.url` works correctly in the ESM output, so `getModuleDir()` resolves paths properly

See `packages/desktop/electron-builder.yml` for build targets (macOS DMG, Windows NSIS, Linux AppImage).

### Important Conventions

- Package names: `@frozenink/<name>` with `workspace:*` for inter-package deps
- TypeScript: strict mode, ESNext target, bundler module resolution, project references with `composite: true`
- Tests: `bun:test` for all packages except UI which uses `vitest` with `happy-dom`
- Test files: `src/__tests__/*.test.ts` — excluded from tsc dist output via tsconfig `exclude`
- UI package: separate tsconfig with `jsx: "react-jsx"`, `lib: ["DOM"]`, `types: []` (no bun-types)
- Worker package: separate tsconfig with `@cloudflare/workers-types` (no bun-types, no composite)
- Desktop package: separate tsconfig with `module: "commonjs"`, `target: "ES2022"` for Electron
- DB: WAL journal mode, foreign keys ON, JSON columns via `text(..., { mode: "json" })`
- Attachment `storagePath`: use optional field to override default `attachments/{externalId}/{filename}` path
- Markdown generators use helpers from `@frozenink/core`: `frontmatter()`, `wikilink()`, `callout()`, `embed()`
- Hashing: always use `createCryptoHasher()` from `@frozenink/core`, never `Bun.CryptoHasher` directly
- Subprocesses: use `spawnProcess()` / `spawnDetached()` from `@frozenink/core`, never `Bun.spawn` directly
- Module paths: use `getModuleDir(import.meta.url)` from `@frozenink/core`, never `import.meta.dir`
- New subpath exports in `core` (like `@frozenink/core/export`) require both a barrel `index.ts` and a matching entry in `packages/core/package.json` `exports` field
- UI management components live in `packages/ui/src/components/manage/` — CSS uses existing CSS variable system (--bg, --text, --accent, etc.) from App.css

## Key Files

- `packages/core/src/compat/` — Runtime compatibility layer (Bun ↔ Node.js/Electron)
- `packages/core/src/crawler/interface.ts` — `Crawler`, `CrawlerEntityData`, `SyncResult` interfaces
- `packages/core/src/crawler/sync-engine.ts` — `SyncEngine` that orchestrates crawl->render->store
- `packages/core/src/config/context.ts` — `loadContext()`, `saveContext()`, collection + deployment CRUD
- `packages/core/src/db/collection-schema.ts` — `entities`, `entity_tags`, `attachments`, `sync_state`, `sync_runs`
- `packages/core/src/db/client.ts` — `getCollectionDb()` with raw SQL CREATE IF NOT EXISTS
- `packages/core/src/export/static-site.ts` — `exportStaticSite()` for markdown/HTML export
- `packages/core/src/theme/obsidian.ts` — `frontmatter()`, `wikilink()`, `callout()`, `embed()` helpers
- `packages/crawlers/src/index.ts` — `createDefaultRegistry()` registers all crawlers; exports all themes
- `packages/cli/src/commands/add.ts` — crawler-specific CLI flag handling
- `packages/cli/src/commands/serve.ts` — REST API + static UI serving (Bun.serve or Node http)
- `packages/cli/src/commands/management-api.ts` — Management API (collection CRUD, sync, publish, export, config)
- `packages/cli/src/commands/publish.ts` — `publishCollections()` reusable function + CLI command
- `packages/cli/src/commands/wrangler-api.ts` — Wrangler CLI subprocess helpers (D1, R2, Workers)
- `packages/worker/src/router.ts` — Hono router for published worker
- `packages/worker/src/handlers/mcp.ts` — JSON-RPC MCP endpoint for published worker
- `packages/ui/src/components/MarkdownView.tsx` — react-markdown + remark-gfm + rehype-highlight
- `packages/ui/src/components/manage/` — Management UI components (desktop mode only)
- `packages/desktop/src/main/index.ts` — Electron main process entry point

## Common Gotchas

### Tests
- Run `bun test` from project root, not from `packages/ui/` (UI uses vitest, not bun:test)
- `tsc --build` compiles test files into dist unless excluded — check tsconfig `exclude` patterns
- UI tests have pre-existing failures in `@testing-library/user-event` + `happy-dom` (document not initialized). These are not caused by code changes.

### Runtime Compatibility
- Never use `Bun.CryptoHasher`, `Bun.spawn`, `bun:sqlite`, or `import.meta.dir` directly in `packages/core` or `packages/crawlers` — use the compat layer (`createCryptoHasher()`, `spawnProcess()`, `openDatabase()`, `getModuleDir()`)
- `db/client.ts` uses `require()` not `import()` for drizzle driver selection — this is intentional (sync function)
- When importing within `packages/core/src/`, use specific file paths (e.g., `../config/loader` not `../config/context`) — barrel re-exports can cause "Export not found" errors if the target module doesn't actually export that symbol
- The `@frozenink/core/export` subpath requires a matching `exports` entry in `packages/core/package.json`
- `better-sqlite3` must be rebuilt for Electron's Node ABI using `npx @electron/rebuild -m .` — without this you get `NODE_MODULE_VERSION` mismatch errors at runtime

### Server / API
- Management API endpoints that read the request body (`POST`, `PATCH`) return `Promise<Response>` via `handleAsync()` — the Node http adapter handles this with `await Promise.resolve()`
- `handleManagementRequest()` is called before browse routes in `serve.ts` — management routes like `DELETE /api/collections/:name` must match before the browse `GET /api/collections/:name/tree` pattern
- Sync/publish/export progress uses polling (500ms), not SSE/WebSocket — the in-memory state objects reset when the server restarts

### Desktop App
- The Electron main process sets `process.env.FROZENINK_HOME` before importing any `@frozenink/core` modules — module-level code in core reads this env var via `getFrozenInkHome()`
- Switching workspaces restarts the API server (creates a new `http.createServer` or `Bun.serve`). The old server must be stopped first or the port will conflict
- `packages/desktop/tsconfig.json` uses `module: "commonjs"` because Electron's main process expects CJS

### Publishing
- `publishCollections()` in `publish.ts` is the reusable core function — both the CLI command and management API call it with different `onProgress` callbacks
- The worker bundle (`packages/worker/dist/worker.js`) must be pre-built before publish — the Electron app resolves it relative to `__moduleDir`

### Other
- FTS5 query parser interprets `-` as NOT — quote or avoid hyphens in test search terms
- react-markdown v9 sanitizes non-standard URL schemes — use fragment URLs (`#wikilink/target`) for internal links
- `for-each-ref` format doesn't support `%x00` — use `\t` (tab) as separator for branch/tag parsing
- `git diff-tree` needs `--root` flag to show diffs for the initial commit (no parent)
- Worker MCP uses direct JSON-RPC, not the SDK transport — the SDK's `StreamableHTTPServerTransport` requires Node.js APIs

## REST API Endpoints

Served by `fink serve` locally, or by the Cloudflare Worker when published:

| Endpoint | Description |
|----------|-------------|
| `GET /api/collections` | List all collections |
| `GET /api/collections/:name/tree` | File tree of markdown files |
| `GET /api/collections/:name/default-file` | Most recently updated file |
| `GET /api/collections/:name/markdown/*path` | Raw markdown file content |
| `GET /api/collections/:name/entities` | Paginated entity list (query: limit, offset, type) |
| `GET /api/search?q=&collection=&type=&limit=` | FTS5 search |
| `GET /api/collections/:name/backlinks/*path` | Backlinks for a file |
| `GET /api/collections/:name/outgoing-links/*path` | Outgoing links from a file |
| `GET /api/attachments/:collection/*path` | Serve attachment files |
| `POST /mcp` | MCP JSON-RPC endpoint (published worker only) |
| Non-API routes | Serve built UI (from filesystem locally, from R2 when published) |

### Management API Endpoints (Desktop Mode)

Active when `mode === "desktop"` (set by the Electron main process). These are served by the same local API server.

| Endpoint | Description |
|----------|-------------|
| `GET /api/app-info` | Returns `{ mode, version, workspacePath }` |
| `POST /api/collections` | Add a new collection |
| `DELETE /api/collections/:name` | Delete a collection |
| `PATCH /api/collections/:name` | Update collection config/enable/disable |
| `POST /api/collections/:name/rename` | Rename a collection |
| `GET /api/collections/:name/status` | Entity count + last sync run |
| `POST /api/sync/:name` | Trigger sync for one collection |
| `POST /api/sync` | Sync all enabled collections |
| `GET /api/sync/status` | Current sync progress (poll every 500ms) |
| `GET /api/collections/:name/sync-runs` | Sync history (last 20 runs) |
| `GET /api/deployments` | List Cloudflare deployments |
| `DELETE /api/deployments/:name` | Remove a deployment record |
| `POST /api/publish` | Publish to Cloudflare |
| `GET /api/publish/status` | Publish progress (poll) |
| `POST /api/export` | Export collections to folder |
| `GET /api/export/status` | Export progress (poll) |
| `GET /api/config` | Get app configuration |
| `PATCH /api/config` | Update app configuration |
| `POST /api/cloudflare/check-auth` | Verify Cloudflare credentials |
