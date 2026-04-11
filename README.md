# Frozen Ink

## What Is Frozen Ink?

Frozen Ink is a local-first knowledge layer for technical work. It crawls sources like
GitHub repositories, Obsidian vaults, Git repos, and MantisBT/MantisHub; syncs them into
a local SQLite index; renders and serves everything through a web UI and MCP server for
AI tools.

It can run fully local, be managed through a cross-platform Electron desktop app, or be
published to Cloudflare as a password-protected site with remote MCP access.

[TypeScript Collection from Github](https://typescript.vboctor.workers.dev/)

## Why Frozen Ink?

Knowledge is spread across many services and SaaS tools. That fragmentation makes search
inconsistent, context switching expensive, and often limits access to such data by AI models.
Frozen Ink solves this by creating a unified, queryable, markdown-native workspace that is
both human-readable and AI-accessible. Such workspaces can be accessible locally or via
publishing to the cloud.

## Key Features

- **Online to Offline**: Keep offline access to online systems like GitHub and
  MantisHub.
- **Offline to Online**: Make local knowledge (for example Obsidian notes)
  available to cloud agents via MCP.
- **Optimized for AI**: Markdown-native content, free-text search, and MCP
  endpoints built in.
- **Break the Silos**: Efficiently gather and query knowledge across many
  services in one place.
- **Archival**: Snapshot data for long-term retention and future reference.

## Architecture

```
Data Sources (GitHub API, Obsidian Vault, Git Repo, MantisBT, ...)
        |
        v
  +-------------+
  |   Crawlers   |  Sync data from sources into local DB + markdown
  +------+------+
         |
         v
  +-------------+
  |    Core      |  SQLite DB, schemas, sync engine, search (FTS5), compat layer, export
  +------+------+
         |
    +----+----+------+--------+
    v         v      v        v
+-------+ +-----+ +--------+ +---------+
|  MCP  | | CLI | | Worker | | Desktop |  MCP server; CLI; CF Worker; Electron app
+-------+ +-----+ +--------+ +---------+
              |                    |
              v                    v
          +------+            +------+
          |  UI  |  <------   |  UI  |  Same React UI (browse + manage modes)
          +------+            +------+
```

## Packages

| Package | Description |
|---------|-------------|
| [`@frozenink/core`](packages/core/) | Shared types, Drizzle ORM + SQLite schemas, sync engine, FTS5 search, config loader, context.yml management, runtime compat layer, static export |
| [`@frozenink/crawlers`](packages/crawlers/) | Data source crawlers and markdown generators |
| [`@frozenink/mcp`](packages/mcp/) | MCP server with tools and resources for AI assistants |
| [`@frozenink/cli`](packages/cli/) | CLI (`fink`) for init, add, sync, search, serve, daemon, publish, unpublish; management API |
| [`@frozenink/ui`](packages/ui/) | Vite + React web UI with 6 display themes, browse + management modes |
| [`@frozenink/worker`](packages/worker/) | Cloudflare Worker for published deployments (Hono + D1 + R2) |
| [`@frozenink/desktop`](packages/desktop/) | Electron desktop app with workspace management, system tray |

## Crawlers

Each crawler syncs a different data source into Frozen Ink. See individual docs for setup and details:

| Crawler | Source | Entities | Docs |
|---------|--------|----------|------|
| [GitHub](packages/crawlers/src/github/) | GitHub REST API | Issues, Pull Requests | [README](packages/crawlers/src/github/README.md) |
| [Obsidian](packages/crawlers/src/obsidian/) | Local Obsidian vault | Notes, Attachments | [README](packages/crawlers/src/obsidian/README.md) |
| [Git](packages/crawlers/src/git/) | Local Git repository | Commits, Branches, Tags | [README](packages/crawlers/src/git/README.md) |
| MantisBT | MantisBT REST API | Issues, Attachments | — |

## Quick Start

All commands below run from the **repository root**. No global install required.

```bash
# Install dependencies
bun install

# Initialize Frozen Ink (~/.frozenink/)
bun run fink -- init
```

### Adding collections

**Obsidian vault** — syncs all markdown notes and attachments:
```bash
bun run fink -- add obsidian --name my-vault --path ~/Documents/MyVault
```

**Git repository** — syncs commits, branches, and tags:
```bash
bun run fink -- add git --name my-repo --path ~/projects/my-repo

# Include full commit diffs in the rendered markdown:
bun run fink -- add git --name my-repo --path ~/projects/my-repo --include-diffs
```

**GitHub repository** — syncs issues and pull requests via the GitHub API:
```bash
bun run fink -- add github --name my-gh \
  --token ghp_yourPersonalAccessToken \
  --owner your-username \
  --repo your-repo-name
```

### Syncing

```bash
# Sync a single collection
bun run fink -- sync my-vault

# Sync all collections
bun run fink -- sync "*"

# Check sync status
bun run fink -- status

# Start the background daemon (syncs on the configured interval)
bun run fink -- daemon start
bun run fink -- daemon status
bun run fink -- daemon stop
```

### Running the web UI

```bash
# Dev mode: API on :3000, hot-reload UI on :5173
bun run dev

# Production: build UI then serve everything on :3000
bun run serve

# MCP server only (for AI assistants, no web UI)
bun run fink -- serve --mcp-only
```

> **Optional: install `fink` globally** to drop the `bun run fink --` prefix:
> ```bash
> cd packages/cli && bun link && cd ../..
> fink sync "*"   # works from anywhere
> ```

### Publishing to Cloudflare

Publish collections as a password-protected website with remote MCP access. Uses `wrangler` for authentication — run `wrangler login` once, or set `CLOUDFLARE_API_TOKEN`.

```bash
# Build UI and worker first
bun run build:ui
cd packages/worker && bun run build && cd ../..

# Publish
bun run fink -- publish my-github my-notes --password secret123 --name my-pub

# Update (re-sync locally first, then re-publish with same --name)
bun run fink -- sync "*"
bun run fink -- publish my-github my-notes --password secret123 --name my-pub

# Unpublish
bun run fink -- unpublish my-pub
```

See [docs/publish.md](docs/publish.md) for full details.

### Desktop App

The desktop app wraps the same UI and API server in Electron, adding workspace management, collection CRUD, sync/publish/export UI, and a system tray.

**Building and running:**

```bash
# 1. Install all dependencies (from repo root — uses Bun workspaces)
bun install

# 2. Build the React UI (the desktop app serves this via its API server)
bun run build:ui

# 3. Compile + launch the desktop app
cd packages/desktop
bun run start
```

`bun run start` runs two steps: compiles TypeScript to JavaScript via esbuild (bundling all `@frozenink/*` workspace packages inline), then launches Electron.

**Packaging for distribution:**

```bash
cd packages/desktop
npx @electron/rebuild -m .   # rebuild better-sqlite3 for Electron's Node ABI
bun run dist                 # all platforms
bun run dist:mac             # macOS DMG (universal)
bun run dist:win             # Windows NSIS
bun run dist:linux           # Linux AppImage + deb
```

Packaged output goes to `packages/desktop/release/`.

> **Note:** Use `bun install` from the repo root, not `npm install`. The monorepo uses Bun's `workspace:*` protocol for inter-package deps, which npm doesn't support.

The desktop app runs core modules under Node.js (via Electron) using a compatibility layer (`packages/core/src/compat/`) that shims Bun-specific APIs (`bun:sqlite` -> `better-sqlite3`, `Bun.CryptoHasher` -> `node:crypto`, etc.). The esbuild step bundles everything into a single ESM file (`dist/main/index.mjs`) that Electron loads directly.

### Static Export

Export collections as standalone files from the desktop app's Export panel, or via the API:

```bash
# Markdown export (raw files + index)
curl -X POST http://localhost:3747/api/export \
  -H 'Content-Type: application/json' \
  -d '{"collections": ["my-repo"], "outputDir": "/tmp/export", "format": "markdown"}'

# HTML export (rendered pages + navigable index)
curl -X POST http://localhost:3747/api/export \
  -H 'Content-Type: application/json' \
  -d '{"collections": ["my-repo"], "outputDir": "/tmp/export-html", "format": "html"}'
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `fink init` | Initialize `~/.frozenink/` directory and config |
| `fink add <type>` | Add a new collection (github, obsidian, git, mantisbt) |
| `fink sync <name\|"*">` | Sync a collection or all (`"*"`) |
| `fink status` | Show sync status for all collections |
| `fink search <query>` | Full-text search across all collections |
| `fink collections list\|remove\|enable\|disable\|rename\|update` | Manage collections |
| `fink config get\|set\|list` | View/edit configuration |
| `fink generate <name\|"*">` | Re-generate markdown without re-syncing |
| `fink index <name\|"*">` | Rebuild search index and links |
| `fink serve` | Start API server + MCP server |
| `fink daemon start\|stop\|status` | Background sync daemon |
| `fink publish <collections...>` | Publish to Cloudflare (see [docs/publish.md](docs/publish.md)) |
| `fink unpublish <name>` | Remove a Cloudflare deployment |

## Web UI

The viewer at `http://localhost:3000` (or `5173` in dev) provides:

- **Collection picker** — switch between synced data sources (auto-hidden with single collection)
- **File tree** — browse rendered markdown files; resizable sidebar
- **Tabs** — open multiple notes simultaneously; `Cmd+W` to close
- **Navigation history** — `Alt+←` / `Alt+→` (or `Cmd+[` / `Cmd+]`) to go back/forward
- **Backlinks panel** — collapsible right panel showing all notes that link to the current file
- **Markdown viewer** — wikilinks, callouts, image embeds, and syntax-highlighted code blocks
- **Full-text search** — `Cmd+P` or `Cmd+K` to open the quick switcher
- **6 display themes** — Default Light, Minimal Light, Solarized Light, Nord Dark, Catppuccin Dark, Dracula Dark
- **Logout button** — visible in sidebar when authenticated via password (published deployments)

**Keyboard shortcuts:**

| Shortcut | Action |
|----------|--------|
| `Cmd+P` / `Cmd+K` | Quick switcher |
| `Cmd+W` | Close current tab |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Cycle tabs |
| `Alt+←` / `Cmd+[` | Navigate back |
| `Alt+→` / `Cmd+]` | Navigate forward |
| `Cmd+\` | Toggle sidebar |

## MCP Server

Exposes 5 tools and 4 resources for AI assistants:

**Tools:** `collection_list`, `entity_search`, `entity_get_data`, `entity_get_markdown`, `entity_get_attachment`

**Resources:** `frozenink://collections`, `frozenink://collections/{name}`, `frozenink://entities/{collection}/{externalId}`, `frozenink://markdown/{collection}/{+path}`

## Development

```bash
# Install the fink CLI globally (one-time)
cd packages/cli && bun link && cd ../..

# Dev server: API on :3000 + Vite hot reload on :5173
bun run dev

# Run any CLI command during development
fink sync "*"
fink status
fink search "my query"

# Build UI for production
bun run build:ui

# Build worker for publishing
cd packages/worker && bun run build

# Type-check all packages
bun run typecheck

# Run tests
bun test packages/core/src/
bun test packages/crawlers/src/
bun test packages/mcp/src/
bun test packages/cli/src/
cd packages/ui && npx vitest run

# Clean dist output
bun run clean
```

## Project Structure

```
packages/
  core/           Shared types, DB schemas, sync engine, search, config, compat layer, export
  crawlers/       GitHub, Obsidian, Git, and MantisBT crawlers + markdown generators
  mcp/            MCP server (tools + resources)
  cli/            CLI entry point (fink) + management API
  ui/             Vite + React web viewer (browse + manage modes)
  worker/         Cloudflare Worker for published deployments
  desktop/        Electron desktop app
docs/
  architecture.md
  crawlers.md
  themes.md
  publish.md
```

See also: [CLAUDE.md](CLAUDE.md) | [AGENTS.md](AGENTS.md)
