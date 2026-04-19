import { renderDocsPage } from "./layout";

export const cloudMcpPage = renderDocsPage({
  title: "Cloud MCP Access",
  description:
    "Use a published Frozen Ink site as a remote MCP endpoint so cloud AI agents can query your knowledge base from anywhere.",
  activePath: "/docs/integrations/cloud-mcp",
  canonicalPath: "/docs/integrations/cloud-mcp",
  section: "AI Integrations",
  tocLinks: [
    { id: "overview", title: "Overview" },
    { id: "prerequisites", title: "Prerequisites" },
    { id: "the-mcp-endpoint", title: "The MCP endpoint URL" },
    { id: "configure-claude-ai", title: "Configure Claude.ai" },
    { id: "configure-claude-code", title: "Configure Claude Code" },
    { id: "authentication", title: "Authentication" },
    { id: "available-tools", title: "Available tools" },
    { id: "use-cases", title: "Use cases" },
    { id: "team-access", title: "Team-wide access", indent: true },
    { id: "mobile-access", title: "Mobile & cloud access", indent: true },
    { id: "vs-local-mcp", title: "Cloud vs. local MCP" },
  ],
  content: `
  <div class="docs-breadcrumb">
    <a href="/docs">Docs</a>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
    <span>AI Integrations</span>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
    <span>Cloud MCP Access</span>
  </div>

  <h1 class="page-title">Cloud MCP Access</h1>
  <p class="page-lead">Every published Frozen Ink deployment includes a remote MCP endpoint. This lets cloud-based AI agents — Claude.ai, API-connected Claude, or any MCP-compatible tool — query your knowledge base from anywhere, without running Frozen Ink locally.</p>

  <h2 id="overview">Overview</h2>
  <p>When you <a href="/docs/publishing">publish to Cloudflare</a>, the deployment runs a Frozen Ink Worker that exposes:</p>
  <ul>
    <li>A <strong>web UI</strong> at the root URL (password-protected browser access)</li>
    <li>A <strong>REST API</strong> for browse and search (<code>/api/*</code>)</li>
    <li>An <strong>MCP endpoint</strong> at <code>/mcp</code> for AI tool connections</li>
  </ul>
  <p>The MCP endpoint uses the same password you set during publishing for authentication. Any MCP client that supports HTTP/SSE transport can connect to it.</p>

  <div class="feature-grid">
    <div class="feature-card">
      <div class="feature-card-icon">☁️</div>
      <h4>No local server needed</h4>
      <p>The cloud AI connects directly to Cloudflare's edge. Your computer doesn't need to be on or running Frozen Ink.</p>
    </div>
    <div class="feature-card">
      <div class="feature-card-icon">🔒</div>
      <h4>Password protected</h4>
      <p>Every request to the MCP endpoint requires the deployment password. Unauthenticated requests receive a 401.</p>
    </div>
    <div class="feature-card">
      <div class="feature-card-icon">👥</div>
      <h4>Shareable</h4>
      <p>Share the endpoint URL and password with teammates so they can add it to their own Claude configurations.</p>
    </div>
    <div class="feature-card">
      <div class="feature-card-icon">⚡</div>
      <h4>Always up to date</h4>
      <p>After you re-publish with fresh data, all connected AI tools immediately see the updated content.</p>
    </div>
  </div>

  <h2 id="prerequisites">Prerequisites</h2>
  <p>You need a published Frozen Ink deployment. If you haven't published yet, follow the <a href="/docs/publishing">Publishing to Cloudflare</a> guide first.</p>
  <p>After publishing, you'll have:</p>
  <ul>
    <li>A deployment URL like <code>https://my-deployment.my-account.workers.dev</code></li>
    <li>The password you set with <code>--password</code></li>
  </ul>

  <h2 id="the-mcp-endpoint">The MCP endpoint URL</h2>
  <p>The MCP endpoint is always at <code>/mcp</code> on your deployment URL:</p>
  <pre><code>https://my-deployment.my-account.workers.dev/mcp</code></pre>

  <p>This endpoint supports the <strong>HTTP + SSE transport</strong> protocol used by Claude.ai and other remote MCP clients. You'll need both the endpoint URL and your deployment password to connect.</p>

  <h2 id="configure-claude-ai">Configure Claude.ai</h2>
  <p>Claude.ai (the web app at claude.ai) supports remote MCP servers via its integrations settings:</p>

  <div class="steps">
    <div class="step">
      <div class="step-num">1</div>
      <div class="step-body">
        <h4>Open Claude.ai settings</h4>
        <p>Go to <strong>Settings → Integrations</strong> (or <strong>Connected Apps</strong> depending on your plan).</p>
      </div>
    </div>
    <div class="step">
      <div class="step-num">2</div>
      <div class="step-body">
        <h4>Add a new MCP server</h4>
        <p>Click <strong>Add MCP Server</strong> (or similar) and enter:</p>
        <ul>
          <li><strong>Name:</strong> Frozen Ink — My Vault (or any descriptive name)</li>
          <li><strong>URL:</strong> <code>https://my-deployment.my-account.workers.dev/mcp</code></li>
          <li><strong>Authentication:</strong> Select <em>Bearer token</em> and enter your deployment password</li>
        </ul>
      </div>
    </div>
    <div class="step">
      <div class="step-num">3</div>
      <div class="step-body">
        <h4>Enable the integration</h4>
        <p>Toggle the integration on. Claude.ai will connect and list the available tools. You should see the Frozen Ink tools in the list.</p>
      </div>
    </div>
    <div class="step">
      <div class="step-num">4</div>
      <div class="step-body">
        <h4>Start a conversation</h4>
        <p>In a new Claude.ai conversation, the Frozen Ink MCP is now available. Try: <em>"Search my knowledge base for anything about our API design"</em>.</p>
      </div>
    </div>
  </div>

  <div class="callout callout-info">
    <div class="callout-icon">ℹ️</div>
    <div class="callout-body">
      <strong>Claude.ai MCP availability</strong>
      <p>Remote MCP support in Claude.ai may require a Pro, Team, or Enterprise plan. Check your plan's integrations page to see what's available. The MCP endpoint is available on all published Frozen Ink deployments regardless of which plan you use to connect.</p>
    </div>
  </div>

  <h2 id="configure-claude-code">Configure Claude Code &amp; Claude Desktop</h2>
  <p>From v0.2 onward, <code>fink mcp add --http</code> registers the remote MCP endpoint automatically for Claude Code and Claude Desktop, reusing the password stored in <code>credentials.yml</code> when you published:</p>

  <pre><code><span class="cmt"># Claude Code</span>
fink mcp add <span class="flag">--tool</span> claude-code my-vault <span class="flag">--http</span>

<span class="cmt"># Claude Desktop</span>
fink mcp add <span class="flag">--tool</span> claude-desktop my-vault <span class="flag">--http</span></code></pre>

  <p>The password is read automatically from <code>credentials.yml</code> (stored when you published). For other MCP clients that don't yet support <code>--http</code>, edit the configuration file by hand:</p>

  <p>Example for Claude Code's <code>~/.claude/mcp_servers.json</code>:</p>
  <pre><code>{
  "mcpServers": {
    "fink-my-vault": {
      "transport": "http",
      "url": "https://my-deployment.my-account.workers.dev/mcp",
      "headers": {
        "Authorization": "Bearer your-deployment-password"
      }
    }
  }
}</code></pre>

  <p>Restart Claude Code / Claude Desktop for the new MCP server to take effect.</p>

  <div class="callout callout-tip">
    <div class="callout-icon">💡</div>
    <div class="callout-body">
      <strong>Local vs. cloud in Claude Code</strong>
      <p>You can have both local MCP links (via <code>fink mcp add</code>) and the cloud MCP endpoint active at the same time. Local links give Claude access to collections scoped per-connection; the cloud link gives access to everything in the published deployment.</p>
    </div>
  </div>

  <h2 id="authentication">Authentication</h2>
  <p>The cloud MCP endpoint accepts authentication in two ways:</p>

  <h3>Bearer token (recommended)</h3>
  <p>Pass the deployment password as a Bearer token in the <code>Authorization</code> header:</p>
  <pre><code>Authorization: Bearer your-deployment-password</code></pre>

  <h3>Query parameter</h3>
  <p>For tools that don't support custom headers, append the password as a query parameter:</p>
  <pre><code>https://my-deployment.my-account.workers.dev/mcp?token=your-deployment-password</code></pre>

  <div class="callout callout-warning">
    <div class="callout-icon">⚠️</div>
    <div class="callout-body">
      <strong>Keep your password private</strong>
      <p>The deployment password grants full read access to all collections in the deployment. Treat it like any API key — don't commit it to version control or share it publicly. Use separate deployments with different passwords for different audiences.</p>
    </div>
  </div>

  <h2 id="available-tools">Available tools</h2>
  <p>The cloud MCP endpoint exposes the same tools as the local MCP server:</p>

  <table>
    <thead>
      <tr><th>Tool</th><th>Description</th></tr>
    </thead>
    <tbody>
      <tr>
        <td><code>collection_list</code></td>
        <td>Lists all collections in the deployment with metadata</td>
      </tr>
      <tr>
        <td><code>entity_search</code></td>
        <td>Full-text search across all entities in all collections</td>
      </tr>
      <tr>
        <td><code>entity_get_data</code></td>
        <td>Retrieves structured data for a specific entity</td>
      </tr>
      <tr>
        <td><code>entity_get_markdown</code></td>
        <td>Retrieves rendered markdown for a specific entity</td>
      </tr>
      <tr>
        <td><code>entity_get_attachment</code></td>
        <td>Retrieves an attachment file for a specific entity</td>
      </tr>
    </tbody>
  </table>

  <p>Unlike the local MCP (which is scoped per collection), a single cloud MCP connection gives access to <em>all</em> collections in the deployment simultaneously — the <code>entity_search</code> tool searches across all of them.</p>

  <h2 id="use-cases">Use cases</h2>

  <h3 id="team-access">Team-wide access</h3>
  <p>One person publishes the team's knowledge base, then shares the MCP endpoint URL and password with the team. Each team member adds the endpoint to their own Claude configuration:</p>
  <ul>
    <li>No one else needs to install Frozen Ink</li>
    <li>No one else needs to sync data or manage collections</li>
    <li>Everyone gets the same up-to-date knowledge</li>
    <li>The team owner updates content by re-syncing and re-publishing</li>
  </ul>

  <p>Typical team deployment:</p>
  <pre><code><span class="cmt"># Team lead: publish team knowledge</span>
fink sync "*"
fink publish github-issues architecture-notes runbooks \
  <span class="flag">--password</span> team-secret \
  <span class="flag">--name</span> acme-team-kb

<span class="cmt"># Share this URL + password with the team:</span>
<span class="cmt"># https://acme-team-kb.teamlead.workers.dev/mcp</span></code></pre>

  <h3 id="mobile-access">Mobile &amp; cloud access</h3>
  <p>The cloud MCP endpoint is useful when you're using Claude from a device where the Frozen Ink CLI isn't installed — a tablet, a phone, or a shared computer. Since the data lives on Cloudflare's edge, the connection works from anywhere without VPNs or local servers.</p>

  <h2 id="vs-local-mcp">Cloud vs. local MCP</h2>
  <p>Choose the right approach for your use case:</p>

  <table>
    <thead>
      <tr><th></th><th>Local MCP</th><th>Cloud MCP</th></tr>
    </thead>
    <tbody>
      <tr>
        <td><strong>Setup</strong></td>
        <td><code>fink mcp add --tool claude-code my-vault</code></td>
        <td><code>fink mcp add --tool claude-code my-vault --http</code> (after publish)</td>
      </tr>
      <tr>
        <td><strong>Data location</strong></td>
        <td>Your machine (never leaves)</td>
        <td>Cloudflare's edge infrastructure</td>
      </tr>
      <tr>
        <td><strong>Works offline</strong></td>
        <td>Yes</td>
        <td>No (requires internet)</td>
      </tr>
      <tr>
        <td><strong>Requires local Frozen Ink</strong></td>
        <td>Yes</td>
        <td>No</td>
      </tr>
      <tr>
        <td><strong>Shareable with team</strong></td>
        <td>No</td>
        <td>Yes</td>
      </tr>
      <tr>
        <td><strong>Works from any device</strong></td>
        <td>No (tied to your machine)</td>
        <td>Yes</td>
      </tr>
      <tr>
        <td><strong>Data freshness</strong></td>
        <td>Always current after sync</td>
        <td>Current as of last publish</td>
      </tr>
      <tr>
        <td><strong>Cost</strong></td>
        <td>Free (no cloud)</td>
        <td>Cloudflare free tier (usually free)</td>
      </tr>
    </tbody>
  </table>

  <p>For most personal workflows, <a href="/docs/integrations/local-mcp">local MCP</a> is simpler and keeps all data on your machine. Cloud MCP shines for team collaboration and cross-device access.</p>

  <div class="docs-pagination">
    <a href="/docs/integrations/local-mcp" class="docs-pagination-card">
      <span class="docs-pagination-label">← Previous</span>
      <span class="docs-pagination-title">Local MCP Setup</span>
    </a>
    <a href="/docs/integrations/claude-code" class="docs-pagination-card next">
      <span class="docs-pagination-label">Next →</span>
      <span class="docs-pagination-title">Claude Code Integration</span>
    </a>
  </div>
  `,
});
