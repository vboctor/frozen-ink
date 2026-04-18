import { renderDocsPage } from "./layout";

export const gettingStartedPage = renderDocsPage({
  title: "Getting Started",
  description:
    "Install Frozen Ink, add your first collection, and start browsing your knowledge base in minutes.",
  activePath: "/docs",
  canonicalPath: "/docs",
  section: "Overview",
  tocLinks: [
    { id: "prerequisites", title: "Prerequisites" },
    { id: "install", title: "Installation" },
    { id: "initialize", title: "Initialize Frozen Ink" },
    { id: "first-collection", title: "Add your first collection" },
    { id: "sync", title: "Sync & browse" },
    { id: "next-steps", title: "Next steps" },
  ],
  content: `
  <div class="docs-breadcrumb">
    <a href="/docs">Docs</a>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
    <span>Getting Started</span>
  </div>

  <h1 class="page-title">Getting Started</h1>
  <p class="page-lead">Get Frozen Ink installed and working in under five minutes. You'll add a collection, sync it, and start browsing your knowledge base from the web UI or an AI assistant.</p>

  <h2 id="prerequisites">Prerequisites</h2>
  <ul>
    <li><strong>Node.js 20+</strong> — required for the CLI</li>
  </ul>
  <p>A Cloudflare account is only needed if you want to <a href="/docs/publishing">publish collections to the web</a>.</p>

  <h2 id="install">Installation</h2>
  <p>Install the <code>@vboctor/fink</code> CLI globally with npm or any compatible package manager:</p>
  <pre><code>npm install -g @vboctor/fink</code></pre>
  <p>Verify the install:</p>
  <pre><code>fink --version</code></pre>

  <h2 id="initialize">Initialize Frozen Ink</h2>
  <p>Run <code>fink init</code> once to create the <code>~/.frozenink/</code> directory and its default configuration:</p>
  <pre><code>fink init</code></pre>
  <p>This creates:</p>
  <ul>
    <li><code>~/.frozenink/frozenink.yml</code> — app-level configuration (sync interval, UI port)</li>
    <li><code>~/.frozenink/collections/</code> — one subdirectory per collection, each containing its config, SQLite database, rendered markdown, and attachments</li>
  </ul>

  <h2 id="first-collection">Add your first collection</h2>
  <p>A <em>collection</em> is a group of synced content from a single source. Frozen Ink supports <a href="/docs/connectors/github">GitHub</a>, <a href="/docs/connectors/obsidian">Obsidian</a>, <a href="/docs/connectors/git">Git</a>, and <a href="/docs/connectors/mantishub">MantisHub</a> connectors. Here's an example using a local Obsidian vault:</p>

  <pre><code>fink add obsidian --name my-vault --path ~/Documents/MyVault</code></pre>

  <p>See the <a href="/docs/connectors/github">connector docs</a> for setup instructions for each source type.</p>

  <h2 id="sync">Sync &amp; browse</h2>

  <h3>Sync your collection</h3>
  <p>Sync the latest data from your source into the local index:</p>
  <pre><code><span class="cmt"># Sync one collection by name</span>
fink sync my-vault

<span class="cmt"># Sync every collection at once</span>
fink sync "*"</code></pre>
  <p>After syncing, you can check status:</p>
  <pre><code>fink status</code></pre>

  <h3>Start the web UI</h3>
  <p>Launch the local API and web UI server:</p>
  <pre><code>fink serve</code></pre>
  <p>Open <a href="http://localhost:3000">http://localhost:3000</a> in your browser. You'll see your collection in the left sidebar. Click any file to read it as rendered markdown.</p>

  <div class="callout callout-tip">
    <div class="callout-icon">✨</div>
    <div class="callout-body">
      <strong>Try the interactive TUI</strong>
      <p>Run <code>fink</code> with no arguments to launch the keyboard-driven terminal UI. It gives you access to collections, sync, search, publish, and settings — all without leaving the terminal.</p>
    </div>
  </div>

  <h3>Search</h3>
  <p>Use <kbd>Cmd+P</kbd> or <kbd>Cmd+K</kbd> in the web UI to open the quick switcher and search across all your collections at once. Or search from the terminal:</p>
  <pre><code>fink search "authentication flow"</code></pre>

  <div class="callout callout-info">
    <div class="callout-icon">ℹ️</div>
    <div class="callout-body">
      <strong>Alternative: clone a published collection</strong>
      <p>If someone has already published a Frozen Ink collection, you can skip <code>fink add</code> and <code>fink sync</code> entirely. Just clone it directly: <code>fink clone https://their-site.workers.dev --password secret</code>. See <a href="/docs/clone-pull">Clone &amp; Pull</a> for details.</p>
    </div>
  </div>

  <h2 id="next-steps">Next steps</h2>

  <div class="feature-grid">
    <a href="/docs/collections" class="feature-card" style="text-decoration:none;">
      <div class="feature-card-icon">📂</div>
      <h4>Manage Collections</h4>
      <p>Learn how to update, disable, rename, and remove collections.</p>
    </a>
    <a href="/docs/integrations/local-mcp" class="feature-card" style="text-decoration:none;">
      <div class="feature-card-icon">🤖</div>
      <h4>Connect MCP Clients</h4>
      <p>Link collections to Claude Code, Codex CLI, or other local MCP clients, and set up ChatGPT Desktop via published MCP endpoints.</p>
    </a>
    <a href="/docs/publishing" class="feature-card" style="text-decoration:none;">
      <div class="feature-card-icon">🌐</div>
      <h4>Publish to the Web</h4>
      <p>Deploy a password-protected site to Cloudflare in one command — readable by teammates and cloud AI agents.</p>
    </a>
  </div>

  <div class="docs-pagination">
    <a href="/docs/key-scenarios" class="docs-pagination-card">
      <span class="docs-pagination-label">← Previous</span>
      <span class="docs-pagination-title">Key Scenarios</span>
    </a>
    <a href="/docs/collections" class="docs-pagination-card next">
      <span class="docs-pagination-label">Next →</span>
      <span class="docs-pagination-title">Managing Collections</span>
    </a>
  </div>
  `,
});
