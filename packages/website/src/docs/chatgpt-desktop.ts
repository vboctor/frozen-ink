import { renderDocsPage } from "./layout";

export const chatgptDesktopPage = renderDocsPage({
  title: "ChatGPT Desktop Integration",
  description:
    "Connect Frozen Ink to ChatGPT Desktop via a published cloud MCP endpoint so ChatGPT can search and read your knowledge base.",
  activePath: "/docs/integrations/chatgpt-desktop",
  canonicalPath: "/docs/integrations/chatgpt-desktop",
  section: "AI Integrations",
  tocLinks: [
    { id: "overview", title: "Overview" },
    { id: "how-it-works", title: "How it works" },
    { id: "prerequisites", title: "Prerequisites" },
    { id: "publish-collection", title: "Publish your collection" },
    { id: "connect-in-chatgpt", title: "Connect in ChatGPT Desktop" },
    { id: "authentication", title: "Authentication" },
    { id: "available-tools", title: "Available MCP tools" },
    { id: "multiple-collections", title: "Multiple collections" },
    { id: "update-content", title: "Updating content" },
    { id: "troubleshooting", title: "Troubleshooting" },
  ],
  content: `
  <div class="docs-breadcrumb">
    <a href="/docs">Docs</a>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
    <span>AI Integrations</span>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
    <span>ChatGPT Desktop</span>
  </div>

  <h1 class="page-title">ChatGPT Desktop Integration</h1>
  <p class="page-lead">ChatGPT Desktop connects to MCP servers over HTTP rather than stdio. To give ChatGPT access to your Frozen Ink collections, publish them to Cloudflare first, then add the published endpoint as an MCP connector in ChatGPT Desktop settings.</p>

  <h2 id="overview">Overview</h2>
  <p>Unlike Claude Code and Claude Desktop (which use stdio-based MCP), ChatGPT Desktop uses a remote HTTP connector flow. Frozen Ink's published Cloudflare deployment exposes an <code>/mcp</code> endpoint that ChatGPT Desktop can connect to directly.</p>

  <div class="feature-grid">
    <div class="feature-card">
      <div class="feature-card-icon">☁️</div>
      <h4>Cloud-based connection</h4>
      <p>ChatGPT connects to your published Frozen Ink deployment on Cloudflare's edge. No local server needs to be running during ChatGPT sessions.</p>
    </div>
    <div class="feature-card">
      <div class="feature-card-icon">🔒</div>
      <h4>Password protected</h4>
      <p>Every request to the MCP endpoint is authenticated with the password you set when publishing. Unauthenticated requests are rejected.</p>
    </div>
    <div class="feature-card">
      <div class="feature-card-icon">🔍</div>
      <h4>Full knowledge access</h4>
      <p>A single endpoint gives ChatGPT access to all collections in the deployment — search across notes, issues, commits, and more in one conversation.</p>
    </div>
  </div>

  <h2 id="how-it-works">How it works</h2>
  <p>Publishing a collection to Cloudflare deploys a Frozen Ink Worker that exposes an MCP endpoint at <code>/mcp</code>. ChatGPT Desktop connects to this endpoint over HTTP + SSE and calls the same tools available to local MCP clients.</p>

  <p>The flow is:</p>
  <ol>
    <li>You sync your collections locally with <code>fink sync</code></li>
    <li>You publish to Cloudflare with <code>fink publish</code>, which uploads the data and deploys the Worker</li>
    <li>You add the <code>/mcp</code> URL in ChatGPT Desktop as an MCP connector</li>
    <li>ChatGPT calls tools against the cloud endpoint in any conversation</li>
  </ol>

  <div class="callout callout-info">
    <div class="callout-icon">ℹ️</div>
    <div class="callout-body">
      <strong>Why no local stdio for ChatGPT Desktop?</strong>
      <p>ChatGPT Desktop's MCP connector system uses HTTP-based remote connections and does not expose a stable local config file for stdio subprocess registration. The cloud MCP flow is the supported path for ChatGPT Desktop integration.</p>
    </div>
  </div>

  <h2 id="prerequisites">Prerequisites</h2>
  <ul>
    <li><strong>Frozen Ink CLI installed</strong> — verify with <code>fink --version</code>. Install via <code>npm install -g @vboctor/fink</code>.</li>
    <li><strong>Cloudflare account</strong> — free tier is sufficient. Sign up at <a href="https://cloudflare.com">cloudflare.com</a>.</li>
    <li><strong>Wrangler authenticated</strong> — run <code>wrangler login</code> to authenticate with your Cloudflare account.</li>
    <li><strong>At least one collection synced</strong> — check with <code>fink status</code>. See <a href="/docs/collections">Managing Collections</a> if you haven't set one up yet.</li>
    <li><strong>ChatGPT Desktop installed</strong> — with a plan that supports MCP connectors (check your plan's settings for a Connectors or Plugins section).</li>
  </ul>

  <h2 id="publish-collection">Publish your collection</h2>
  <p>Before connecting ChatGPT, publish your collection(s) to Cloudflare. The <code>fink publish</code> command creates a Cloudflare Worker, D1 database, and R2 bucket, then uploads your data:</p>

  <div class="steps">
    <div class="step">
      <div class="step-num">1</div>
      <div class="step-body">
        <h4>Sync your collection</h4>
        <pre><code>fink sync my-vault
fink status</code></pre>
      </div>
    </div>
    <div class="step">
      <div class="step-num">2</div>
      <div class="step-body">
        <h4>Publish to Cloudflare</h4>
        <pre><code>fink publish my-vault \
  <span class="flag">--password</span> your-secret-password \
  <span class="flag">--name</span> my-vault-pub</code></pre>
        <p>Choose a strong password — it's required to authenticate every MCP request. The <code>--name</code> becomes part of the deployment URL.</p>
      </div>
    </div>
    <div class="step">
      <div class="step-num">3</div>
      <div class="step-body">
        <h4>Note your deployment URL</h4>
        <p>After publishing, you'll see output like:</p>
        <pre><code>Deployed: https://my-vault-pub.my-account.workers.dev</code></pre>
        <p>Your MCP endpoint is:</p>
        <pre><code>https://my-vault-pub.my-account.workers.dev/mcp</code></pre>
      </div>
    </div>
  </div>

  <p>See <a href="/docs/publishing">Publishing to Cloudflare</a> for the full publishing guide, including multiple collections, updating content, and managing deployments.</p>

  <h2 id="connect-in-chatgpt">Connect in ChatGPT Desktop</h2>
  <p>Once your deployment is live, add it as an MCP connector in ChatGPT Desktop:</p>

  <div class="steps">
    <div class="step">
      <div class="step-num">1</div>
      <div class="step-body">
        <h4>Open Connectors settings</h4>
        <p>In ChatGPT Desktop, go to <strong>Settings → Connectors</strong> (the exact label may vary by version — look for "MCP", "Plugins", or "Connected Apps").</p>
      </div>
    </div>
    <div class="step">
      <div class="step-num">2</div>
      <div class="step-body">
        <h4>Add a new connector</h4>
        <p>Click <strong>Add</strong> or <strong>Connect new server</strong> and enter:</p>
        <ul>
          <li><strong>Name:</strong> Frozen Ink — My Vault (or any descriptive label)</li>
          <li><strong>URL:</strong> <code>https://my-vault-pub.my-account.workers.dev/mcp</code></li>
          <li><strong>Authentication:</strong> Bearer token — enter your deployment password</li>
        </ul>
      </div>
    </div>
    <div class="step">
      <div class="step-num">3</div>
      <div class="step-body">
        <h4>Save and enable</h4>
        <p>Save the connector and toggle it on. ChatGPT will connect to the endpoint and discover the available tools. You should see the Frozen Ink tools listed.</p>
      </div>
    </div>
    <div class="step">
      <div class="step-num">4</div>
      <div class="step-body">
        <h4>Start a conversation</h4>
        <p>Open a new chat. The Frozen Ink MCP connector is now active. Try: <em>"Search my knowledge base for anything about our API design"</em>.</p>
      </div>
    </div>
  </div>

  <h2 id="authentication">Authentication</h2>
  <p>The MCP endpoint accepts the deployment password in two forms:</p>

  <h3>Bearer token (recommended)</h3>
  <p>Pass the password as a Bearer token in the <code>Authorization</code> header — this is what ChatGPT Desktop uses when you enter the password in the connector settings:</p>
  <pre><code>Authorization: Bearer your-deployment-password</code></pre>

  <h3>Query parameter</h3>
  <p>If your ChatGPT configuration doesn't support custom headers, append the password as a query parameter:</p>
  <pre><code>https://my-vault-pub.my-account.workers.dev/mcp?token=your-deployment-password</code></pre>

  <div class="callout callout-warning">
    <div class="callout-icon">⚠️</div>
    <div class="callout-body">
      <strong>Keep your password private</strong>
      <p>The deployment password grants full read access to all collections in the deployment. Treat it like an API key — don't share it publicly or commit it to version control.</p>
    </div>
  </div>

  <h2 id="available-tools">Available MCP tools</h2>
  <p>The cloud MCP endpoint exposes the same tools as local connections, but searches across <em>all</em> collections in the deployment simultaneously:</p>

  <table>
    <thead>
      <tr><th>Tool</th><th>Description</th></tr>
    </thead>
    <tbody>
      <tr>
        <td><code>collection_list</code></td>
        <td>Lists all collections in the deployment with metadata.</td>
      </tr>
      <tr>
        <td><code>entity_search</code></td>
        <td>Full-text search across all entities in all published collections. Returns ranked results with entity IDs and snippets.</td>
      </tr>
      <tr>
        <td><code>entity_get_data</code></td>
        <td>Retrieves structured data for a specific entity (e.g. a GitHub issue's fields). Returns JSON.</td>
      </tr>
      <tr>
        <td><code>entity_get_markdown</code></td>
        <td>Retrieves rendered markdown for a specific entity — ideal for ChatGPT to read and reference.</td>
      </tr>
      <tr>
        <td><code>entity_get_attachment</code></td>
        <td>Retrieves a binary attachment (image, PDF, etc.) for a specific entity.</td>
      </tr>
    </tbody>
  </table>

  <h2 id="multiple-collections">Multiple collections</h2>
  <p>You can publish multiple collections into a single deployment. ChatGPT's <code>entity_search</code> will search across all of them:</p>
  <pre><code>fink publish my-vault my-project-issues architecture-notes \
  <span class="flag">--password</span> your-secret-password \
  <span class="flag">--name</span> team-kb</code></pre>

  <p>The single MCP endpoint <code>https://team-kb.my-account.workers.dev/mcp</code> then covers all three collections.</p>

  <p>Alternatively, create separate deployments with separate passwords for different audiences:</p>
  <pre><code><span class="cmt"># Personal notes — private</span>
fink publish my-vault <span class="flag">--password</span> private123 <span class="flag">--name</span> my-notes

<span class="cmt"># Team knowledge base — shared</span>
fink publish team-docs <span class="flag">--password</span> team456 <span class="flag">--name</span> team-kb</code></pre>

  <h2 id="update-content">Updating content</h2>
  <p>Published data is a snapshot. When your local collections change (new notes, synced issues, etc.), re-publish to update what ChatGPT sees:</p>
  <pre><code><span class="cmt"># Sync locally first</span>
fink sync my-vault

<span class="cmt"># Re-publish (same command as initial publish)</span>
fink publish my-vault \
  <span class="flag">--password</span> your-secret-password \
  <span class="flag">--name</span> my-vault-pub</code></pre>

  <p>After re-publishing, the next ChatGPT tool call will return the updated content. No changes to the ChatGPT connector configuration are needed.</p>

  <div class="callout callout-tip">
    <div class="callout-icon">💡</div>
    <div class="callout-body">
      <strong>Keep content fresh</strong>
      <p>Run <code>fink sync "*"</code> to pull the latest data, then re-publish whenever you need the latest content in ChatGPT.</p>
    </div>
  </div>

  <h2 id="troubleshooting">Troubleshooting</h2>

  <h3>ChatGPT can't connect to the MCP endpoint</h3>
  <p>Verify the deployment is live by opening the URL in a browser. A password prompt or JSON response indicates the Worker is running. If you get a 404 or error, re-publish:</p>
  <pre><code>fink publish my-vault --password your-secret-password --name my-vault-pub</code></pre>

  <h3>Authentication errors (401 Unauthorized)</h3>
  <p>Double-check the password you entered in ChatGPT Desktop matches the one you used with <code>--password</code> during publishing. Passwords are case-sensitive. You can change the password by re-publishing with a new value.</p>

  <h3>Stale or missing results</h3>
  <p>Sync locally and re-publish to refresh the data in the cloud deployment:</p>
  <pre><code>fink sync my-vault
fink publish my-vault --password your-secret-password --name my-vault-pub</code></pre>

  <h3>Connector doesn't appear in ChatGPT settings</h3>
  <p>MCP connector support in ChatGPT Desktop may require a specific plan tier. Check your OpenAI account's feature availability. The Frozen Ink MCP endpoint is fully compatible with any ChatGPT plan that supports remote MCP connectors.</p>

  <div class="docs-pagination">
    <a href="/docs/integrations/codex-cli" class="docs-pagination-card">
      <span class="docs-pagination-label">← Previous</span>
      <span class="docs-pagination-title">Codex CLI Integration</span>
    </a>
    <a href="/docs/reference/cli" class="docs-pagination-card next">
      <span class="docs-pagination-label">Next →</span>
      <span class="docs-pagination-title">CLI Reference</span>
    </a>
  </div>
  `,
});
