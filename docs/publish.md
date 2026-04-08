# Publishing Collections to Cloudflare

Frozen Ink can publish one or more collections as a read-only, password-protected website on Cloudflare Workers with remote MCP access.

Sync and collection management remain local. Publishing uploads a snapshot. To update, re-sync locally then re-run `fink publish`.

## Prerequisites

- A Cloudflare account (free tier works)
- **wrangler** CLI authenticated — either run `wrangler login` (interactive OAuth) or set the `CLOUDFLARE_API_TOKEN` environment variable

## Authentication

Frozen Ink uses the `wrangler` CLI for all Cloudflare operations. Authenticate with one of:

```bash
# Option 1: Interactive OAuth login (recommended)
wrangler login

# Option 2: API token via environment variable
export CLOUDFLARE_API_TOKEN=your-token-here
```

To verify authentication:
```bash
wrangler whoami
```

## Publishing

```bash
# Build the UI and worker first
bun run build:ui
cd packages/worker && bun run build && cd ../..

# Publish one or more collections
fink publish my-github my-notes --password secret123 --name my-pub
```

Options:
- `--password <password>` — Password to protect all access (recommended)
- `--name <name>` — Worker name (default: `fink-<first-collection>-<random>`)

## Updating a Published Deployment

Re-sync your local data, then publish again with the same `--name`:

```bash
fink sync "*"
fink publish my-github my-notes --password secret123 --name my-pub
```

This replaces the D1 database contents, uploads new R2 files, and removes stale files that no longer exist locally.

## Accessing the Web UI

Visit the URL printed after publishing (e.g., `https://my-pub.yoursubdomain.workers.dev`). If password-protected, you'll see a login page. After signing in, a 30-day cookie keeps you authenticated.

A logout button appears at the bottom of the sidebar.

## MCP Setup

### Claude Code

```bash
claude mcp add frozenink --transport streamable-http \
  --url https://my-pub.yoursubdomain.workers.dev/mcp \
  --header "Authorization: Bearer <password>"
```

### Claude Desktop

Add to your MCP config:

```json
{
  "mcpServers": {
    "frozenink": {
      "url": "https://my-pub.yoursubdomain.workers.dev/mcp",
      "transport": "streamable-http",
      "headers": {
        "Authorization": "Bearer <password>"
      }
    }
  }
}
```

### Available MCP Tools

- `collection_list` — List published collections with entity counts
- `entity_search` — Full-text search across all published entities
- `entity_get_data` — Get full entity data + markdown by collection and external ID
- `entity_get_markdown` — Get rendered markdown for an entity
- `entity_get_attachment` — Get base64-encoded attachment content

## Unpublishing

```bash
fink unpublish my-pub
```

This deletes the Cloudflare Worker, D1 database, and R2 bucket. Use `--force` to skip confirmation.

Options:
- `--force` — Skip confirmation prompt

## Cloudflare API Token Setup

If you prefer an API token over `wrangler login`:

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com) > My Profile > API Tokens
2. Click **Create Token**
3. Use **Custom Token** with these permissions:
   - Account > Workers Scripts > Edit
   - Account > D1 > Edit
   - Account > Workers R2 Storage > Edit
4. Copy the token and set it as `CLOUDFLARE_API_TOKEN`

## How It Works

Publishing uses `wrangler` CLI to create three Cloudflare resources:

1. **D1 Database** (`{name}-db`) — Stores entity data, tags, links, FTS5 search index, and an R2 manifest for tracking uploaded files
2. **R2 Bucket** (`{name}-files`) — Stores markdown files, attachments, and the static UI (organized by `{collection}/markdown/...`, `{collection}/attachments/...`, `_ui/...`)
3. **Worker** (`{name}`) — Serves the web UI, REST API, and MCP endpoint with D1 + R2 bindings

All data is exported to a single SQL file and uploaded via `wrangler d1 execute --file`. Files are uploaded individually via `wrangler r2 object put`.

All data access requires authentication (password via Bearer token or cookie).

## Limitations

- **Read-only snapshot** — changes require re-publish from local
- **Cloudflare free tier limits** apply (D1: 5M rows read/day, R2: 10M class A operations/month, Workers: 100K requests/day)
- FTS5 search quality matches local (D1 supports FTS5 natively)
