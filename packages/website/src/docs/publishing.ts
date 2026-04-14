import { renderDocsPage } from "./layout";

export const publishingPage = renderDocsPage({
  title: "Publishing to Cloudflare",
  description:
    "Deploy Frozen Ink collections as a password-protected website on Cloudflare Workers with remote MCP access.",
  activePath: "/docs/publishing",
  tocLinks: [
    { id: "overview", title: "Overview" },
    { id: "prerequisites", title: "Prerequisites" },
    { id: "publish", title: "Publishing" },
    { id: "password-protection", title: "Password protection" },
    { id: "updating", title: "Updating content" },
    { id: "multiple-deployments", title: "Multiple deployments" },
    { id: "unpublishing", title: "Unpublishing" },
    { id: "what-runs-on-cloudflare", title: "What runs on Cloudflare" },
    { id: "desktop-publish", title: "Publishing from the desktop app" },
  ],
  content: `
  <div class="docs-breadcrumb">
    <a href="/docs">Docs</a>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
    <span>Publishing to Cloudflare</span>
  </div>

  <h1 class="page-title">Publishing to Cloudflare</h1>
  <p class="page-lead">Publish one or more Frozen Ink collections as a password-protected website on Cloudflare's global edge network. Published deployments include the full web UI, full-text search, and a remote MCP endpoint for cloud AI access — all in one command.</p>

  <h2 id="overview">Overview</h2>
  <p>Publishing takes your local collection data and uploads it to Cloudflare infrastructure:</p>
  <ul>
    <li><strong>Cloudflare Workers</strong> — serves the web UI and API endpoints at the edge</li>
    <li><strong>D1 (Cloudflare's managed SQLite)</strong> — stores your entity data and search index</li>
    <li><strong>R2 (Cloudflare's object storage)</strong> — stores attachments, images, and the bundled UI assets</li>
  </ul>
  <p>Once published, anyone with your URL and password can browse your collections from any browser, or query them via MCP from a cloud AI agent — without running Frozen Ink locally.</p>

  <div class="callout callout-info">
    <div class="callout-icon">💡</div>
    <div class="callout-body">
      <strong>Free tier friendly</strong>
      <p>Cloudflare's free tier is generous enough for personal and small team use: 100,000 Worker requests/day, 5 GB D1 storage, 10 GB R2 storage. Most Frozen Ink deployments fit comfortably within these limits.</p>
    </div>
  </div>

  <h2 id="prerequisites">Prerequisites</h2>

  <div class="steps">
    <div class="step">
      <div class="step-num">1</div>
      <div class="step-body">
        <h4>Cloudflare account</h4>
        <p>Create a free account at <a href="https://cloudflare.com">cloudflare.com</a>. You don't need to add a custom domain — Cloudflare automatically provides a <code>*.workers.dev</code> URL.</p>
      </div>
    </div>
    <div class="step">
      <div class="step-num">2</div>
      <div class="step-body">
        <h4>Install Wrangler</h4>
        <p>Wrangler is Cloudflare's CLI. Frozen Ink uses it internally for deployment:</p>
        <pre><code>npm install -g wrangler</code></pre>
      </div>
    </div>
    <div class="step">
      <div class="step-num">3</div>
      <div class="step-body">
        <h4>Authenticate Wrangler</h4>
        <p>Log in once — this opens a browser window to authorize Wrangler with your Cloudflare account:</p>
        <pre><code>wrangler login</code></pre>
        <p>Alternatively, set <code>CLOUDFLARE_API_TOKEN</code> in your environment for headless/CI use:</p>
        <pre><code>export CLOUDFLARE_API_TOKEN=your_token_here</code></pre>
      </div>
    </div>
    <div class="step">
      <div class="step-num">4</div>
      <div class="step-body">
        <h4>Sync your collections locally</h4>
        <p>Ensure your collections are synced before publishing — the local data is what gets uploaded:</p>
        <pre><code>fink sync "*"
fink status</code></pre>
      </div>
    </div>
  </div>

  <h2 id="publish">Publishing</h2>
  <p>The <code>fink publish</code> command uploads a collection to Cloudflare and deploys the Worker:</p>

  <pre><code><span class="cmt"># Publish a collection</span>
fink publish my-vault \
  <span class="flag">--password</span> your-secret-password</code></pre>

  <p>The collection name becomes the Cloudflare Worker name and part of your deployment URL:</p>
  <pre><code>https://my-vault.your-account.workers.dev</code></pre>

  <p>The publish command:</p>
  <ol>
    <li>Creates a D1 database and R2 bucket in your Cloudflare account (if they don't exist)</li>
    <li>Uploads all entity data and search indexes to D1</li>
    <li>Uploads attachments and UI assets to R2</li>
    <li>Deploys the Frozen Ink Worker to Cloudflare's edge</li>
    <li>Saves publish state in the collection's config file for future updates</li>
  </ol>

  <div class="callout callout-tip">
    <div class="callout-icon">⏱️</div>
    <div class="callout-body">
      <strong>First publish takes longer</strong>
      <p>The first publish creates all the Cloudflare resources and uploads all data. This can take 1–5 minutes depending on collection size. Subsequent publishes are incremental and much faster.</p>
    </div>
  </div>

  <h2 id="password-protection">Password protection</h2>
  <p>Every published deployment is protected by a password you set. Visitors see a login form before any content is visible. The password is stored as a hashed secret in your Cloudflare Worker's environment.</p>

  <div class="callout callout-important">
    <div class="callout-icon">🔒</div>
    <div class="callout-body">
      <strong>Choose a strong password</strong>
      <p>The published site is accessible to anyone on the internet with the URL. Use a password that's hard to guess and not reused elsewhere. Share it only with people who should have access.</p>
    </div>
  </div>

  <p>To change the password on an existing deployment, re-publish with the new password:</p>
  <pre><code>fink publish my-vault \
  <span class="flag">--password</span> new-stronger-password</code></pre>

  <h2 id="updating">Updating content</h2>
  <p>To push updated content to an existing deployment, sync locally first, then re-publish:</p>
  <pre><code><span class="cmt"># Pull latest data from source</span>
fink sync my-vault

<span class="cmt"># Re-upload to the existing deployment (updates D1 + R2 in-place)</span>
fink publish my-vault</code></pre>

  <p>The Worker URL stays the same. Your team members just reload the page to see updated content.</p>

  <h2 id="multiple-deployments">Multiple published collections</h2>
  <p>Each collection can be published independently. Each published collection gets its own Worker, D1 database, R2 bucket, URL, and password:</p>
  <pre><code><span class="cmt"># Personal vault — private</span>
fink publish my-vault <span class="flag">--password</span> personal123

<span class="cmt"># Team knowledge base — shared with team</span>
fink publish github-issues <span class="flag">--password</span> team456

<span class="cmt"># Public-facing archive — no sensitive content</span>
fink publish public-docs <span class="flag">--password</span> public789</code></pre>

  <p>View all your collections and their publish status:</p>
  <pre><code>fink collections list   <span class="cmt"># shows publish status per collection</span></code></pre>

  <h2 id="unpublishing">Unpublishing</h2>
  <p>Remove a deployment from Cloudflare completely:</p>
  <pre><code>fink unpublish my-vault</code></pre>
  <p>This deletes the Cloudflare Worker, D1 database, and R2 bucket for that collection's deployment. Your local data in <code>~/.frozenink/</code> is not affected.</p>

  <h2 id="what-runs-on-cloudflare">What runs on Cloudflare</h2>
  <p>The published deployment is a self-contained Cloudflare Worker that:</p>
  <ul>
    <li>Serves the same React web UI you use locally</li>
    <li>Provides the same browse API (<code>/api/collections</code>, <code>/api/search</code>, etc.)</li>
    <li>Exposes an MCP endpoint for cloud AI access (see <a href="/docs/cloud-mcp">Cloud MCP Access</a>)</li>
    <li>Enforces password authentication on every request</li>
    <li>Runs at Cloudflare's edge — fast from anywhere in the world</li>
  </ul>
  <p>Published deployments are <strong>read-only</strong> — they serve your synced data but don't pull new data from source systems. To update content, sync locally and re-publish.</p>

  <h2 id="desktop-publish">Publishing from the desktop app</h2>
  <p>The macOS desktop app provides a Publish panel that wraps all of the above into a GUI:</p>
  <ol>
    <li>Open the desktop app and navigate to a collection</li>
    <li>Click <strong>Publish</strong> in the left navigation</li>
    <li>Enter a deployment name and password</li>
    <li>Select which collections to include</li>
    <li>Click <strong>Publish</strong> and watch the progress bar</li>
  </ol>
  <p>The desktop app requires Wrangler to be installed and authenticated, just like the CLI.</p>

  <div class="docs-pagination">
    <a href="/docs/local-mcp" class="docs-pagination-card">
      <span class="docs-pagination-label">← Previous</span>
      <span class="docs-pagination-title">Local MCP Setup</span>
    </a>
    <a href="/docs/cloud-mcp" class="docs-pagination-card next">
      <span class="docs-pagination-label">Next →</span>
      <span class="docs-pagination-title">Cloud MCP Access</span>
    </a>
  </div>
  `,
});
