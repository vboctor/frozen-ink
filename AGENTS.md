# Agents Guide

This file helps AI agents navigate and work effectively in the VeeContext codebase.

## Project Overview

VeeContext is a Bun monorepo that crawls data sources, stores them in SQLite, renders Obsidian-compatible markdown, and serves via a web UI and MCP server. Collections can be published to Cloudflare as password-protected websites with remote MCP access. See [README.md](README.md) for the full overview.

## Repository Layout

```
packages/
  core/src/               Foundation package
    config/               Zod schemas, defaults, loader (reads ~/.veecontext/config.json)
                          context.ts — context.yml management (collections + deployments CRUD)
    crawler/              Crawler interface, CrawlerRegistry, SyncEngine
    db/                   Drizzle ORM schemas (collection-schema.ts), client factory
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
    App.tsx               Root component with state management + theme switching
    App.css               All CSS including 6 display themes
    components/           Layout, CollectionPicker, FileTree, MarkdownView, SearchBar, ThemeSwitcher
    types.ts              Collection, TreeNode, SearchResult interfaces
```

## Key Patterns

### Terminology
- **Crawler** = code that syncs data from an external source (implements `Crawler` interface)
- **Theme** (core) = markdown generator that renders entity data into Obsidian-compatible markdown (implements `Theme` interface)
- **Theme** (UI) = CSS display theme for the web viewer (6 options, selected via ThemeSwitcher)

### Adding a New Crawler

1. Create `packages/crawlers/src/<name>/types.ts` with config and credential interfaces
2. Create `packages/crawlers/src/<name>/crawler.ts` implementing the `Crawler` interface from `@veecontext/core`
3. Create `packages/crawlers/src/<name>/theme.ts` implementing the `Theme` interface (markdown generator)
4. Register in `packages/crawlers/src/index.ts`: add to `createDefaultRegistry()` and export the theme
5. Update `packages/cli/src/commands/add.ts` with crawler-specific CLI flags
6. Register the theme in `sync.ts`, `daemon.ts`, and `generate.ts`
7. Write tests in `<name>/__tests__/`
8. Create `<name>/README.md` and link from the main README

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

VeeContext uses `~/.veecontext/context.yml` as the collection registry (replacing the previous `master.db`). The file is managed by `packages/core/src/config/context.ts` with atomic writes and Zod validation.

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

Collection DB path is inferred: `~/.veecontext/collections/{name}/data.db` (no explicit `dbPath` stored).

### SQLite Schema

Each collection has its own SQLite database.

#### Collection DBs (`~/.veecontext/collections/<name>/data.db`)

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

### Filesystem Layout

```
~/.veecontext/
  config.json                          -- app configuration
  context.yml                          -- collection registry + deployment metadata
  collections/
    <name>/
      data.db                          -- collection database (entities, sync state, etc.)
      markdown/                        -- rendered markdown files
        commits/abc1234-fix-bug.md
        issues/42-login-error.md
        notes/daily/2024-01-15.md
      attachments/                     -- binary files (images, etc.)
        images/photo.png
        git/abc1234/logo.png
```

### Publishing to Cloudflare

The `vctx publish` command uses the `wrangler` CLI for all Cloudflare operations. Authentication is handled by wrangler — run `wrangler login` once, or set `CLOUDFLARE_API_TOKEN`. No API tokens or account IDs are passed on the command line.

Three CF resources are created per deployment:

1. **D1 Database** (`{workerName}-db`) — entities, tags, links, FTS5 search index, R2 manifest
2. **R2 Bucket** (`{workerName}-files`) — markdown files, attachments, static UI assets (organized by `{collection}/markdown/...`, `{collection}/attachments/...`, `_ui/...`)
3. **Worker** (`{workerName}`) — Hono server with D1 + R2 bindings, password auth, REST API, MCP

The publish flow:
- All SQL (schema DDL + data INSERTs + FTS5) is written to a single temp `.sql` file and executed via `wrangler d1 execute --file`
- Files are uploaded via `wrangler r2 object put`
- Worker is deployed by generating a temp `wrangler.toml` and running `wrangler deploy --config`

Re-running `vctx publish --name <existing>` **updates** an existing deployment:
- D1 tables are dropped and recreated with fresh data
- R2 files are uploaded, then stale files are detected via the `r2_manifest` D1 table and deleted
- Worker is redeployed with the same bindings

The worker implements MCP via direct JSON-RPC (not the SDK's StreamableHTTPServerTransport, which requires Node.js APIs unavailable in Workers).

#### When to do a full publish vs. worker-only

| Scenario | Command |
|----------|---------|
| Changed crawler data, synced new entities | Full publish: `vctx publish <collections...> --name <name>` |
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

### Important Conventions

- Package names: `@veecontext/<name>` with `workspace:*` for inter-package deps
- TypeScript: strict mode, ESNext target, bundler module resolution, project references with `composite: true`
- Tests: `bun:test` for all packages except UI which uses `vitest` with `happy-dom`
- Test files: `src/__tests__/*.test.ts` — excluded from tsc dist output via tsconfig `exclude`
- UI package: separate tsconfig with `jsx: "react-jsx"`, `lib: ["DOM"]`, `types: []` (no bun-types)
- Worker package: separate tsconfig with `@cloudflare/workers-types` (no bun-types, no composite)
- DB: WAL journal mode, foreign keys ON, JSON columns via `text(..., { mode: "json" })`
- Attachment `storagePath`: use optional field to override default `attachments/{externalId}/{filename}` path
- Markdown generators use helpers from `@veecontext/core`: `frontmatter()`, `wikilink()`, `callout()`, `embed()`

## Key Files

- `packages/core/src/crawler/interface.ts` — `Crawler`, `CrawlerEntityData`, `SyncResult` interfaces
- `packages/core/src/crawler/sync-engine.ts` — `SyncEngine` that orchestrates crawl->render->store
- `packages/core/src/config/context.ts` — `loadContext()`, `saveContext()`, collection + deployment CRUD
- `packages/core/src/db/collection-schema.ts` — `entities`, `entity_tags`, `attachments`, `sync_state`, `sync_runs`
- `packages/core/src/db/client.ts` — `getCollectionDb()` with raw SQL CREATE IF NOT EXISTS
- `packages/core/src/theme/obsidian.ts` — `frontmatter()`, `wikilink()`, `callout()`, `embed()` helpers
- `packages/crawlers/src/index.ts` — `createDefaultRegistry()` registers all crawlers; exports all themes
- `packages/cli/src/commands/add.ts` — crawler-specific CLI flag handling
- `packages/cli/src/commands/serve.ts` — REST API + static UI serving
- `packages/cli/src/commands/publish.ts` — publish collections to Cloudflare
- `packages/cli/src/commands/wrangler-api.ts` — Wrangler CLI subprocess helpers (D1, R2, Workers)
- `packages/worker/src/router.ts` — Hono router for published worker
- `packages/worker/src/handlers/mcp.ts` — JSON-RPC MCP endpoint for published worker
- `packages/ui/src/components/MarkdownView.tsx` — react-markdown + remark-gfm + rehype-highlight

## Common Gotchas

- Run `bun test` from project root, not from `packages/ui/` (UI uses vitest, not bun:test)
- `tsc --build` compiles test files into dist unless excluded — check tsconfig `exclude` patterns
- FTS5 query parser interprets `-` as NOT — quote or avoid hyphens in test search terms
- `Bun.CryptoHasher("sha256")` is Bun-specific — crawlers package requires Bun runtime
- react-markdown v9 sanitizes non-standard URL schemes — use fragment URLs (`#wikilink/target`) for internal links
- `for-each-ref` format doesn't support `%x00` — use `\t` (tab) as separator for branch/tag parsing
- `git diff-tree` needs `--root` flag to show diffs for the initial commit (no parent)
- Worker MCP uses direct JSON-RPC, not the SDK transport — the SDK's `StreamableHTTPServerTransport` requires Node.js APIs

## REST API Endpoints

Served by `vctx serve` (Bun.serve) locally, or by the Cloudflare Worker when published:

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
