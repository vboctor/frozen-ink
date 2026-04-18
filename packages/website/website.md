# Website Guide

Reference for the Frozen Ink marketing website and documentation site in `packages/website/`.

## Architecture

The website is a **Cloudflare Worker** that serves two things:

1. **Marketing site** (`/`) — single-page HTML in `src/site.html`
2. **Documentation** (`/docs/*`) — TypeScript page modules in `src/docs/*.ts`, each exporting a rendered HTML string

The Worker entry point is `src/index.ts`, which routes requests to the correct page. Doc pages are rendered at build time via `renderDocsPage()` from `src/docs/layout.ts`.

## File Structure

```text
packages/website/src/
  index.ts              Worker entry: routing + redirects
  site.html             Marketing home page (single HTML file)
  og-image.png          Open Graph image served at /og.png
  docs/
    layout.ts           Shared layout: nav, sidebar, TOC, SEO meta, CSS
    getting-started.ts  /docs (the default docs landing page)
    what-is-frozen-ink.ts
    key-scenarios.ts
    managing-collections.ts   → served at /docs/collections
    clone-pull.ts
    publishing.ts
    connector-github.ts      → /docs/connectors/github
    connector-obsidian.ts    → /docs/connectors/obsidian
    connector-git.ts         → /docs/connectors/git
    connector-mantishub.ts   → /docs/connectors/mantishub
    local-mcp.ts             → /docs/integrations/local-mcp
    cloud-mcp.ts             → /docs/integrations/cloud-mcp
    claude-code.ts           → /docs/integrations/claude-code
    claude-cowork.ts         → /docs/integrations/claude-cowork
    claude-desktop.ts        → /docs/integrations/claude-desktop
    codex-cli.ts             → /docs/integrations/codex-cli
    chatgpt-desktop.ts       → /docs/integrations/chatgpt-desktop
    cli-reference.ts         → /docs/reference/cli
    configuration.ts         → /docs/reference/configuration
    desktop-app.ts           (hidden — not linked from nav, kept for future release)
    anythingllm-mcp.ts       (hidden — not linked from nav, kept for potential future use)
```

## Docs Navigation Order

The sidebar nav is defined in `NAV_SECTIONS` in `layout.ts`. The canonical page order is:

1. **Overview**: What is Frozen Ink?, Key Scenarios
2. **Getting Started**: Getting Started
3. **Features**: Managing Collections, Clone & Pull, Publishing
4. **Connectors**: GitHub, Obsidian, Git, MantisHub
5. **AI Integrations**: Local MCP Setup, Cloud MCP Access, Claude Code, Claude Cowork, Claude Desktop, Codex CLI, ChatGPT Desktop
6. **Reference**: CLI Reference, Configuration

### Pagination links

Each doc page has prev/next pagination links at the bottom. These **must follow the sidebar order** — the sequence should match left-to-right reading of the nav sections, top to bottom. When adding, removing, or reordering pages, update the pagination links on the affected page and its neighbors.

## Adding a New Doc Page

1. Create `src/docs/my-page.ts` exporting `renderDocsPage({ ... })`
2. Import and add it to `DOC_PAGES` in `src/index.ts` with its URL path
3. Add it to `NAV_SECTIONS` in `layout.ts` in the correct section
4. Set `canonicalPath`, `section`, and optionally `ogTitle`/`ogDescription` for SEO
5. Add breadcrumbs matching the section hierarchy
6. Update pagination links on the new page and its prev/next neighbors

## URL Changes & Redirects

When a page URL changes, add a 301 redirect in `src/index.ts` under the `REDIRECTS` map. This prevents broken links from external sites and search engines.

## Conventions

- **No multi-space alignment** in CLI code examples — use single spaces between flags and values
- **workers.dev URLs**: use `my-vault` and `my-account` as placeholders (not `your-account`)
- **Question mark**: "What is Frozen Ink?" always has the question mark
- **Breadcrumbs** follow the section hierarchy: `Docs > Section > Page`
- **TOC links** (`tocLinks` array) must match the `id` attributes of `<h2>` and `<h3>` elements in the page content — audit after removing sections
- **SEO fields**: every page should have `canonicalPath` and `section`
- **Nav alignment**: the docs nav (`layout.ts`) and marketing nav (`site.html`) must use identical CSS values for brand, links, gaps, and social icons so they don't shift when navigating between pages
- **No daemon references** — the daemon feature is not documented; use `fink sync` instead
- **No desktop app references** — the desktop app docs exist but are hidden from nav; don't link to them from other pages
- **No standalone binary/download references** — only npm install is documented
- **Knowledge, not "technical knowledge"** — Frozen Ink is about knowledge and context broadly, not limited to technical use cases
- **Connector pages** should not repeat examples that appear in Getting Started — Getting Started uses a single example and links to connector pages for details
