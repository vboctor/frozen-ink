# Agents Guide

This file helps AI agents navigate and work effectively in the VeeContext codebase.

## Project Overview

VeeContext is a Bun monorepo that crawls data sources, stores them in SQLite, renders Obsidian-compatible markdown, and serves via a web UI and MCP server. See [README.md](README.md) for the full overview.

## Repository Layout

```
packages/
  core/src/               Foundation package
    config/               Zod schemas, defaults, loader (reads ~/.veecontext/config.json)
    crawler/              Crawler interface, CrawlerRegistry, SyncEngine
    db/                   Drizzle ORM schemas (master-schema.ts, collection-schema.ts), client factory
    search/               FTS5 search indexer
    storage/              StorageBackend interface + LocalStorageBackend
    theme/                Theme interface, ThemeEngine, Obsidian markdown helpers (frontmatter, wikilink, callout, embed)

  crawlers/src/           Data source crawlers + markdown generators
    github/               GitHub REST API crawler (issues, PRs)
    obsidian/             Local Obsidian vault crawler (notes, attachments)
    git/                  Local Git repo crawler (commits, branches, tags)
    index.ts              createDefaultRegistry() + theme exports

  mcp/src/                MCP server
    server.ts             McpServer setup with STDIO transport
    tools/                6 registered tools (list_collections, search, get_entity, query, sync, status)
    resources/            Collection + entity resource templates

  cli/src/                CLI entry point
    index.ts              Commander program with all subcommands
    commands/             init, add, sync, status, collections, search, config, serve, daemon

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
6. Register the theme in `sync.ts`, `daemon.ts`, and `mcp/tools/sync.ts`
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

### SQLite Schema

VeeContext uses a two-tier database architecture: one master DB and one DB per collection.

#### Master DB (`~/.veecontext/master.db`)

```sql
collections
  id              INTEGER PRIMARY KEY AUTOINCREMENT
  name            TEXT NOT NULL              -- collection display name
  crawler_type    TEXT NOT NULL              -- "github", "obsidian", "git"
  config          TEXT NOT NULL DEFAULT '{}' -- JSON: crawler config (repoPath, owner, etc.)
  credentials     TEXT NOT NULL DEFAULT '{}' -- JSON: tokens, paths
  sync_interval   INTEGER NOT NULL DEFAULT 3600
  enabled         INTEGER NOT NULL DEFAULT 1 -- boolean
  db_path         TEXT NOT NULL              -- path to collection's data.db
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
```

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
```

#### FTS5 Virtual Table (created by `SearchIndexer`)

```sql
entities_fts (title, content, tags, entity_id UNINDEXED, entity_type UNINDEXED, external_id UNINDEXED)
```

Tables are created via raw SQL `CREATE IF NOT EXISTS` in `client.ts` (no migrations).

### What's in the DB vs Filesystem

| Content | Storage | Rationale |
|---------|---------|-----------|
| Crawler config, credentials | Master DB (`collections`) | Single source of truth |
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
  master.db                            -- master database
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

### Build & Test Commands

```bash
bun run typecheck          # tsc --build (all packages)
bun test packages/core/src/
bun test packages/crawlers/src/
bun test packages/mcp/src/
bun test packages/cli/src/
cd packages/ui && npx vitest run   # UI uses vitest + happy-dom, not bun:test
cd packages/ui && npx vite build   # Production build
```

### Important Conventions

- Package names: `@veecontext/<name>` with `workspace:*` for inter-package deps
- TypeScript: strict mode, ESNext target, bundler module resolution, project references with `composite: true`
- Tests: `bun:test` for all packages except UI which uses `vitest` with `happy-dom`
- Test files: `src/__tests__/*.test.ts` — excluded from tsc dist output via tsconfig `exclude`
- UI package: separate tsconfig with `jsx: "react-jsx"`, `lib: ["DOM"]`, `types: []` (no bun-types)
- DB: WAL journal mode, foreign keys ON, JSON columns via `text(..., { mode: "json" })`
- Attachment `storagePath`: use optional field to override default `attachments/{externalId}/{filename}` path
- Markdown generators use helpers from `@veecontext/core`: `frontmatter()`, `wikilink()`, `callout()`, `embed()`

## Key Files

- `packages/core/src/crawler/interface.ts` — `Crawler`, `CrawlerEntityData`, `SyncResult` interfaces
- `packages/core/src/crawler/sync-engine.ts` — `SyncEngine` that orchestrates crawl→render→store
- `packages/core/src/db/master-schema.ts` — `collections` table
- `packages/core/src/db/collection-schema.ts` — `entities`, `entity_tags`, `attachments`, `sync_state`, `sync_runs`
- `packages/core/src/db/client.ts` — `getMasterDb()`, `getCollectionDb()` with raw SQL CREATE IF NOT EXISTS
- `packages/core/src/theme/obsidian.ts` — `frontmatter()`, `wikilink()`, `callout()`, `embed()` helpers
- `packages/crawlers/src/index.ts` — `createDefaultRegistry()` registers all crawlers; exports all themes
- `packages/cli/src/commands/add.ts` — crawler-specific CLI flag handling
- `packages/cli/src/commands/serve.ts` — REST API + static UI serving
- `packages/ui/src/components/MarkdownView.tsx` — react-markdown + remark-gfm + rehype-highlight

## Common Gotchas

- Run `bun test` from project root, not from `packages/ui/` (UI uses vitest, not bun:test)
- `tsc --build` compiles test files into dist unless excluded — check tsconfig `exclude` patterns
- FTS5 query parser interprets `-` as NOT — quote or avoid hyphens in test search terms
- `Bun.CryptoHasher("sha256")` is Bun-specific — crawlers package requires Bun runtime
- react-markdown v9 sanitizes non-standard URL schemes — use fragment URLs (`#wikilink/target`) for internal links
- `for-each-ref` format doesn't support `%x00` — use `\t` (tab) as separator for branch/tag parsing
- `git diff-tree` needs `--root` flag to show diffs for the initial commit (no parent)

## REST API Endpoints

Served by `vctx serve` (Bun.serve):

| Endpoint | Description |
|----------|-------------|
| `GET /api/collections` | List all collections |
| `GET /api/collections/:name/tree` | File tree of markdown files |
| `GET /api/collections/:name/markdown/*path` | Raw markdown file content |
| `GET /api/collections/:name/entities` | Paginated entity list (query: limit, offset, type) |
| `GET /api/search?q=&collection=&type=&limit=` | FTS5 search |
| `GET /api/attachments/:collection/*path` | Serve attachment files |
| Non-API routes | Serve built UI from `packages/ui/dist/` with SPA fallback |
