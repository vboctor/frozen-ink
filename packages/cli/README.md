# @vboctor/fink

**Frozen Ink CLI** — crawl, sync, search, and publish local data replicas from GitHub, Obsidian, Git repos, and MantisBT.

Frozen Ink creates a unified, queryable, markdown-native workspace from your data sources. It stores everything in local SQLite with full-text search, renders Obsidian-compatible markdown, and optionally publishes to Cloudflare as a password-protected website with MCP access for AI tools.

## Install

### npm (recommended)

```bash
npm install -g @vboctor/fink
```

Requires Node.js >= 20 and a C++ toolchain for the SQLite native module (`better-sqlite3`).

### Standalone binary (no dependencies)

Download the pre-built binary for your platform from the [releases page](https://github.com/vboctor/fink/releases):

| Platform | Binary |
|----------|--------|
| macOS Apple Silicon | `fink-darwin-arm64` |
| macOS Intel | `fink-darwin-x64` |
| Linux x64 | `fink-linux-x64` |
| Linux ARM64 | `fink-linux-arm64` |

```bash
# Example: macOS Apple Silicon
curl -L -o fink https://github.com/vboctor/fink/releases/latest/download/fink-darwin-arm64
chmod +x fink
sudo mv fink /usr/local/bin/
```

### From source (development)

```bash
git clone https://github.com/vboctor/fink.git
cd fink
bun install
cd packages/cli && bun link    # makes `fink` available globally
```

## Quick Start

```bash
# Initialize (creates ~/.frozenink/)
fink init

# Add a GitHub repository
fink add github --name my-repo --token ghp_xxx --repo owner/repo

# Add a local Obsidian vault
fink add obsidian --name my-notes --path ~/Documents/MyVault

# Add a local Git repo
fink add git --name my-code --path ~/projects/my-project

# Sync everything
fink sync "*"

# Check status
fink status

# Search across all collections
fink search "authentication bug"
```

## Interactive TUI

Running `fink` without arguments launches the interactive TUI:

```bash
fink
```

The TUI provides keyboard-driven access to all features:

| Key | Screen |
|-----|--------|
| `d` | Dashboard (overview) |
| `c` | Collections (manage) |
| `a` | Add collection |
| `s` | Sync |
| `p` | Publish to Cloudflare |
| `e` | Export |
| `f` | Search |
| `v` | Deployments |
| `g` | Settings |
| `ESC` | Go back |
| `q` | Quit |

## Commands

All commands are also available in headless mode for scripting and CI:

| Command | Description |
|---------|-------------|
| `fink` | Launch interactive TUI |
| `fink init` | Initialize `~/.frozenink/` |
| `fink add <type>` | Add a collection (github, obsidian, git, mantisbt) |
| `fink sync <name\|"*">` | Sync one or all collections |
| `fink sync <name> --full` | Full re-sync from scratch |
| `fink status` | Show sync status |
| `fink search <query>` | Full-text search |
| `fink collections list` | List all collections |
| `fink collections remove <name>` | Delete a collection |
| `fink collections enable <name>` | Enable a collection |
| `fink collections disable <name>` | Disable a collection |
| `fink collections rename <old> <new>` | Rename a collection |
| `fink update <name>` | Update collection config |
| `fink config list` | Show configuration |
| `fink config get <key>` | Get a config value |
| `fink config set <key> <value>` | Set a config value |
| `fink generate <name\|"*">` | Re-render markdown from DB |
| `fink index <name\|"*">` | Rebuild search index |
| `fink serve` | Start API server + web UI |
| `fink serve --mcp-only` | Start MCP server only |
| `fink mcp add --tool <tool> <collection...>` | Register collection-scoped MCP links in a client tool |
| `fink mcp remove --tool <tool> <collection...>` | Remove collection-scoped MCP links from a client tool |
| `fink mcp list [--tool <tool>]` | Show MCP link status by collection |
| `fink mcp serve --collection <name>` | MCP stdio entrypoint used by client tools |
| `fink daemon start\|stop\|status` | Background sync daemon |
| `fink publish <collections...>` | Publish to Cloudflare |
| `fink unpublish <name>` | Remove a deployment |
| `fink tui` | Launch TUI explicitly |

## Publishing to Cloudflare

Publish collections as a password-protected website with remote MCP access:

```bash
# Authenticate with Cloudflare first
npx wrangler login

# Publish
fink publish my-repo my-notes --password secret123 --name my-site

# Update an existing deployment
fink publish my-repo my-notes --password secret123 --name my-site

# Remove
fink unpublish my-site
```

Published sites include:

- Web UI for browsing synced data
- Full-text search
- MCP endpoint for AI assistants at `https://my-site.workers.dev/mcp`

## MCP Server

Frozen Ink includes an MCP server for AI tools (Claude, etc.):

```bash
# Link one or more collections to Claude Code
fink mcp add --tool claude-code my-repo
fink mcp add --tool claude-code my-notes

# Or add both in one command
fink mcp add --tool claude-code my-repo my-notes

# List link status
fink mcp list --tool claude-code

# Remove a single collection link
fink mcp remove --tool claude-code my-repo

# MCP stdio command used by clients
fink mcp serve --collection my-notes

# Or use the published MCP endpoint
claude mcp add frozenink --transport streamable-http \
  --url https://my-site.workers.dev/mcp \
  --header "Authorization: Bearer <password>"
```

Behavior notes:

- Installed-user flow uses `fink mcp serve --collection <name>` and does not require Bun.
- MCP clients launch the stdio command on demand; you do not run a background MCP server manually.
- One MCP connection is created per `(tool, collection)`:
  - Add `my-repo` then `my-notes` => 2 connections
  - Add `my-repo my-notes` together => also 2 connections
- Codex tool support is best-effort and shown only when `codex mcp` commands are detected.

TUI path: open `fink` -> `Collections` -> select a collection -> press `[m]` for MCP actions.

**Tools:** `collection_list`, `entity_search`, `entity_get_data`, `entity_get_markdown`, `entity_get_attachment`

## Configuration

Configuration is stored in `~/.frozenink/config.json`:

```bash
fink config set sync.interval 1800    # sync every 30 minutes
fink config set sync.concurrency 2    # parallel sync workers
fink config set sync.retries 5        # retry count
fink config set logging.level debug   # log level
```

## Data Storage

All data is stored locally in `~/.frozenink/`:

```text
~/.frozenink/
  config.json                # app configuration
  context.yml                # collection registry + deployment metadata
  collections/
    <name>/
      data.db                # SQLite database (entities, sync state, FTS5)
      markdown/              # rendered markdown files
      attachments/           # binary files (images, etc.)
```

## License

MIT
