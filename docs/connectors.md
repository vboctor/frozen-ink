# Connectors

## Overview

Connectors are the data ingestion layer of VeeContext. Each connector syncs data from an external service into the local SQLite database, normalizing it into a common schema.

## Connector Interface

Every connector implements a standard interface:

- **name** - Unique identifier (e.g., `github`, `linear`, `slack`)
- **authenticate** - Validate credentials and establish a connection
- **sync** - Fetch new/updated data since the last sync cursor
- **getStatus** - Report current sync state and health

## Planned Connectors

### GitHub

Syncs repositories, issues, pull requests, reviews, and comments. Uses the GitHub REST and GraphQL APIs. Supports both personal tokens and GitHub App authentication.

### Linear

Syncs issues, projects, cycles, and comments from Linear workspaces. Uses the Linear GraphQL API with webhook support for real-time updates.

### Slack

Syncs messages and threads from configured channels. Uses the Slack Web API with bot token authentication. Focuses on technical discussions relevant to project context.

## Incremental Sync

All connectors support incremental sync using cursors. Each sync operation:

1. Reads the last sync cursor from the database
2. Fetches only data modified since that cursor
3. Upserts records into the local database
4. Updates the sync cursor

This ensures efficient operation even with large data volumes.

## Configuration

Connectors are configured per-project in a `.veecontext/config.json` file. Each connector entry specifies authentication credentials (via environment variables) and connector-specific options like which repositories or channels to sync.
