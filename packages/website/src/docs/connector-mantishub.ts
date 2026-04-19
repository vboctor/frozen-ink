import { renderDocsPage } from "./layout";

export const connectorMantishubPage = renderDocsPage({
  title: "MantisHub Connector",
  description:
    "Sync MantisHub and MantisHub issues and attachments into Frozen Ink for offline access, search, and AI queries.",
  activePath: "/docs/connectors/mantishub",
  canonicalPath: "/docs/connectors/mantishub",
  section: "Connectors",
  tocLinks: [
    { id: "overview", title: "Overview" },
    { id: "prerequisites", title: "Prerequisites" },
    { id: "add", title: "Adding a MantisHub collection" },
    { id: "what-syncs", title: "What gets synced" },
    { id: "sync", title: "Syncing" },
    { id: "tips", title: "Tips & notes" },
  ],
  content: `
  <div class="docs-breadcrumb">
    <a href="/docs">Docs</a>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
    <a href="/docs/connectors/mantishub">Connectors</a>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
    <span>MantisHub</span>
  </div>

  <h1 class="page-title">MantisHub Connector</h1>
  <p class="page-lead">The MantisHub connector syncs issues and attachments from a MantisHub instance via the REST API. Use it for offline access, full-text search, AI queries, or to create a permanent archive before migrating away.</p>

  <h2 id="overview">Overview</h2>
  <p>Each MantisHub collection maps to one or more projects within a MantisHub instance. Issues are synced with all their fields, notes, and attachments.</p>

  <h2 id="prerequisites">Prerequisites</h2>

  <h3>API token</h3>
  <p><a href="https://support.mantishub.com/api/rest_api#creating-api-tokens" target="_blank">Create an API token in MantisHub</a>. The token must belong to a user with <em>viewer</em> access (or higher) to the project you want to sync.</p>

  <h3>Project(s)</h3>
  <p>Use the project name(s) or id(s) to specify which projects to sync.</p>

  <h2 id="add">Adding a MantisHub collection</h2>
  <pre><code>fink add mantishub \
  <span class="flag">--name</span> my-bugs \
  <span class="flag">--url</span> https://your-mantis-instance.com \
  <span class="flag">--token</span> your-api-token \
  <span class="flag">--project-id</span> 3</code></pre>

  <table>
    <thead><tr><th>Flag</th><th>Required</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><code>--name</code></td><td>Yes</td><td>Your name for this collection</td></tr>
      <tr><td><code>--url</code></td><td>Yes</td><td>Base URL of the MantisHub instance (no trailing slash)</td></tr>
      <tr><td><code>--token</code></td><td>Yes*</td><td>API token for authentication</td></tr>
      <tr><td><code>--project-name</code></td><td>No</td><td>Project name to sync</td></tr>
      <tr><td><code>--credentials</code></td><td>No</td><td>Use a named credential set from <code>credentials.yml</code> instead of <code>--token</code></td></tr>
      <tr><td><code>--max</code></td><td>No</td><td>Maximum entities to sync</td></tr>
      <tr><td><code>--sync-entities</code></td><td>No</td><td>Comma-separated entity types to sync: <code>issues,pages,users</code> (MantisHub) or <code>issues,users</code> (self-hosted)</td></tr>
    </tbody>
  </table>

  <p>* Either <code>--token</code> or <code>--credentials</code> is required. See <a href="/docs/reference/configuration#credentials">Named credentials</a> for details.</p>

  <h2 id="what-syncs">What gets synced</h2>
  <p>Each issue becomes an entity. The rendered markdown includes:</p>
  <ul>
    <li>Issue ID, summary, and description</li>
    <li>Status, resolution, priority, and severity</li>
    <li>Reporter, assigned-to, and other user fields</li>
    <li>Category, version, target version, and fixed-in version</li>
    <li>All issue notes (comments) in chronological order</li>
    <li>Tags</li>
    <li>Attachment metadata (filename, size, uploader) — attachments are downloaded and stored locally</li>
    <li>Timestamps for creation and last update</li>
  </ul>

  <h2 id="sync">Syncing</h2>
  <pre><code><span class="cmt"># Sync the collection</span>
fink sync my-bugs

<span class="cmt"># Keep in sync automatically</span></code></pre>

  <p>Sync is incremental — only issues updated since the last run are re-fetched. On first sync, all issues in the project are downloaded.</p>

  <h2 id="tips">Tips &amp; notes</h2>
  <ul>
    <li><strong>One collection per project.</strong> To sync multiple MantisHub projects, add a separate collection for each project ID.</li>
    <li><strong>Capture your data before you cancel.</strong> If you're migrating away from MantisHub or cancelling a subscription, sync everything first: <code>fink sync my-bugs</code>. Your entire issue history — every bug, note, and attachment — is preserved locally in a standard SQLite database. Export to static files, publish to Cloudflare for permanent access, or simply keep the local copy. See <a href="/docs/key-scenarios#archival">Historical archival</a> for the full workflow.</li>
    <li><strong>Create a collection for a project.</strong> An outsourcing firm that can share a collection that captures client projects during or at the end of such projects.</li>
    <li><strong>Token rotation.</strong> Update the token with <code>fink update my-bugs --token new-token</code>.</li>
    <li><strong>Firewall / VPN.</strong> For self-hosted MantisHub behind a VPN, ensure the machine running Frozen Ink can reach the instance URL before syncing.</li>
  </ul>

  <div class="docs-pagination">
    <a href="/docs/connectors/git" class="docs-pagination-card">
      <span class="docs-pagination-label">← Previous</span>
      <span class="docs-pagination-title">Git Connector</span>
    </a>
    <a href="/docs/connectors/rss" class="docs-pagination-card next">
      <span class="docs-pagination-label">Next →</span>
      <span class="docs-pagination-title">RSS Connector</span>
    </a>
  </div>
  `,
});
