# Architecture

## Overview

Frozen Ink follows a layered architecture where data flows from external sources through crawlers into a local SQLite database, and is then served to AI assistants via the Model Context Protocol.

```text
External Services (GitHub, Linear, Slack, ...)
        │
        ▼
  ┌─────────────┐
  │  Crawlers  │  Sync data from APIs into local DB
  └──────┬──────┘
         │
         ▼
  ┌─────────────┐
  │    Core      │  SQLite DB (Drizzle ORM), schemas (Zod), domain types
  └──────┬──────┘
         │
    ┌────┴────┐
    ▼         ▼
┌───────┐ ┌─────┐
│  MCP  │ │ CLI │  MCP server exposes context; CLI manages config & sync
└───────┘ └─────┘
              │
              ▼
          ┌──────┐
          │  UI  │  Terminal dashboard for monitoring
          └──────┘
```

## Packages

### @frozenink/core

The foundation package. Contains:

- **Database schema** - Drizzle ORM table definitions for SQLite
- **Zod schemas** - Runtime validation for crawler configs, sync results, and MCP payloads
- **Domain types** - TypeScript types derived from Zod schemas
- **Database utilities** - Connection management, migrations

### @frozenink/crawlers

Each crawler implements a common interface to:

1. Authenticate with an external service
2. Fetch data incrementally (using cursors/timestamps)
3. Transform data into normalized core types
4. Write results to the local database

### @frozenink/mcp

Implements a Model Context Protocol server that:

- Exposes tools for querying aggregated context
- Serves resources representing project state
- Runs as a stdio-based server for editor integration

### @frozenink/cli

Entry point for users. Provides commands for:

- `init` - Initialize a project configuration
- `sync` - Run crawlers to fetch latest data
- `serve` - Start the MCP server
- `daemon` - Background sync management
- `status` - View sync status

### @frozenink/ui

Terminal UI built for real-time monitoring of sync operations and browsing aggregated context.

## Data Flow

1. User configures crawlers via CLI or config file
2. CLI triggers sync (manual or daemon)
3. Crawlers fetch data from external APIs
4. Data is normalized and stored in SQLite via Drizzle ORM
5. MCP server reads from SQLite and serves context to AI assistants
