import { renderDocsPage } from "./layout";

export const claudeDesktopPage = renderDocsPage({
  title: "Claude Desktop Integration",
  description:
    "Connect Frozen Ink collections to Claude Desktop via MCP so Claude can search and read your knowledge base directly in conversations.",
  activePath: "/docs/claude-desktop",
  tocLinks: [
    { id: "overview", title: "Overview" },
    { id: "prerequisites", title: "Prerequisites" },
    { id: "link-collections", title: "Link collections via MCP" },
    { id: "example-prompts", title: "What Claude can do" },
    { id: "config-paths", title: "Config file paths" },
    { id: "multiple-collections", title: "Multiple collections" },
    { id: "manage-links", title: "Managing links" },
    { id: "cloud-mcp", title: "Cloud MCP access" },
    { id: "collection-description", title: "Collection descriptions" },
    { id: "quick-reference", title: "Quick reference" },
    { id: "troubleshooting", title: "Troubleshooting" },
  ],
  content: `
  <div class="docs-breadcrumb">
    <a href="/docs">Docs</a>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
    <span>Claude Desktop Integration</span>
  </div>

  <h1 class="page-title">Claude Desktop Integration</h1>
  <p class="page-lead">Frozen Ink integrates with Claude Desktop via the Model Context Protocol (MCP). Once linked, Claude can search your notes, read documents, and access your entire knowledge base directly inside any conversation — without you copying and pasting anything.</p>

  <h2 id="overview">Overview</h2>
  <p>Claude Desktop is Anthropic's native desktop app for macOS and Windows. It supports stdio-based MCP connections, so Frozen Ink collections can be wired in with a single CLI command.</p>

  <div class="feature-grid">
    <div class="feature-card">
      <div class="feature-card-icon">🔍</div>
      <h4>Search from any conversation</h4>
      <p>Ask Claude questions about your notes and repos. Claude calls Frozen Ink's MCP tools, fetches the relevant content, and incorporates it into its response — all inline, without switching apps.</p>
    </div>
    <div class="feature-card">
      <div class="feature-card-icon">🔒</div>
      <h4>Local and private</h4>
      <p>MCP connections use stdio — Claude Desktop spawns <code>fink mcp serve</code> on demand and reads your local SQLite index. No background server, no network calls for local collections.</p>
    </div>
  </div>

  <h2 id="prerequisites">Prerequisites</h2>
  <ul>
    <li><strong>Frozen Ink CLI installed</strong> — verify with <code>fink --version</code>. Install via <code>npm install -g @vboctor/fink</code>.</li>
    <li><strong>fink on your PATH</strong> — Claude Desktop spawns <code>fink mcp serve</code> as a subprocess. Confirm: <code>which fink</code></li>
    <li><strong>At least one collection synced</strong> — check with <code>fink status</code>. If you haven't added a collection yet, see <a href="/docs/managing-collections">Managing Collections</a>.</li>
    <li><strong>Claude Desktop installed</strong> — download from <a href="https://claude.ai/download">claude.ai/download</a>. Launch it at least once so its config directory is created.</li>
  </ul>

  <h2 id="link-collections">Link collections via MCP</h2>
  <p>The <code>fink mcp add</code> command writes directly into Claude Desktop's config file, so you don't need to edit JSON manually.</p>

  <div class="steps">
    <div class="step">
      <div class="step-num">1</div>
      <div class="step-body">
        <h4>Sync your collection</h4>
        <pre><code>fink sync my-vault
fink status</code></pre>
        <p>Make sure the collection has data before linking it. Claude will query the local index, so an empty or unsynced collection won't return results.</p>
      </div>
    </div>
    <div class="step">
      <div class="step-num">2</div>
      <div class="step-body">
        <h4>Link the collection</h4>
        <pre><code>fink mcp add <span class="flag">--tool</span> claude-desktop my-vault</code></pre>
        <p>This adds an entry to <code>claude_desktop_config.json</code> that tells Claude Desktop to call <code>fink mcp serve --collection my-vault</code> when an MCP tool call is made for that collection.</p>
      </div>
    </div>
    <div class="step">
      <div class="step-num">3</div>
      <div class="step-body">
        <h4>Verify the link</h4>
        <pre><code>fink mcp list <span class="flag">--tool</span> claude-desktop</code></pre>
        <p>You should see <code>my-vault</code> listed with status <strong>linked</strong>.</p>
      </div>
    </div>
    <div class="step">
      <div class="step-num">4</div>
      <div class="step-body">
        <h4>Restart Claude Desktop</h4>
        <p>Quit Claude Desktop completely and relaunch it. Claude Desktop reads its MCP config at startup — already-running instances won't pick up new connections.</p>
      </div>
    </div>
    <div class="step">
      <div class="step-num">5</div>
      <div class="step-body">
        <h4>Start a conversation</h4>
        <p>Open a new chat in Claude Desktop. The MCP connection is established on the first tool call. Try: <em>"Search my knowledge base for anything about authentication"</em>.</p>
      </div>
    </div>
  </div>

  <div class="callout callout-tip">
    <div class="callout-icon">💡</div>
    <div class="callout-body">
      <strong>Restart required every time you add or remove a collection</strong>
      <p>Unlike Claude Code (which hot-loads MCP config), Claude Desktop reads configuration only at startup. After any <code>fink mcp add</code> or <code>fink mcp remove</code> command, quit and relaunch Claude Desktop for the change to take effect.</p>
    </div>
  </div>

  <h2 id="example-prompts">What Claude can do</h2>
  <p>With collections linked, you can ask Claude questions directly in a conversation:</p>

  <ul>
    <li><em>"What does my architecture note say about the caching strategy?"</em></li>
    <li><em>"Search my notes for anything related to rate limiting"</em></li>
    <li><em>"Find recent commits in my project that touched the auth module"</em></li>
    <li><em>"What open GitHub issues are tagged with 'performance'?"</em></li>
    <li><em>"Summarize my meeting notes from this week"</em></li>
  </ul>

  <p>Claude calls <code>entity_search</code> to find relevant items, then <code>entity_get_markdown</code> to read the full content, and synthesizes the answer — all within the conversation.</p>

  <h2 id="config-paths">Config file paths</h2>
  <p>Frozen Ink writes to the standard Claude Desktop configuration file. The path depends on your operating system:</p>

  <div class="callout callout-info">
    <div class="callout-icon">ℹ️</div>
    <div class="callout-body">
      <strong>Platform-specific config locations</strong>
      <ul>
        <li><strong>macOS:</strong> <code>~/Library/Application Support/Claude/claude_desktop_config.json</code></li>
        <li><strong>Windows:</strong> <code>%APPDATA%\\Claude\\claude_desktop_config.json</code></li>
        <li><strong>Linux:</strong> <code>~/.config/Claude/claude_desktop_config.json</code></li>
      </ul>
    </div>
  </div>

  <p>After running <code>fink mcp add</code>, you can inspect the file to see the registered entry:</p>
  <pre><code>{
  "mcpServers": {
    "fink-my-vault": {
      "command": "fink",
      "args": ["mcp", "serve", "--collection", "my-vault"]
    }
  }
}</code></pre>

  <p>Each collection creates one entry under <code>mcpServers</code>. You can have as many as you need.</p>

  <h2 id="multiple-collections">Multiple collections</h2>
  <p>Link several collections at once or in separate commands — the result is the same:</p>
  <pre><code><span class="cmt"># Link two collections in one command</span>
fink mcp add <span class="flag">--tool</span> claude-desktop my-vault my-project-issues

<span class="cmt"># Or add them one at a time</span>
fink mcp add <span class="flag">--tool</span> claude-desktop my-vault
fink mcp add <span class="flag">--tool</span> claude-desktop my-project-issues</code></pre>

  <p>Each collection becomes a separate MCP connection. Claude sees them as distinct knowledge sources and can query them independently.</p>

  <div class="callout callout-info">
    <div class="callout-icon">ℹ️</div>
    <div class="callout-body">
      <strong>One connection per collection</strong>
      <p>Each collection = one MCP connection in Claude Desktop. If you have 3 collections linked, Claude Desktop shows 3 Frozen Ink MCP servers. This is by design — each connection is scoped to a single collection for clarity and permission control.</p>
    </div>
  </div>

  <h2 id="manage-links">Managing links</h2>
  <pre><code><span class="cmt"># Add a collection</span>
fink mcp add <span class="flag">--tool</span> claude-desktop my-vault

<span class="cmt"># Remove a collection</span>
fink mcp remove <span class="flag">--tool</span> claude-desktop my-vault

<span class="cmt"># List current links for Claude Desktop</span>
fink mcp list <span class="flag">--tool</span> claude-desktop

<span class="cmt"># List all MCP links across all tools</span>
fink mcp list</code></pre>

  <p>After adding or removing a collection, always restart Claude Desktop for the change to take effect.</p>

  <h2 id="cloud-mcp">Cloud MCP access</h2>
  <p>If you've published a collection to Cloudflare, you can connect Claude Desktop to the cloud deployment instead of (or alongside) local collections. This is useful for sharing a knowledge base across machines or with collaborators.</p>

  <p>Cloud MCP uses the <code>streamable-http</code> transport with a Bearer token. Because Claude Desktop's built-in MCP configuration UI only supports stdio connections, you'll add the remote server manually via <code>claude_desktop_config.json</code>:</p>

  <pre><code>{
  "mcpServers": {
    "my-cloud-vault": {
      "url": "https://my-deployment.workers.dev/mcp",
      "transport": "streamable-http",
      "headers": {
        "Authorization": "Bearer your-deployment-password"
      }
    }
  }
}</code></pre>

  <p>See <a href="/docs/cloud-mcp">Cloud MCP Access</a> for the full guide, including how to find your deployment URL and password.</p>

  <h2 id="collection-description">Collection descriptions</h2>
  <p>A collection description tells Claude what the collection contains and when to consult it. It's included in the MCP server instructions Claude receives, making Claude much more effective at routing questions to the right source.</p>

  <p>Set a description when adding a collection:</p>
  <pre><code>fink add obsidian \
  <span class="flag">--name</span>        my-vault \
  <span class="flag">--path</span>        ~/Documents/MyVault \
  <span class="flag">--description</span> "Personal engineering notes: architecture decisions, meeting notes, and reference docs. Consult for design rationale and background context."</code></pre>

  <p>Or update an existing collection:</p>
  <pre><code>fink collections update my-vault \
  <span class="flag">--description</span> "Personal engineering notes with architecture decisions and meeting notes."</code></pre>

  <div class="callout callout-tip">
    <div class="callout-icon">💡</div>
    <div class="callout-body">
      <strong>What makes a good description</strong>
      <p>Include the data source and project name, the kinds of entities it contains (notes, issues, commits), and the types of questions it can answer. For example: <em>"GitHub issues and PRs for the acme/backend repo. Search here for bug reports, feature requests, and code review history."</em></p>
    </div>
  </div>

  <h2 id="quick-reference">Quick reference</h2>
  <pre><code><span class="cmt"># First-time setup</span>
fink init
fink add obsidian <span class="flag">--name</span> notes <span class="flag">--path</span> ~/Documents/MyVault
fink sync notes
fink mcp add <span class="flag">--tool</span> claude-desktop notes
<span class="cmt"># → Restart Claude Desktop</span>

<span class="cmt"># Add another collection later</span>
fink add git <span class="flag">--name</span> myapp <span class="flag">--path</span> ~/code/myapp
fink sync myapp
fink mcp add <span class="flag">--tool</span> claude-desktop myapp
<span class="cmt"># → Restart Claude Desktop</span>

<span class="cmt"># Keep collections fresh</span>
fink daemon start          <span class="cmt"># auto-sync in background</span>
fink sync "*"              <span class="cmt"># manual one-shot sync</span>
fink status                <span class="cmt"># check last sync times</span>

<span class="cmt"># Inspect and manage MCP links</span>
fink mcp list <span class="flag">--tool</span> claude-desktop
fink mcp remove <span class="flag">--tool</span> claude-desktop notes</code></pre>

  <h2 id="troubleshooting">Troubleshooting</h2>

  <h3>Claude doesn't seem to be using Frozen Ink</h3>
  <p>First verify the link is registered:</p>
  <pre><code>fink mcp list --tool claude-desktop</code></pre>
  <p>If the collection shows as <strong>unlinked</strong> or missing, run <code>fink mcp add</code> again. Then fully quit and relaunch Claude Desktop — the app reads MCP config only at startup, so restarting is required.</p>

  <h3>"claude-desktop not found" when running fink mcp add</h3>
  <p>Frozen Ink checks for Claude Desktop's config directory before writing. If it can't find it, launch Claude Desktop at least once so it creates its config directory, then retry.</p>

  <h3>"fink: command not found" errors in Claude Desktop</h3>
  <p>Claude Desktop spawns <code>fink mcp serve</code> using the system PATH, which may differ from your shell's PATH. Check:</p>
  <pre><code>which fink      <span class="cmt"># should print /usr/local/bin/fink or similar</span>
fink --version</code></pre>
  <p>If <code>fink</code> is installed in a user-local path (e.g. an NVM-managed Node location), reinstall globally so it lands in a standard system PATH directory: <code>npm install -g @vboctor/fink</code>.</p>

  <h3>Stale results in Claude's responses</h3>
  <p>The MCP server reads from the local SQLite database at query time. Sync the collection and the next tool call will return fresh data:</p>
  <pre><code>fink sync my-vault</code></pre>

  <div class="docs-pagination">
    <a href="/docs/claude-code" class="docs-pagination-card">
      <span class="docs-pagination-label">← Previous</span>
      <span class="docs-pagination-title">Claude Code Integration</span>
    </a>
    <a href="/docs/local-mcp" class="docs-pagination-card next">
      <span class="docs-pagination-label">Next →</span>
      <span class="docs-pagination-title">Local MCP Setup</span>
    </a>
  </div>
  `,
});
