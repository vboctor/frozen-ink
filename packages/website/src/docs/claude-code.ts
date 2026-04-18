import { renderDocsPage } from "./layout";

export const claudeCodePage = renderDocsPage({
  title: "Claude Code Integration",
  description:
    "Connect Frozen Ink collections to Claude Code via local stdio MCP or a published cloud MCP endpoint, and browse your knowledge base from the built-in web UI.",
  activePath: "/docs/integrations/claude-code",
  canonicalPath: "/docs/integrations/claude-code",
  section: "AI Integrations",
  tocLinks: [
    { id: "overview", title: "Overview" },
    { id: "local-mcp", title: "Local MCP setup" },
    { id: "local-link-collections", title: "Link collections", indent: true },
    { id: "local-multiple", title: "Multiple collections", indent: true },
    { id: "cloud-mcp", title: "Cloud MCP access" },
    { id: "add-collection-folder", title: "Add a collection folder" },
    { id: "obsidian-vault", title: "Obsidian vault", indent: true },
    { id: "git-repo", title: "Git repository", indent: true },
    { id: "sync-and-serve", title: "Sync & serve" },
    { id: "browsing-in-claude", title: "Browsing in Claude Code" },
    { id: "collection-description", title: "Collection descriptions" },
    { id: "quick-reference", title: "Quick reference" },
    { id: "troubleshooting", title: "Troubleshooting" },
  ],
  content: `
  <div class="docs-breadcrumb">
    <a href="/docs">Docs</a>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
    <span>AI Integrations</span>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
    <span>Claude Code</span>
  </div>

  <h1 class="page-title">Claude Code Integration</h1>
  <p class="page-lead">Frozen Ink integrates with Claude Code via the Model Context Protocol. Link your collections locally so Claude can query them over stdio, or connect to a published cloud deployment over HTTP. Either way, Claude can search your notes, read documents, and access your knowledge base without copy-paste.</p>

  <h2 id="overview">Overview</h2>
  <div class="feature-grid">
    <div class="feature-card">
      <div class="feature-card-icon">🖥️</div>
      <h4>Local MCP</h4>
      <p>Claude Code spawns <code>fink mcp serve</code> over stdio — direct process communication with no HTTP overhead. Responses are instant, there are no rate limits, and your data never leaves the machine.</p>
    </div>
    <div class="feature-card">
      <div class="feature-card-icon">☁️</div>
      <h4>Cloud MCP</h4>
      <p>Connect Claude Code to a published Frozen Ink deployment over HTTP. Useful when you need the same knowledge base across multiple machines or want to share it with teammates.</p>
    </div>
    <div class="feature-card">
      <div class="feature-card-icon">📂</div>
      <h4>Web UI browser</h4>
      <p>Run <code>fink serve</code> to open a local web UI at <code>localhost:3000</code>. Browse, search, and read your collections side-by-side with Claude Code in any browser.</p>
    </div>
  </div>

  <h2 id="local-mcp">Local MCP setup</h2>
  <p>Local MCP uses a <strong>per-collection, stdio-based transport</strong>. When Claude calls a tool, Claude Code spawns <code>fink mcp serve --collection &lt;name&gt;</code> as a subprocess and communicates over stdio — direct process I/O with no network round-trip. Tool responses land in single-digit milliseconds, and since everything runs locally, there are no API rate limits or per-query costs to worry about.</p>

  <h3 id="local-link-collections">Link collections</h3>

  <div class="steps">
    <div class="step">
      <div class="step-num">1</div>
      <div class="step-body">
        <h4>Ensure the collection is synced</h4>
        <pre><code>fink sync my-vault
fink status</code></pre>
        <p>Claude queries the local SQLite database at tool-call time, so the collection needs data before linking.</p>
      </div>
    </div>
    <div class="step">
      <div class="step-num">2</div>
      <div class="step-body">
        <h4>Link to Claude Code</h4>
        <pre><code>fink mcp add <span class="flag">--tool</span> claude-code my-vault</code></pre>
        <p>This writes an entry to <code>~/.claude/mcp_servers.json</code> that tells Claude Code to call <code>fink mcp serve --collection my-vault</code> when the MCP server is needed.</p>
      </div>
    </div>
    <div class="step">
      <div class="step-num">3</div>
      <div class="step-body">
        <h4>Verify</h4>
        <pre><code>fink mcp list <span class="flag">--tool</span> claude-code</code></pre>
        <p>You should see <code>my-vault</code> listed with status <strong>linked</strong>.</p>
      </div>
    </div>
    <div class="step">
      <div class="step-num">4</div>
      <div class="step-body">
        <h4>Start a conversation</h4>
        <p>Open or restart Claude Code and start a new conversation. Claude now has access to your collection. Try: <em>"Search my knowledge base for anything about authentication"</em>.</p>
      </div>
    </div>
  </div>

  <div class="callout callout-info">
    <div class="callout-icon">ℹ️</div>
    <div class="callout-body">
      <strong>fink must be on your PATH</strong>
      <p>Claude Code spawns <code>fink mcp serve</code> as a subprocess. The <code>fink</code> binary must be on the system PATH — installing via npm (<code>npm install -g @vboctor/fink</code>) handles this automatically.</p>
    </div>
  </div>

  <h3 id="local-multiple">Multiple collections</h3>
  <p>Link multiple collections in one command or separately — the result is the same:</p>
  <pre><code><span class="cmt"># Link two collections at once</span>
fink mcp add <span class="flag">--tool</span> claude-code my-vault my-project-issues

<span class="cmt"># Or one at a time</span>
fink mcp add <span class="flag">--tool</span> claude-code my-vault
fink mcp add <span class="flag">--tool</span> claude-code my-project-issues</code></pre>

  <p>Each collection becomes a separate MCP connection. Claude sees them as distinct knowledge sources and can query them independently in the same conversation.</p>

  <pre><code><span class="cmt"># Remove a collection link</span>
fink mcp remove <span class="flag">--tool</span> claude-code my-vault

<span class="cmt"># List all current links</span>
fink mcp list <span class="flag">--tool</span> claude-code</code></pre>

  <h2 id="cloud-mcp">Cloud MCP access</h2>
  <p>If you've <a href="/docs/publishing">published a deployment to Cloudflare</a>, Claude Code can connect to it over HTTP. This is useful when you want the same knowledge base accessible from multiple machines, or when teammates need access without running Frozen Ink locally.</p>

  <p>Cloud MCP uses the <code>streamable-http</code> transport. Add it manually to <code>~/.claude/mcp_servers.json</code>:</p>

  <pre><code>{
  "mcpServers": {
    "frozen-ink-cloud": {
      "transport": "http",
      "url": "https://my-deployment.workers.dev/mcp",
      "headers": {
        "Authorization": "Bearer your-deployment-password"
      }
    }
  }
}</code></pre>

  <p>Restart Claude Code for the change to take effect. The cloud connection appears alongside any local collection links you've configured — you can use both at the same time.</p>

  <div class="callout callout-tip">
    <div class="callout-icon">💡</div>
    <div class="callout-body">
      <strong>Local vs. cloud</strong>
      <p>Local links give Claude per-collection access scoped to your machine — great for private notes. The cloud link gives access to everything in the published deployment, across any device. Combine them as needed.</p>
    </div>
  </div>

  <h2 id="add-collection-folder">Add a collection folder</h2>
  <p>A "collection folder" is a Frozen Ink collection pointing at a local directory. The two most common cases are an Obsidian vault and a Git repository.</p>

  <h3 id="obsidian-vault">Obsidian vault</h3>
  <p>Frozen Ink understands Obsidian's wiki-link syntax, callout blocks, embedded images, and YAML frontmatter:</p>
  <pre><code>fink add obsidian \
  <span class="flag">--name</span> my-vault \
  <span class="flag">--path</span> ~/Documents/MyVault</code></pre>

  <h3 id="git-repo">Git repository</h3>
  <p>Get a searchable index of commit history, branches, and tags:</p>
  <pre><code>fink add git \
  <span class="flag">--name</span> my-project \
  <span class="flag">--path</span> ~/code/my-project</code></pre>
  <p>Add <code>--include-diffs</code> to include the full unified diff of each commit in the rendered markdown — useful for understanding what changed in any given commit.</p>

  <h2 id="sync-and-serve">Sync &amp; serve</h2>
  <p>After adding collections, sync them and start the local web UI:</p>
  <pre><code><span class="cmt"># Sync all collections</span>
fink sync "*"

<span class="cmt"># Start the local web UI (port 3000)</span>
fink serve</code></pre>

  <p>Open <a href="http://localhost:3000">http://localhost:3000</a> to browse your collections. Run <code>fink sync "*"</code> periodically to keep everything up to date.</p>

  <h2 id="browsing-in-claude">Browsing in Claude Code</h2>
  <p>With <code>fink serve</code> running, the web UI is available in any browser — open it side-by-side with Claude Code in a split window. Features include:</p>
  <ul>
    <li><strong>Collection picker</strong> — switch between data sources</li>
    <li><strong>File tree</strong> — browse all markdown files in a resizable folder tree</li>
    <li><strong>Tabs</strong> — open multiple notes simultaneously</li>
    <li><strong>Backlinks panel</strong> — see which notes link to the current one</li>
    <li><strong>Quick switcher</strong> — <kbd>Cmd+P</kbd> or <kbd>Cmd+K</kbd> for full-text search across all collections</li>
    <li><strong>6 display themes</strong> — Default Light, Minimal Light, Solarized Light, Nord Dark, Catppuccin Dark, Dracula Dark</li>
  </ul>

  <table>
    <thead>
      <tr><th>Shortcut</th><th>Action</th></tr>
    </thead>
    <tbody>
      <tr><td><kbd>Cmd+P</kbd> / <kbd>Cmd+K</kbd></td><td>Quick switcher / full-text search</td></tr>
      <tr><td><kbd>Cmd+W</kbd></td><td>Close current tab</td></tr>
      <tr><td><kbd>Ctrl+Tab</kbd></td><td>Next tab</td></tr>
      <tr><td><kbd>Ctrl+Shift+Tab</kbd></td><td>Previous tab</td></tr>
      <tr><td><kbd>Alt+←</kbd> / <kbd>Cmd+[</kbd></td><td>Navigate back</td></tr>
      <tr><td><kbd>Alt+→</kbd> / <kbd>Cmd+]</kbd></td><td>Navigate forward</td></tr>
      <tr><td><kbd>Cmd+\\</kbd></td><td>Toggle sidebar</td></tr>
    </tbody>
  </table>

  <h2 id="collection-description">Collection descriptions</h2>
  <p>A collection description tells Claude what the collection contains and when to consult it. It's included in the MCP server instructions Claude receives, making it much more effective at routing questions to the right source.</p>

  <pre><code>fink add github \
  <span class="flag">--name</span> backend-issues \
  <span class="flag">--repo</span> acme/backend \
  <span class="flag">--token</span> ghp_... \
  <span class="flag">--description</span> "GitHub issues and PRs for the acme/backend repo. Search here for bug reports, feature requests, and code review history."</code></pre>

  <p>Update an existing collection's description at any time:</p>
  <pre><code>fink collections update backend-issues \
  <span class="flag">--description</span> "GitHub issues and PRs for the acme/backend repo."</code></pre>

  <div class="callout callout-tip">
    <div class="callout-icon">💡</div>
    <div class="callout-body">
      <strong>What makes a good description</strong>
      <p>Include: the data source and project name, the kinds of entities it contains (issues, notes, commits), and the types of questions it can answer. For example: <em>"Obsidian vault for personal engineering notes. Contains architecture decisions, meeting notes, and reference docs. Consult for design rationale and background context."</em></p>
    </div>
  </div>

  <h2 id="quick-reference">Quick reference</h2>
  <pre><code><span class="cmt"># First-time setup</span>
fink init
fink add obsidian <span class="flag">--name</span> notes <span class="flag">--path</span> ~/Documents/MyVault
fink add git <span class="flag">--name</span> myapp <span class="flag">--path</span> ~/code/myapp
fink sync "*"
fink mcp add <span class="flag">--tool</span> claude-code notes myapp

<span class="cmt"># Daily workflow</span>
fink sync "*"                  <span class="cmt"># pull latest changes</span>
fink serve                     <span class="cmt"># start web UI when needed</span>
fink status                    <span class="cmt"># check last sync times</span>

<span class="cmt"># Manage MCP links</span>
fink mcp list <span class="flag">--tool</span> claude-code
fink mcp remove <span class="flag">--tool</span> claude-code notes</code></pre>

  <h2 id="troubleshooting">Troubleshooting</h2>

  <h3>Claude doesn't seem to be using Frozen Ink</h3>
  <pre><code>fink mcp list --tool claude-code</code></pre>
  <p>If the collection shows as <strong>unlinked</strong> or missing, run <code>fink mcp add</code> again. If Claude Code was already open, start a new conversation.</p>

  <h3>"fink: command not found" errors</h3>
  <p>Claude Code spawns <code>fink mcp serve</code> using the system PATH. Verify:</p>
  <pre><code>which fink      <span class="cmt"># should print /usr/local/bin/fink or similar</span>
fink --version</code></pre>
  <p>If <code>fink</code> is only on your shell's PATH (e.g. via NVM-managed Node), reinstall globally so it lands in a standard system directory: <code>npm install -g @vboctor/fink</code>.</p>

  <h3>Stale results</h3>
  <p>Sync the collection and the next MCP call will return fresh data:</p>
  <pre><code>fink sync my-vault</code></pre>

  <div class="docs-pagination">
    <a href="/docs/integrations/cloud-mcp" class="docs-pagination-card">
      <span class="docs-pagination-label">← Previous</span>
      <span class="docs-pagination-title">Cloud MCP Access</span>
    </a>
    <a href="/docs/integrations/claude-cowork" class="docs-pagination-card next">
      <span class="docs-pagination-label">Next →</span>
      <span class="docs-pagination-title">Claude Cowork Integration</span>
    </a>
  </div>
  `,
});
