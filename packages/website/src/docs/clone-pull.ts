import { renderDocsPage } from "./layout";

export const clonePullPage = renderDocsPage({
  title: "Cloning",
  description:
    "Clone a published Frozen Ink collection to your machine and keep it up to date with fink sync.",
  activePath: "/docs/clone-pull",
  canonicalPath: "/docs/clone-pull",
  section: "Features",
  tocLinks: [
    { id: "overview", title: "Overview" },
    { id: "cloning", title: "Cloning a collection" },
    { id: "clone-options", title: "Clone options", indent: true },
    { id: "syncing", title: "Syncing updates" },
    { id: "sync-options", title: "Sync options", indent: true },
    { id: "how-it-works", title: "How it works" },
    { id: "example-workflow", title: "Example workflow" },
    { id: "differences", title: "Cloned vs. local collections" },
  ],
  content: `
  <div class="docs-breadcrumb">
    <a href="/docs">Docs</a>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
    <span>Features</span>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
    <span>Cloning</span>
  </div>

  <h1 class="page-title">Cloning</h1>
  <p class="page-lead">Published Frozen Ink collections can be cloned to another machine for local, offline access. Once cloned, use <code>fink sync</code> to fetch updates — no API tokens or source credentials needed.</p>

  <h2 id="overview">Overview</h2>
  <p>When you <a href="/docs/publishing">publish a collection</a> to Cloudflare, anyone with the URL and password can browse it in a browser. <strong>Cloning</strong> takes this a step further: it downloads the entire published collection to your local <code>~/.frozenink/</code> directory, creating a fully functional local copy you can search, browse, and query via MCP — just like a locally created collection.</p>

  <div class="feature-grid">
    <div class="feature-card">
      <div class="feature-card-icon">📥</div>
      <h4>Initial Clone</h4>
      <p>Clone a published collection with a single <code>fink clone</code> command. All entities, markdown, and attachments are downloaded automatically.</p>
    </div>
    <div class="feature-card">
      <div class="feature-card-icon">🔄</div>
      <h4>Incremental Updates</h4>
      <p><code>fink sync</code> fetches only what's changed — added, updated, or deleted entities — keeping your local copy in sync efficiently.</p>
    </div>
  </div>

  <h2 id="cloning">Cloning a collection</h2>
  <p>To clone a published collection, use the <code>fink clone</code> command with the published site URL:</p>

  <pre><code>fink clone https://my-vault.example.workers.dev \
  <span class="flag">--password</span> your-password</code></pre>

  <p>This will:</p>
  <ol>
    <li>Connect to the published site and fetch the collection manifest</li>
    <li>Download all entity data and insert it into a local SQLite database</li>
    <li>Generate markdown files locally using the same theme engine as <code>fink sync</code></li>
    <li>Download all attachments (images, files, etc.)</li>
    <li>Register the collection in your local <code>~/.frozenink/</code> directory</li>
  </ol>

  <p>The local collection name defaults to the remote collection name. To use a different name:</p>
  <pre><code>fink clone https://my-vault.example.workers.dev \
  <span class="flag">--name</span> team-vault \
  <span class="flag">--password</span> your-password</code></pre>

  <h3 id="clone-options">Clone options</h3>
  <table>
    <thead>
      <tr><th>Option</th><th>Description</th></tr>
    </thead>
    <tbody>
      <tr><td><code>--name &lt;name&gt;</code></td><td>Local collection name (defaults to remote collection name)</td></tr>
      <tr><td><code>--password &lt;password&gt;</code></td><td>Password for the published site</td></tr>
      <tr><td><code>--dry-run</code></td><td>Show what would be cloned without making any changes</td></tr>
    </tbody>
  </table>

  <h2 id="syncing">Syncing updates</h2>
  <p>After cloning, use <code>fink sync</code> to fetch any changes that have been published since your last clone or sync:</p>

  <pre><code>fink sync my-vault</code></pre>

  <p>The sync command compares your local data with the remote and applies only the differences:</p>
  <ul>
    <li><strong>Added entities</strong> — downloaded and inserted into the local database</li>
    <li><strong>Updated entities</strong> — local copies replaced with the newer version</li>
    <li><strong>Deleted entities</strong> — removed from the local database and filesystem</li>
  </ul>

  <p>If there are no changes, <code>fink sync</code> reports "Already up to date" and exits.</p>

  <p>Cloned collections work seamlessly with <code>fink sync "*"</code>, which syncs all collections — both local and cloned — in a single command.</p>

  <h3 id="sync-options">Sync options</h3>
  <table>
    <thead>
      <tr><th>Option</th><th>Description</th></tr>
    </thead>
    <tbody>
      <tr><td><code>--dry-run</code></td><td>Show what would change without applying updates</td></tr>
    </tbody>
  </table>

  <h2 id="example-workflow">Example workflow</h2>
  <p>A common use case: publish on a work machine, clone on a personal machine for offline access.</p>

  <pre><code><span class="cmt"># On your work machine — publish a collection</span>
fink sync my-github-issues
fink publish my-github-issues <span class="flag">--password</span> secret123

<span class="cmt"># On your personal machine — clone it</span>
fink clone https://my-github-issues.example.workers.dev \
  <span class="flag">--password</span> secret123

<span class="cmt"># Later — sync updates after the work machine re-syncs and re-publishes</span>
fink sync my-github-issues</code></pre>

  <div class="callout callout-info">
    <div class="callout-icon">ℹ️</div>
    <div class="callout-body">
      <strong>Re-publish to share updates</strong>
      <p>Cloned collections sync from the <em>published</em> version, not directly from the original source. To make new data available, sync locally and re-publish on the source machine: <code>fink sync my-collection && fink publish my-collection</code>.</p>
    </div>
  </div>

  <h2 id="differences">Cloned vs. local collections</h2>
  <p>Once cloned, a collection behaves like any other local collection — it shows up in <code>fink collections list</code>, can be searched, served, and connected to MCP clients. The key differences:</p>

  <table>
    <thead>
      <tr><th>Feature</th><th>Local collection</th><th>Cloned collection</th></tr>
    </thead>
    <tbody>
      <tr><td>Created with</td><td><code>fink add</code></td><td><code>fink clone</code></td></tr>
      <tr><td>Data source</td><td>Direct (GitHub API, local vault, etc.)</td><td>Published Frozen Ink site</td></tr>
      <tr><td>Update command</td><td><code>fink sync</code></td><td><code>fink sync</code></td></tr>
      <tr><td>Requires source credentials</td><td>Yes</td><td>No (only site password)</td></tr>
      <tr><td>Can be published</td><td>Yes</td><td>Yes</td></tr>
      <tr><td>MCP access</td><td>Yes</td><td>Yes</td></tr>
      <tr><td>Crawler type</td><td>github, obsidian, git, mantishub</td><td>remote</td></tr>
    </tbody>
  </table>

  <div class="docs-pagination">
    <a href="/docs/collections" class="docs-pagination-card">
      <span class="docs-pagination-label">&larr; Previous</span>
      <span class="docs-pagination-title">Managing Collections</span>
    </a>
    <a href="/docs/publishing" class="docs-pagination-card next">
      <span class="docs-pagination-label">Next &rarr;</span>
      <span class="docs-pagination-title">Publishing</span>
    </a>
  </div>
  `,
});
