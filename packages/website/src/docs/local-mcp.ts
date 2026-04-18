import { renderDocsPage } from "./layout";

export const localMcpPage = renderDocsPage({
  title: "Local MCP Setup",
  description:
    "Link Frozen Ink collections to Claude Code, Claude Desktop, Codex CLI, and other local MCP clients via stdio transport.",
  activePath: "/docs/integrations/local-mcp",
  canonicalPath: "/docs/integrations/local-mcp",
  section: "AI Integrations",
  tocLinks: [
    { id: "what-is-mcp", title: "What is MCP" },
    { id: "how-it-works", title: "How it works in Frozen Ink" },
    { id: "link-to-claude-code", title: "Link to Claude Code" },
    { id: "link-to-claude-desktop", title: "Link to Claude Desktop" },
    { id: "link-to-codex-cli", title: "Link to Codex CLI" },
    { id: "link-to-chatgpt-desktop", title: "Link to ChatGPT Desktop" },
    { id: "available-tools", title: "Available MCP tools" },
    { id: "available-resources", title: "Available MCP resources" },
    { id: "multiple-collections", title: "Multiple collections" },
    { id: "remove-links", title: "Removing links" },
    { id: "tui-mcp", title: "TUI MCP config" },
    { id: "troubleshooting", title: "Troubleshooting" },
  ],
  content: `
  <div class="docs-breadcrumb">
    <a href="/docs">Docs</a>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
    <span>AI Integrations</span>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
    <span>Local MCP Setup</span>
  </div>

  <h1 class="page-title">Local MCP Setup</h1>
  <p class="page-lead">The Model Context Protocol (MCP) lets AI assistants directly query your Frozen Ink collections. Once linked, your MCP client can search notes, read specific documents, and access attachments without copy/paste.</p>

  <h2 id="what-is-mcp">What is MCP</h2>
  <p>The <a href="https://modelcontextprotocol.io">Model Context Protocol</a> is an open standard that lets AI assistants connect to external data sources and tools. Think of it as a structured API between your MCP client and your local Frozen Ink knowledge base.</p>
  <p>When a collection is linked via MCP, the client can call Frozen Ink's search and retrieval tools during a conversation, fetch relevant content, and incorporate it into responses.</p>

  <h2 id="how-it-works">How it works in Frozen Ink</h2>
  <p>Frozen Ink uses a <strong>per-collection, stdio-based MCP transport</strong> for local clients like Claude Code, Claude Desktop, and Codex CLI. Each collection link registers a separate MCP connection. When the client queries a collection, it spawns <code>fink mcp serve --collection &lt;name&gt;</code> as a subprocess and communicates over stdio.</p>

  <p>This means:</p>
  <ul>
    <li><strong>No background server required.</strong> You don't need to run <code>fink serve</code> for MCP to work — it spawns on demand.</li>
    <li><strong>Per-collection scoping.</strong> Each MCP connection only has access to one collection. This gives you fine-grained control over what Claude can see.</li>
    <li><strong>Works offline.</strong> The local SQLite database is queried directly — no network calls.</li>
    <li><strong>No data leaves your machine.</strong> Content is read locally and passed to Claude as context in the conversation, just like any other message.</li>
  </ul>

  <h2 id="link-to-claude-code">Link to Claude Code</h2>
  <p>The <code>fink mcp add</code> command registers the collection in Claude Code's MCP configuration file automatically:</p>

  <div class="steps">
    <div class="step">
      <div class="step-num">1</div>
      <div class="step-body">
        <h4>Ensure the collection is synced</h4>
        <pre><code>fink sync my-vault
fink status</code></pre>
      </div>
    </div>
    <div class="step">
      <div class="step-num">2</div>
      <div class="step-body">
        <h4>Link the collection to Claude Code</h4>
        <pre><code>fink mcp add <span class="flag">--tool</span> claude-code my-vault</code></pre>
        <p>This writes an entry to Claude Code's MCP configuration (typically at <code>~/.claude/mcp_servers.json</code>) that instructs Claude Code to call <code>fink mcp serve --collection my-vault</code> when the MCP server is needed.</p>
      </div>
    </div>
    <div class="step">
      <div class="step-num">3</div>
      <div class="step-body">
        <h4>Verify the link</h4>
        <pre><code>fink mcp list <span class="flag">--tool</span> claude-code</code></pre>
        <p>You should see <code>my-vault</code> listed with status <strong>linked</strong>.</p>
      </div>
    </div>
    <div class="step">
      <div class="step-num">4</div>
      <div class="step-body">
        <h4>Open or restart Claude Code</h4>
        <p>Start a new conversation in Claude Code. Claude now has access to your collection. Try asking: <em>"Search my knowledge base for anything about authentication"</em>.</p>
      </div>
    </div>
  </div>

  <div class="callout callout-info">
    <div class="callout-icon">ℹ️</div>
    <div class="callout-body">
      <strong>fink must be on your PATH</strong>
      <p>Claude Code runs <code>fink mcp serve</code> as a subprocess. Make sure the <code>fink</code> binary is accessible on your system PATH — installing via npm (<code>npm install -g @vboctor/fink</code>) handles this automatically. If you installed a standalone binary, ensure it's in <code>/usr/local/bin/</code> or another PATH directory.</p>
    </div>
  </div>

  <h2 id="link-to-claude-desktop">Link to Claude Desktop</h2>
  <p>The same command works for Claude Desktop:</p>
  <pre><code>fink mcp add <span class="flag">--tool</span> claude-desktop my-vault</code></pre>

  <p>This updates Claude Desktop's MCP configuration at <code>~/Library/Application Support/Claude/claude_desktop_config.json</code> (macOS) or the equivalent path on your platform.</p>

  <div class="callout callout-tip">
    <div class="callout-icon">💡</div>
    <div class="callout-body">
      <strong>Restart Claude Desktop after linking</strong>
      <p>Claude Desktop reads MCP configuration at startup. After running <code>fink mcp add</code>, quit and relaunch Claude Desktop for the new connection to take effect.</p>
    </div>
  </div>

  <h2 id="link-to-codex-cli">Link to Codex CLI</h2>
  <p>Use the canonical Codex tool name:</p>
  <pre><code>fink mcp add <span class="flag">--tool</span> codex-cli my-vault</code></pre>
  <p>Legacy compatibility is preserved for older scripts:</p>
  <pre><code>fink mcp add <span class="flag">--tool</span> codex my-vault</code></pre>
  <p><code>codex</code> is treated as an alias for <code>codex-cli</code>.</p>

  <h2 id="link-to-chatgpt-desktop">Link to ChatGPT Desktop</h2>
  <p>ChatGPT Desktop uses a remote HTTP connector rather than local stdio, so it requires a <strong>published</strong> collection instead of a local MCP link. See the <a href="/docs/integrations/chatgpt-desktop">ChatGPT Desktop Integration</a> guide and <a href="/docs/integrations/cloud-mcp">Cloud MCP Access</a> for the full setup.</p>

  <h2 id="available-tools">Available MCP tools</h2>
  <p>Each Frozen Ink MCP connection exposes the following tools to your MCP client:</p>

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
        <td>Retrieves the structured data for a specific entity (e.g., a GitHub issue's fields: title, body, labels, assignees, timestamps). Returns JSON.</td>
      </tr>
      <tr>
        <td><code>entity_get_markdown</code></td>
        <td>Retrieves the rendered markdown content for a specific entity. This is the human-readable representation — ideal for Claude to read and reference.</td>
      </tr>
      <tr>
        <td><code>entity_get_attachment</code></td>
        <td>Retrieves a binary attachment (image, PDF, etc.) for a specific entity. Useful for accessing files embedded in Obsidian notes or attached to MantisHub issues.</td>
      </tr>
    </tbody>
  </table>

  <h3>Example interaction</h3>
  <p>In an MCP-enabled session with <code>my-vault</code> linked, you might say:</p>
  <blockquote style="border-left:3px solid var(--border); padding: 12px 20px; margin: 16px 0; color: var(--text-secondary); font-style: italic;">
    "What does my note on the authentication architecture say about token refresh?"
  </blockquote>
  <p>The assistant calls <code>entity_search</code> with <code>"token refresh authentication"</code>, finds the relevant note, then calls <code>entity_get_markdown</code> to read it in full, and synthesizes the answer.</p>

  <h2 id="available-resources">Available MCP resources</h2>
  <p>In addition to tools (callable functions), Frozen Ink exposes these MCP resources — addressable content your assistant can reference:</p>

  <table>
    <thead>
      <tr><th>Resource URI</th><th>Description</th></tr>
    </thead>
    <tbody>
      <tr><td><code>frozenink://collections</code></td><td>List of all collections in the Frozen Ink instance</td></tr>
      <tr><td><code>frozenink://collections/{name}</code></td><td>Metadata and statistics for a specific collection</td></tr>
      <tr><td><code>frozenink://entities/{collection}/{externalId}</code></td><td>Structured data for a specific entity</td></tr>
      <tr><td><code>frozenink://markdown/{collection}/{+path}</code></td><td>Rendered markdown for a specific file path</td></tr>
    </tbody>
  </table>

  <h2 id="multiple-collections">Multiple collections</h2>
  <p>You can link multiple collections to the same AI tool. Each creates a separate MCP connection:</p>
  <pre><code><span class="cmt"># Link two collections in one command</span>
fink mcp add <span class="flag">--tool</span> claude-code my-vault my-project-issues

<span class="cmt"># Or add them separately — same result</span>
fink mcp add <span class="flag">--tool</span> claude-code my-vault
fink mcp add <span class="flag">--tool</span> claude-code my-project-issues</code></pre>

  <p>Adding <code>my-vault</code> and <code>my-project-issues</code> creates <strong>two separate MCP connections</strong> in Claude Code — one scoped to each collection. Claude sees them as distinct knowledge sources and can query them independently.</p>

  <div class="callout callout-info">
    <div class="callout-icon">ℹ️</div>
    <div class="callout-body">
      <strong>Connection count</strong>
      <p>Each collection = one MCP connection. If you have 4 collections linked, Claude Code shows 4 Frozen Ink MCP servers. There's no "one server for all collections" mode for local connections — that's by design, for scoping and permission clarity.</p>
    </div>
  </div>

  <h2 id="remove-links">Removing links</h2>
  <p>To unlink a collection from an AI tool without deleting the collection itself:</p>
  <pre><code><span class="cmt"># Remove one collection link</span>
fink mcp remove <span class="flag">--tool</span> claude-code my-vault

<span class="cmt"># Inspect current links</span>
fink mcp list <span class="flag">--tool</span> claude-code

<span class="cmt"># List all MCP links across all tools</span>
fink mcp list</code></pre>

  <h2 id="tui-mcp">TUI MCP config</h2>
  <p>If you prefer a keyboard-driven UI, the interactive TUI provides the same MCP management features:</p>
  <pre><code>fink     <span class="cmt"># launch TUI</span></code></pre>
  <p>Navigate to <strong>Collections</strong>, select a collection, and press <kbd>m</kbd> to open the MCP configuration panel. From there you can view, add, or remove MCP links for that collection.</p>

  <h2 id="troubleshooting">Troubleshooting</h2>

  <h3>Claude doesn't seem to be using Frozen Ink</h3>
  <p>Check that the link is registered correctly:</p>
  <pre><code>fink mcp list --tool claude-code</code></pre>
  <p>If the collection shows as <strong>unlinked</strong> or missing, run <code>fink mcp add</code> again. If Claude Code was already open when you added the link, restart it.</p>

  <h3>"fink: command not found" errors</h3>
  <p>The <code>fink</code> binary must be on the PATH that Claude Code uses when spawning processes. Check:</p>
  <pre><code>which fink      <span class="cmt"># should print a path like /usr/local/bin/fink</span>
fink --version  <span class="cmt"># should print the installed version</span></code></pre>
  <p>If <code>fink</code> is installed in a path that's in your shell's <code>PATH</code> but not in the system-level <code>PATH</code> (e.g., an NVM-managed Node path), you may need to use the absolute binary path. Re-install with <code>npm install -g @vboctor/fink</code> to a standard location, or use the standalone binary in <code>/usr/local/bin/</code>.</p>

  <h3>Stale data in Claude's responses</h3>
  <p>If Claude is returning information that seems outdated, sync the collection and restart the Claude session:</p>
  <pre><code>fink sync my-vault</code></pre>
  <p>The MCP server reads from the local SQLite database at query time, so after a sync the next MCP call will reflect the updated data.</p>

  <div class="docs-pagination">
    <a href="/docs/integrations/claude-desktop" class="docs-pagination-card">
      <span class="docs-pagination-label">← Previous</span>
      <span class="docs-pagination-title">Claude Desktop Integration</span>
    </a>
    <a href="/docs/publishing" class="docs-pagination-card next">
      <span class="docs-pagination-label">Next →</span>
      <span class="docs-pagination-title">Publishing to Cloudflare</span>
    </a>
  </div>
  `,
});
