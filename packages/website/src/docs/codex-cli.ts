import { renderDocsPage } from "./layout";

export const codexCliPage = renderDocsPage({
  title: "Codex CLI Integration",
  description:
    "Connect Frozen Ink collections to OpenAI Codex CLI via MCP so it can search and read your knowledge base during coding sessions.",
  activePath: "/docs/codex-cli",
  tocLinks: [
    { id: "overview", title: "Overview" },
    { id: "prerequisites", title: "Prerequisites" },
    { id: "link-collections", title: "Link collections" },
    { id: "multiple-collections", title: "Multiple collections" },
    { id: "manage-links", title: "Managing links" },
    { id: "available-tools", title: "Available MCP tools" },
    { id: "troubleshooting", title: "Troubleshooting" },
  ],
  content: `
  <div class="docs-breadcrumb">
    <a href="/docs">Docs</a>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
    <span>Codex CLI Integration</span>
  </div>

  <h1 class="page-title">Codex CLI Integration</h1>
  <p class="page-lead">Frozen Ink integrates with OpenAI Codex CLI via the Model Context Protocol. Once linked, Codex can search your notes, read documents, and access your entire knowledge base in any coding session — without copy-pasting anything.</p>

  <h2 id="overview">Overview</h2>
  <p>Codex CLI has built-in MCP support via its <code>codex mcp add</code> command. Frozen Ink registers collections directly through that interface, creating a <strong>per-collection, stdio-based connection</strong> for each one.</p>

  <div class="feature-grid">
    <div class="feature-card">
      <div class="feature-card-icon">⚡</div>
      <h4>Fast by design</h4>
      <p>stdio transport is direct process I/O — no HTTP overhead, no network latency. Frozen Ink queries hit the local SQLite index and return in single-digit milliseconds, keeping Codex sessions snappy.</p>
    </div>
    <div class="feature-card">
      <div class="feature-card-icon">♾️</div>
      <h4>No rate limits</h4>
      <p>Local execution means no API quotas and no per-query cost. Codex can call Frozen Ink tools as many times as needed without any throttling.</p>
    </div>
    <div class="feature-card">
      <div class="feature-card-icon">🔒</div>
      <h4>Local and private</h4>
      <p>Codex spawns <code>fink mcp serve</code> as a subprocess on demand. Your data never leaves the machine — no background server, fully offline.</p>
    </div>
  </div>

  <h2 id="prerequisites">Prerequisites</h2>
  <ul>
    <li><strong>Frozen Ink CLI installed</strong> — verify with <code>fink --version</code>. Install via <code>npm install -g @vboctor/fink</code>.</li>
    <li><strong>fink on your PATH</strong> — Codex spawns <code>fink mcp serve</code> as a subprocess. Confirm: <code>which fink</code></li>
    <li><strong>Codex CLI installed</strong> — verify with <code>codex --version</code>. The <code>codex mcp</code> subcommand with <code>add</code>, <code>remove</code>, and <code>list</code> must be available.</li>
    <li><strong>At least one collection synced</strong> — check with <code>fink status</code>. If you haven't added a collection yet, see <a href="/docs/managing-collections">Managing Collections</a>.</li>
  </ul>

  <h2 id="link-collections">Link collections</h2>

  <div class="steps">
    <div class="step">
      <div class="step-num">1</div>
      <div class="step-body">
        <h4>Sync your collection</h4>
        <pre><code>fink sync my-vault
fink status</code></pre>
        <p>Make sure the collection has data before linking. Codex queries the local SQLite database at tool-call time, so an unsynced collection won't return results.</p>
      </div>
    </div>
    <div class="step">
      <div class="step-num">2</div>
      <div class="step-body">
        <h4>Link to Codex CLI</h4>
        <pre><code>fink mcp add <span class="flag">--tool</span> codex-cli my-vault</code></pre>
        <p>This calls <code>codex mcp add fink-my-vault -- fink mcp serve --collection my-vault</code> under the hood, registering the connection in Codex's MCP configuration.</p>
      </div>
    </div>
    <div class="step">
      <div class="step-num">3</div>
      <div class="step-body">
        <h4>Verify the link</h4>
        <pre><code>fink mcp list <span class="flag">--tool</span> codex-cli</code></pre>
        <p>You should see <code>my-vault</code> listed with status <strong>linked</strong>.</p>
      </div>
    </div>
    <div class="step">
      <div class="step-num">4</div>
      <div class="step-body">
        <h4>Start a Codex session</h4>
        <p>Run <code>codex</code> to start a new session. The MCP connection is established on the first tool call. Try: <em>"Search my knowledge base for anything about authentication"</em>.</p>
      </div>
    </div>
  </div>

  <div class="callout callout-info">
    <div class="callout-icon">ℹ️</div>
    <div class="callout-body">
      <strong><code>codex</code> alias</strong>
      <p>The short alias <code>--tool codex</code> is equivalent to <code>--tool codex-cli</code> and is preserved for compatibility:</p>
      <pre><code>fink mcp add <span class="flag">--tool</span> codex my-vault</code></pre>
    </div>
  </div>

  <h2 id="multiple-collections">Multiple collections</h2>
  <p>Link several collections at once or separately — each becomes its own MCP connection:</p>
  <pre><code><span class="cmt"># Link two collections in one command</span>
fink mcp add <span class="flag">--tool</span> codex-cli my-vault my-project-issues

<span class="cmt"># Or add them one at a time</span>
fink mcp add <span class="flag">--tool</span> codex-cli my-vault
fink mcp add <span class="flag">--tool</span> codex-cli my-project-issues</code></pre>

  <p>Codex sees each collection as a distinct knowledge source and can query them independently in the same session. Each link corresponds to one entry in Codex's MCP server list (e.g. <code>fink-my-vault</code>, <code>fink-my-project-issues</code>).</p>

  <h2 id="manage-links">Managing links</h2>
  <pre><code><span class="cmt"># Add a collection</span>
fink mcp add <span class="flag">--tool</span> codex-cli my-vault

<span class="cmt"># Remove a collection</span>
fink mcp remove <span class="flag">--tool</span> codex-cli my-vault

<span class="cmt"># List current links for Codex CLI</span>
fink mcp list <span class="flag">--tool</span> codex-cli

<span class="cmt"># List all MCP links across all tools</span>
fink mcp list</code></pre>

  <p>Changes take effect in the next Codex session. No restart is needed for already-running sessions to pick up new links.</p>

  <h2 id="available-tools">Available MCP tools</h2>
  <p>Each linked collection exposes the following tools to Codex:</p>

  <table>
    <thead>
      <tr><th>Tool</th><th>Description</th></tr>
    </thead>
    <tbody>
      <tr>
        <td><code>collection_list</code></td>
        <td>Returns metadata about the linked collection: name, type, entity count, last sync time.</td>
      </tr>
      <tr>
        <td><code>entity_search</code></td>
        <td>Full-text search across all entities in the collection. Returns ranked results with entity IDs and snippets. Supports natural language queries.</td>
      </tr>
      <tr>
        <td><code>entity_get_data</code></td>
        <td>Retrieves structured data for a specific entity (e.g. a GitHub issue's fields: title, body, labels, assignees, timestamps). Returns JSON.</td>
      </tr>
      <tr>
        <td><code>entity_get_markdown</code></td>
        <td>Retrieves the rendered markdown for a specific entity — the human-readable form ideal for the model to read and reference.</td>
      </tr>
      <tr>
        <td><code>entity_get_attachment</code></td>
        <td>Retrieves a binary attachment (image, PDF, etc.) for a specific entity.</td>
      </tr>
    </tbody>
  </table>

  <h2 id="troubleshooting">Troubleshooting</h2>

  <h3>Codex doesn't seem to be using Frozen Ink</h3>
  <pre><code>fink mcp list --tool codex-cli</code></pre>
  <p>If the collection shows as <strong>unlinked</strong> or missing, run <code>fink mcp add</code> again. Also verify Codex sees the server:</p>
  <pre><code>codex mcp list</code></pre>
  <p>You should see entries named <code>fink-&lt;collection&gt;</code> in the output.</p>

  <h3>"Codex CLI not found on PATH"</h3>
  <p>Frozen Ink calls <code>codex mcp add</code> to register the connection. If <code>codex</code> isn't on your PATH, install or enable it first, then retry <code>fink mcp add</code>.</p>

  <h3>"fink: command not found" errors in Codex</h3>
  <p>Codex spawns <code>fink mcp serve</code> using the system PATH. Verify:</p>
  <pre><code>which fink      <span class="cmt"># should print /usr/local/bin/fink or similar</span>
fink --version</code></pre>
  <p>If <code>fink</code> is only accessible from your shell's PATH (e.g. a user-local npm path), reinstall globally: <code>npm install -g @vboctor/fink</code>.</p>

  <h3>Stale results</h3>
  <p>The MCP server reads from the local SQLite database at query time. Sync the collection and the next tool call will reflect updated data:</p>
  <pre><code>fink sync my-vault</code></pre>

  <div class="docs-pagination">
    <a href="/docs/claude-desktop" class="docs-pagination-card">
      <span class="docs-pagination-label">← Previous</span>
      <span class="docs-pagination-title">Claude Desktop Integration</span>
    </a>
    <a href="/docs/chatgpt-desktop" class="docs-pagination-card next">
      <span class="docs-pagination-label">Next →</span>
      <span class="docs-pagination-title">ChatGPT Desktop Integration</span>
    </a>
  </div>
  `,
});
