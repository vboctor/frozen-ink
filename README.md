# VeeContext

VeeContext is a developer tool that aggregates context from multiple sources (GitHub, Linear, Slack, etc.) and serves it through a Model Context Protocol (MCP) server, giving AI coding assistants rich project awareness.

## Architecture

The project is organized as a Bun monorepo with five packages:

- **@veecontext/core** - Shared types, Zod schemas, database layer (Drizzle ORM + SQLite), and domain logic
- **@veecontext/connectors** - Data source connectors that sync external services into the local database
- **@veecontext/mcp** - MCP server that exposes aggregated context to AI assistants
- **@veecontext/cli** - Command-line interface for configuration, syncing, and daemon management
- **@veecontext/ui** - Terminal UI dashboard for monitoring sync status and browsing context

## Getting Started

```bash
# Install dependencies
bun install

# Type-check all packages
bun run typecheck
```

## Project Structure

```
packages/
  core/          Shared types, schemas, DB
  connectors/    GitHub, Linear, Slack connectors
  mcp/           MCP server
  cli/           CLI entry point
  ui/            Terminal dashboard
docs/
  architecture.md
  connectors.md
  themes.md
```
