# VeeContext

VeeContext is a local data aggregation tool that crawls multiple sources (GitHub repositories, Obsidian vaults, Git repos), syncs their content into a local SQLite database, renders navigable Obsidian-compatible markdown, and serves everything through a web UI and Model Context Protocol (MCP) server for AI coding assistants.

## Architecture

```
Data Sources (GitHub API, Obsidian Vault, Git Repo, ...)
        |
        v
  +-------------+
  |   Crawlers   |  Sync data from sources into local DB + markdown
  +------+------+
         |
         v
  +-------------+
  |    Core      |  SQLite DB, schemas, sync engine, search (FTS5)
  +------+------+
         |
    +----+----+
    v         v
+-------+ +-----+
|  MCP  | | CLI |  MCP server exposes context; CLI manages everything
+-------+ +-----+
              |
              v
          +------+
          |  UI  |  Web viewer with themes, file tree, search
          +------+
```

## Packages

| Package | Description |
|---------|-------------|
| [`@veecontext/core`](packages/core/) | Shared types, Drizzle ORM + SQLite schemas, sync engine, FTS5 search, config loader |
| [`@veecontext/crawlers`](packages/crawlers/) | Data source crawlers and markdown generators |
| [`@veecontext/mcp`](packages/mcp/) | MCP server with tools and resources for AI assistants |
| [`@veecontext/cli`](packages/cli/) | CLI (`vctx`) for init, add, sync, search, serve, daemon |
| [`@veecontext/ui`](packages/ui/) | Vite + React web UI with 6 display themes and syntax highlighting |

## Crawlers

Each crawler syncs a different data source into VeeContext. See individual docs for setup and details:

| Crawler | Source | Entities | Docs |
|---------|--------|----------|------|
| [GitHub](packages/crawlers/src/github/) | GitHub REST API | Issues, Pull Requests | [README](packages/crawlers/src/github/README.md) |
| [Obsidian](packages/crawlers/src/obsidian/) | Local Obsidian vault | Notes, Attachments | [README](packages/crawlers/src/obsidian/README.md) |
| [Git](packages/crawlers/src/git/) | Local Git repository | Commits, Branches, Tags | [README](packages/crawlers/src/git/README.md) |

## Quick Start

```bash
# Install dependencies
bun install

# Install the vctx CLI globally (one-time)
cd packages/cli && bun link && cd ../..
# → vctx is now available in your PATH

# Initialize VeeContext
vctx init
```

> **Without global install** use the root script instead:
> `bun run vctx -- <command>`  e.g. `bun run vctx -- init`

### Adding collections

**Obsidian vault** — syncs all markdown notes and attachments:
```bash
vctx add obsidian --name my-vault --path ~/Documents/MyVault
```

**Git repository** — syncs commits, branches, and tags:
```bash
vctx add git --name my-repo --path ~/projects/my-repo

# Include full commit diffs in the rendered markdown:
vctx add git --name my-repo --path ~/projects/my-repo --include-diffs
```

**GitHub repository** — syncs issues and pull requests via the GitHub API:
```bash
vctx add github --name my-gh \
  --token ghp_yourPersonalAccessToken \
  --owner your-username \
  --repo your-repo-name
```

### Syncing and running

```bash
# Sync all collections once
vctx sync

# Sync a single collection
vctx sync --collection my-vault

# Start the background daemon (syncs on the configured interval)
vctx daemon start
vctx daemon status
vctx daemon stop

# Start the web UI + API server
bun run serve            # build UI then serve on http://localhost:3000
bun run dev              # dev mode: API on :3000, hot-reload UI on :5173
```

## Running the Web UI

**Development** — API server on port 3000, Vite dev server on port 5173 with hot reload:

```bash
bun run dev
# API:  http://localhost:3000
# UI:   http://localhost:5173  (proxies /api → 3000)
```

**Production** — build the UI then serve everything on a single port:

```bash
bun run serve           # builds UI then serves on http://localhost:3000
bun run serve -- --port 4000   # custom port
```

The `serve` command starts the REST API and serves the compiled UI as a static SPA from the same port. No separate process needed.

**MCP server only** (for AI assistants, no web UI):

```bash
vctx serve --mcp-only
# or: bun run vctx -- serve --mcp-only
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `vctx init` | Initialize `~/.veecontext/` directory and config |
| `vctx add <type>` | Add a new collection (github, obsidian, git) |
| `vctx sync` | Sync all enabled collections (or `--collection <name>`) |
| `vctx status` | Show sync status for all collections |
| `vctx search <query>` | Full-text search across all collections |
| `vctx collections list\|remove\|enable\|disable` | Manage collections |
| `vctx config get\|set\|list` | View/edit configuration |
| `vctx serve` | Start API server + MCP server |
| `vctx daemon start\|stop\|status` | Background sync daemon |

## Web UI

The viewer at `http://localhost:3000` (or `5173` in dev) provides:

- **Collection picker** — switch between synced data sources
- **File tree** — browse rendered markdown files; resizable sidebar
- **Tabs** — open multiple notes simultaneously; `Cmd+W` to close
- **Navigation history** — `Alt+←` / `Alt+→` (or `Cmd+[` / `Cmd+]`) to go back/forward
- **Backlinks panel** — collapsible right panel showing all notes that link to the current file
- **Markdown viewer** — wikilinks, callouts, image embeds, and syntax-highlighted code blocks
- **Full-text search** — `Cmd+P` or `Cmd+K` to open the quick switcher
- **6 display themes** — Default Light, Minimal Light, Solarized Light, Nord Dark, Catppuccin Dark, Dracula Dark

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

Exposes 6 tools and 4 resources for AI assistants:

**Tools:** `list_collections`, `search_entities`, `get_entity`, `query_entities`, `trigger_sync`, `get_sync_status`

**Resources:** `veecontext://collections`, `veecontext://collections/{name}`, `veecontext://entities/{collection}/{externalId}`, `veecontext://markdown/{collection}/{+path}`

## Development

```bash
# Install the vctx CLI globally (one-time)
cd packages/cli && bun link && cd ../..

# Dev server: API on :3000 + Vite hot reload on :5173
bun run dev

# Run any CLI command during development
vctx sync
vctx status
vctx search "my query"

# Build UI for production
bun run build:ui

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
  core/           Shared types, DB schemas, sync engine, search, config
  crawlers/       GitHub, Obsidian, and Git crawlers + markdown generators
  mcp/            MCP server (tools + resources)
  cli/            CLI entry point (vctx)
  ui/             Vite + React web viewer
docs/
  architecture.md
  crawlers.md
  themes.md
```

See also: [CLAUDE.md](CLAUDE.md) | [AGENTS.md](AGENTS.md)
