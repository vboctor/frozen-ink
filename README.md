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

All commands below run from the **repository root**. No global install required.

```bash
# Install dependencies
bun install

# Initialize VeeContext (~/.veecontext/)
bun run vctx -- init
```

### Adding collections

**Obsidian vault** — syncs all markdown notes and attachments:
```bash
bun run vctx -- add obsidian --name my-vault --path ~/Documents/MyVault
```

**Git repository** — syncs commits, branches, and tags:
```bash
bun run vctx -- add git --name my-repo --path ~/projects/my-repo

# Include full commit diffs in the rendered markdown:
bun run vctx -- add git --name my-repo --path ~/projects/my-repo --include-diffs
```

**GitHub repository** — syncs issues and pull requests via the GitHub API:
```bash
bun run vctx -- add github --name my-gh \
  --token ghp_yourPersonalAccessToken \
  --owner your-username \
  --repo your-repo-name
```

### Syncing

```bash
# Sync all collections once
bun run vctx -- sync

# Sync a single collection
bun run vctx -- sync --collection my-vault

# Check sync status
bun run vctx -- status

# Start the background daemon (syncs on the configured interval)
bun run vctx -- daemon start
bun run vctx -- daemon status
bun run vctx -- daemon stop
```

### Running the web UI

```bash
# Dev mode: API on :3000, hot-reload UI on :5173
bun run dev

# Production: build UI then serve everything on :3000
bun run serve

# MCP server only (for AI assistants, no web UI)
bun run vctx -- serve --mcp-only
```

> **Optional: install `vctx` globally** to drop the `bun run vctx --` prefix:
> ```bash
> cd packages/cli && bun link && cd ../..
> vctx sync   # works from anywhere
> ```

## CLI Commands

| Command | Description |
|---------|-------------|
| `bun run vctx -- init` | Initialize `~/.veecontext/` directory and config |
| `bun run vctx -- add <type>` | Add a new collection (github, obsidian, git) |
| `bun run vctx -- sync` | Sync all enabled collections (or `--collection <name>`) |
| `bun run vctx -- status` | Show sync status for all collections |
| `bun run vctx -- search <query>` | Full-text search across all collections |
| `bun run vctx -- collections list\|remove\|enable\|disable` | Manage collections |
| `bun run vctx -- config get\|set\|list` | View/edit configuration |
| `bun run vctx -- serve` | Start API server + MCP server |
| `bun run vctx -- daemon start\|stop\|status` | Background sync daemon |

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

Exposes 5 tools and 4 resources for AI assistants:

**Tools:** `collection_list`, `entity_search`, `entity_get_data`, `entity_get_markdown`, `entity_get_attachment`

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
