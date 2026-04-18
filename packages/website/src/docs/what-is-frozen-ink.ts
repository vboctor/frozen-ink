import { renderDocsPage } from "./layout";

export const whatIsFrozenInkPage = renderDocsPage({
  title: "What is Frozen Ink",
  description:
    "Understand the core concepts behind Frozen Ink: local-first knowledge, collections, MCP access, and publishing.",
  activePath: "/docs/what-is-frozen-ink",
  canonicalPath: "/docs/what-is-frozen-ink",
  section: "Overview",
  tocLinks: [
    { id: "the-problem", title: "The problem" },
    { id: "the-solution", title: "The solution" },
    { id: "core-concepts", title: "Core concepts" },
    { id: "collections", title: "Collections", indent: true },
    { id: "entities", title: "Entities", indent: true },
    { id: "local-index", title: "Local index", indent: true },
    { id: "mcp-server", title: "MCP server", indent: true },
    { id: "publishing", title: "Publishing", indent: true },
    { id: "themes", title: "Themes", indent: true },
    { id: "architecture", title: "Architecture" },
    { id: "design-principles", title: "Design principles" },
  ],
  content: `
  <div class="docs-breadcrumb">
    <a href="/docs">Docs</a>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
    <span>What is Frozen Ink?</span>
  </div>

  <h1 class="page-title">What is Frozen Ink?</h1>
  <p class="page-lead">Frozen Ink is a local-first knowledge layer for technical work. It crawls data from the services you already use, stores it in a unified local index, and makes everything queryable by humans and AI assistants.</p>

  <h2 id="the-problem">The problem</h2>
  <p>Technical knowledge is scattered across services: GitHub has your issues and pull requests, Obsidian has your notes, Git repositories contain your commit history, and project management tools have your bug tracker. This fragmentation creates five concrete problems:</p>
  <ul>
    <li><strong>No offline access.</strong> If you're on a plane, you can't read your own issues. Your knowledge is only available when the service is.</li>
    <li><strong>Inconsistent search.</strong> Every tool has its own search, so you can never find what you're looking for in one place. From scattered sources to a single query should take seconds, not minutes of tab-switching.</li>
    <li><strong>AI context limits.</strong> Cloud AI assistants can't access your private GitHub repos or local Obsidian vault without complex integrations. You end up re-explaining yourself to every AI tool.</li>
    <li><strong>Tool bloat for AI.</strong> Connecting each data source to each AI tool individually means duplicate configs, redundant context, and wasted tokens. You need one shared knowledge layer, not N separate integrations.</li>
    <li><strong>Limiting AI to read-only access.</strong> In many scenarios you want to grant AI access to the information or a subset of the information without ability to take other actions. Not all services enable fine grained scoping.</li>
    <li><strong>Loss on service shutdown.</strong> If a SaaS tool shuts down or you cancel a subscription, your data disappears with it. You should be able to capture and own your data before you walk away.</li>
  </ul>

  <h2 id="the-solution">The solution</h2>
  <p>Frozen Ink solves these problems with a simple architecture: crawl your data sources into a local SQLite database, enable free text search on top of such information, render everything as markdown on disk, and expose that knowledge through multiple access channels — markdown files on disk, a web UI, a terminal UI, an MCP server for AI tools, and a published collections.</p>
  <p>The key insight is that <strong>once your data is local and markdown-native, it works everywhere</strong> — offline, in any editor, in AI assistants, and on the web. One unified index feeds every tool you use, so your models always have the full context without you re-explaining anything.</p>
  <p>Published collections can be <strong>cloned</strong> by teammates to their own machines, creating fully independent local copies that stay in sync with incremental pulls — no source credentials required. Your secrets don't leave your device unless you explicitly choose to share them.</p>

  <div class="callout callout-info">
    <div class="callout-icon">🧊</div>
    <div class="callout-body">
      <strong>Why "Frozen Ink"?</strong>
      <p>The name reflects the product's purpose: taking ephemeral online knowledge and preserving it as a durable, readable local artifact — like ink frozen on a page. You are in control of your data, when to trigger syncs and it remains accessible even when the original service is not.</p>
    </div>
  </div>

  <h2 id="core-concepts">Core concepts</h2>

  <h3 id="collections">Collections</h3>
  <p>A <strong>collection</strong> is a named, configured connection to one data source. Each collection has a type (github, obsidian, git, mantishub), a name you choose, and type-specific configuration (like a repository name, a vault path, or an API token).</p>
  <p>Each collection is stored as a directory under <code>~/.frozenink/collections/&lt;name&gt;/</code>, containing its config file, SQLite database, rendered markdown, and attachments. Collections are isolated — syncing or removing one has no effect on the others.</p>
  <p>Collections are the main unit of organization in Frozen Ink. You can have as many as you want, and they can be synced, served, or published independently.</p>
  <p>Your AI harness can be given access to the collections folder to get access to all collections or a a specific collection folder to get access to just the single collection.</p>

  <h3 id="entities">Entities</h3>
  <p>An <strong>entity</strong> is an individual record within a collection — a GitHub issue, an Obsidian note, a Git commit, a MantisHub bug, and so on. Each entity has:</p>
  <ul>
    <li><strong>External ID</strong> — the identifier in the source system (e.g., issue number, note filename)</li>
    <li><strong>Structured data</strong> — the raw fields as stored in the source (title, body, author, timestamps, labels, etc.)</li>
    <li><strong>Attachments</strong> — files associated with the entity (images, PDFs, etc.) stored in the collection's assets folder.</li>
    <li><strong>Rendered markdown</strong> — a clean, human-readable markdown representation generated by the crawler and persisted on disk for each access.</li>
    <li><strong>Rendered HTML</strong> — the rendered HTML for the markdown, used in the web UI. The HTML rendering is never persisted.</li>
    <li><strong>Full-text index entry</strong> — enables fast search across all content</li>
  </ul>

  <h3 id="local-index">Local index</h3>
  <p>Frozen Ink stores everything in a <strong>local SQLite database</strong> using WAL mode for performance and FTS5 for full-text search. This means:</p>
  <ul>
    <li><strong>All queries are local</strong> — no network calls needed after the initial sync</li>
    <li><strong>Full-text search</strong> — works across thousands of documents in milliseconds</li>
    <li><strong>Links and Backlinks</strong> — notes that link to each other are indexed automatically</li>
  </ul>
  <p>The index is rebuilt incrementally on each sync — only changed entities are processed. You can also force a rebuild with <code>fink index "*"</code>.</p>

  <h3 id="mcp-server">MCP server</h3>
  <p>The <strong>Model Context Protocol (MCP)</strong> server lets AI assistants like Claude query your Frozen Ink collections. When you link a collection with <code>fink mcp add</code>, Claude (or any MCP-compatible harness) gets access to these tools:</p>

  <table>
    <thead>
      <tr><th>MCP Tool</th><th>Description</th></tr>
    </thead>
    <tbody>
      <tr><td><code>collection_list</code></td><td>List all available collections with metadata</td></tr>
      <tr><td><code>entity_search</code></td><td>Full-text search for entities across one or all collections</td></tr>
      <tr><td><code>entity_get_data</code></td><td>Get the structured data for a specific entity</td></tr>
      <tr><td><code>entity_get_markdown</code></td><td>Get the rendered markdown for an entity</td></tr>
      <tr><td><code>entity_get_attachment</code></td><td>Retrieve a file attachment (images, PDFs, etc.)</td></tr>
    </tbody>
  </table>

  <h3 id="publishing">Publishing</h3>
  <p>Collections can be <strong>published to Cloudflare</strong> website and optionallys secured with a password. Published deployments use Cloudflare Workers + D1 (managed SQLite) + R2 (object storage) to serve the same web UI and MCP server to anyone with the password — from a browser or from a cloud AI agent.</p>
  <p>Publishing is a one-command operation: your data is uploaded to Cloudflare's edge, and you get a URL you can share with teammates or configure in AI tools.</p>

  <h3 id="themes">Themes</h3>
  <p>The web UI ships with <strong>six display themes</strong> that change the colour palette and visual style of the reading experience. Switch between them from the bottom of the sidebar:</p>
  <ul>
    <li><strong>Default Light</strong> — clean, high-contrast light theme</li>
    <li><strong>Minimal Light</strong> — reduced chrome, more whitespace</li>
    <li><strong>Solarized Light</strong> — warm tones based on the Solarized palette</li>
    <li><strong>Nord Dark</strong> — cool blues and greys from the Nord palette</li>
    <li><strong>Catppuccin Dark</strong> — soft, pastel dark theme</li>
    <li><strong>Dracula Dark</strong> — vivid dark theme with high contrast accents</li>
  </ul>
  <p>Theme preference is saved automatically and restored on next visit — locally and in published deployments.</p>

  <h2 id="design-principles">Design principles</h2>

  <div class="feature-grid">
    <div class="feature-card">
      <div class="feature-card-icon">🏠</div>
      <h4>Local-first</h4>
      <p>Your data lives on your machine. After the initial sync, everything works offline. No mandatory cloud dependency.</p>
    </div>
    <div class="feature-card">
      <div class="feature-card-icon">📝</div>
      <h4>Markdown-native</h4>
      <p>All content is rendered as standard markdown. It's readable in any editor, and AI models can consume it without special adapters.</p>
    </div>
    <div class="feature-card">
      <div class="feature-card-icon">🤖</div>
      <h4>AI-accessible by default</h4>
      <p>The MCP server is not an add-on — it's built in from day one. Every collection is immediately queryable by AI assistants.</p>
    </div>
    <div class="feature-card">
      <div class="feature-card-icon">🧩</div>
      <h4>Source-agnostic</h4>
      <p>Add new crawlers without changing the core. GitHub, Obsidian, Git, and MantisHub are the first four — more will follow.</p>
    </div>
  </div>

  <div class="docs-pagination">
    <a href="/docs" class="docs-pagination-card">
      <span class="docs-pagination-label">← Previous</span>
      <span class="docs-pagination-title">Getting Started</span>
    </a>
    <a href="/docs/key-scenarios" class="docs-pagination-card next">
      <span class="docs-pagination-label">Next →</span>
      <span class="docs-pagination-title">Key Scenarios</span>
    </a>
  </div>
  `,
});
