# @vboctor/fink

**Frozen Ink CLI** — crawl, sync, search, and publish local data replicas from GitHub, Obsidian, Git repos, and MantisHub.

Frozen Ink creates a unified, queryable, markdown-native workspace from your data sources. It stores everything in local SQLite with full-text search, renders Obsidian-compatible markdown, and optionally publishes to Cloudflare as a password-protected website with MCP access for AI tools.

## Install

### npm (recommended)

```bash
npm install -g @vboctor/fink
```

Requires Node.js >= 20.

## Quick Start

```bash
# Help
fink --help

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

## Publishing to Cloudflare

Here are the steps to publish to Cloudflare:

```bash
# Authenticate with Cloudflare first
npx wrangler login

# Publish a collection (worker name = collection name)
# password is optional.
fink publish my-repo --password secret123

# Update an existing deployment
fink publish my-repo

# Remove
fink unpublish my-repo
```

Published collections include:

- Web UI for browsing synced data
- Full-text search
- MCP endpoint for AI assistants at `https://my-collection.my-account.workers.dev/mcp`

## MCP Server

Frozen Ink includes an MCP server for AI tools (Claude, Codex CLI, etc.):

```bash
# Link a local collection to Claude Code (stdio transport)
fink mcp add --tool claude-code my-vault

# Link multiple collections at once
fink mcp add --tool claude-code my-repo my-notes

# Link a published collection via its remote HTTP endpoint
fink mcp add --tool claude-code my-vault --http

# Link to Claude Desktop
fink mcp add --tool claude-desktop my-vault

# Link to Codex CLI (legacy alias: codex)
fink mcp add --tool codex-cli my-vault

# List link status
fink mcp list --tool claude-code

# Remove a single collection link
fink mcp remove --tool claude-code my-repo

# MCP stdio command used by clients
fink mcp serve --collection my-notes
```

Behavior notes:

- MCP clients launch `fink mcp serve` on demand; you do not run a background MCP server.
- One MCP connection is created per `(tool, collection)`:
  - Add `my-repo` then `my-notes` => 2 connections
  - Add `my-repo my-notes` together => also 2 connections
- `--http` links the remote HTTP endpoint of a published collection instead of local stdio. The password defaults to the one stored in `credentials.yml` during `fink publish`.
- `--tool codex-cli` is the canonical Codex option; `--tool codex` remains a legacy alias.
- ChatGPT Desktop uses a remote MCP endpoint flow. `fink mcp add --tool chatgpt-desktop` returns setup guidance instead of writing local client config.

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
  frozenink.yml              # app configuration
  collections/
    <name>/
      <name>.yml             # collection config (crawler, credentials, publish state)
      db/data.db             # SQLite database (entities, sync state, FTS5)
      content/               # rendered markdown files
      attachments/           # binary files (images, etc.)
```

## Publishing to npm

See [PUBLISH.md](PUBLISH.md) for the full build, version management, and publish process.

## License

MIT
