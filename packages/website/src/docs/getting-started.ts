import { renderDocsPage } from "./layout";

export const gettingStartedPage = renderDocsPage({
  title: "Getting Started",
  description:
    "Install Frozen Ink, add your first collection, and start browsing your knowledge base in minutes.",
  activePath: "/docs",
  canonicalPath: "/docs",
  section: "Getting Started",
  tocLinks: [
    { id: "prerequisites", title: "Prerequisites" },
    { id: "install", title: "Installation" },
    { id: "install-npm", title: "From npm (recommended)", indent: true },
    { id: "install-binary", title: "Standalone binary", indent: true },
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
  <p>Frozen Ink requires one of the following:</p>
  <ul>
    <li><strong>Node.js 20+</strong> — for the npm-installed CLI</li>
    <li><strong>No runtime</strong> — if you download the standalone binary</li>
  </ul>
  <p>A Cloudflare account is only needed if you want to <a href="/docs/publishing">publish collections to the web</a>.</p>

  <h2 id="install">Installation</h2>

  <h3 id="install-npm">From npm (recommended)</h3>
  <p>Install the <code>@vboctor/fink</code> CLI globally with npm or any compatible package manager:</p>
  <pre><code>npm install -g @vboctor/fink</code></pre>
  <p>Verify the install:</p>
  <pre><code>fink --version</code></pre>

  <h3 id="install-binary">Standalone binary (no Node.js required)</h3>
  <p>Pre-built binaries are available for macOS and Linux — no Node.js installation needed. Download the binary for your platform from the <a href="/#download">download page</a> and install it:</p>
  <pre><code>chmod +x fink && sudo mv fink /usr/local/bin/
fink --version</code></pre>

  <div class="callout callout-tip">
    <div class="callout-icon">💡</div>
    <div class="callout-body">
      <strong>macOS desktop app</strong>
      <p>If you prefer a GUI, download the macOS desktop app from the <a href="/#download">download page</a>. It includes the full Frozen Ink UI, collection management, sync, and publish — no terminal required.</p>
    </div>
  </div>

  <h2 id="initialize">Initialize Frozen Ink</h2>
  <p>Run <code>fink init</code> once to create the <code>~/.frozenink/</code> directory and its default configuration:</p>
  <pre><code>fink init</code></pre>
  <p>This creates:</p>
  <ul>
    <li><code>~/.frozenink/frozenink.yml</code> — app-level configuration (sync interval, UI port)</li>
    <li><code>~/.frozenink/collections/</code> — one subdirectory per collection, each containing its config, SQLite database, rendered markdown, and attachments</li>
    <li><code>~/.frozenink/sites/</code> — metadata for published Cloudflare deployments</li>
  </ul>

  <h2 id="first-collection">Add your first collection</h2>
  <p>A <em>collection</em> is a group of synced content from a single source. Frozen Ink supports four source types. Pick the one you have available:</p>

  <h3>Obsidian vault</h3>
  <p>Syncs all markdown notes and attachments from a local Obsidian vault:</p>
  <pre><code>fink add obsidian --name my-vault --path ~/Documents/MyVault</code></pre>

  <h3>Git repository</h3>
  <p>Syncs commits, branches, and tags from a local Git repository:</p>
  <pre><code>fink add git --name my-repo --path ~/projects/my-project

<span class="cmt"># Include full commit diffs in rendered markdown:</span>
fink add git --name my-repo --path ~/projects/my-project <span class="flag">--include-diffs</span></code></pre>

  <h3>GitHub repository</h3>
  <p>Syncs issues and pull requests via the GitHub REST API. You'll need a personal access token with repo read permissions:</p>
  <pre><code>fink add github <span class="flag">--name</span> my-issues \
  <span class="flag">--token</span> ghp_yourPersonalAccessToken \
  <span class="flag">--owner</span> your-username \
  <span class="flag">--repo</span> your-repo-name</code></pre>

  <h3>MantisHub</h3>
  <p>Syncs issues and attachments from a <a href="https://www.mantishub.com/" target="_blank">MantisHub</a> instance:</p>
  <pre><code>fink add mantishub <span class="flag">--name</span> my-bugs \
  <span class="flag">--url</span> https://your-mantis-instance.mantishub.io \
  <span class="flag">--token</span> your-api-token \
  <span class="flag">--project-id</span> 1</code></pre>

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
      <p>Learn how to update, disable, rename, and remove collections, and how to automate syncing with the daemon.</p>
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
    <a href="/docs/desktop-app" class="feature-card" style="text-decoration:none;">
      <div class="feature-card-icon">🖥️</div>
      <h4>Desktop App</h4>
      <p>Use the macOS desktop app for a GUI-first experience with workspaces, visual sync, publish, and export panels.</p>
    </a>
  </div>

  <div class="docs-pagination">
    <span></span>
    <a href="/docs/what-is-frozen-ink" class="docs-pagination-card next">
      <span class="docs-pagination-label">Next →</span>
      <span class="docs-pagination-title">What is Frozen Ink?</span>
    </a>
  </div>
  `,
});
