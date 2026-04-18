import { renderDocsPage } from "./layout";

export const connectorGithubPage = renderDocsPage({
  title: "GitHub Connector",
  description:
    "Sync GitHub issues and pull requests into Frozen Ink for offline access, full-text search, and AI queries.",
  activePath: "/docs/connectors/github",
  canonicalPath: "/docs/connectors/github",
  section: "Connectors",
  tocLinks: [
    { id: "overview", title: "Overview" },
    { id: "prerequisites", title: "Prerequisites" },
    { id: "add", title: "Adding a GitHub collection" },
    { id: "what-syncs", title: "What gets synced" },
    { id: "sync", title: "Syncing" },
    { id: "rate-limits", title: "Rate limits" },
    { id: "tips", title: "Tips & notes" },
  ],
  content: `
  <div class="docs-breadcrumb">
    <a href="/docs">Docs</a>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
    <a href="/docs/connectors/github">Connectors</a>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
    <span>GitHub</span>
  </div>

  <h1 class="page-title">GitHub Connector</h1>
  <p class="page-lead">The GitHub connector syncs issues and pull requests from a repository via the GitHub REST API. Once synced, they're available offline, full-text searchable, and queryable by AI assistants through MCP.</p>

  <h2 id="overview">Overview</h2>
  <p>Each GitHub collection maps to one repository. You can add as many collections as you like — one per repo, or one per organisation — each indexed independently.</p>

  <div class="feature-grid">
    <div class="feature-card">
      <div class="feature-card-icon">🐛</div>
      <h4>Issues</h4>
      <p>All open and closed issues with title, body, labels, milestone, assignees, comments, and timestamps.</p>
    </div>
    <div class="feature-card">
      <div class="feature-card-icon">🔀</div>
      <h4>Pull Requests</h4>
      <p>All open and merged PRs with the same fields, plus review status, linked issues, and file change summaries.</p>
    </div>
  </div>

  <h2 id="prerequisites">Prerequisites</h2>
  <p>You need a <strong>GitHub personal access token</strong>. Create one at <a href="https://github.com/settings/tokens">github.com/settings/tokens</a>.</p>
  <ul>
    <li><strong>Classic token</strong> — enable the <code>repo</code> scope (or <code>public_repo</code> for public repositories only)</li>
    <li><strong>Fine-grained token</strong> — grant <em>Issues: Read</em> and <em>Pull requests: Read</em> permissions on the target repository</li>
  </ul>

  <div class="callout callout-tip">
    <div class="callout-icon">💡</div>
    <div class="callout-body">
      <strong>One token, many collections</strong>
      <p>A single token can be used across multiple GitHub collections as long as it has access to each repository. Store it somewhere safe — it's saved in the collection's config file.</p>
    </div>
  </div>

  <h2 id="add">Adding a GitHub collection</h2>
  <pre><code>fink add github \
  <span class="flag">--name</span> my-issues \
  <span class="flag">--token</span> ghp_yourPersonalAccessToken \
  <span class="flag">--owner</span> your-org-or-username \
  <span class="flag">--repo</span> your-repository-name</code></pre>

  <table>
    <thead><tr><th>Flag</th><th>Required</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><code>--name</code></td><td>Yes</td><td>Your name for this collection, used in all subsequent commands</td></tr>
      <tr><td><code>--token</code></td><td>Yes*</td><td>GitHub personal access token</td></tr>
      <tr><td><code>--owner</code></td><td>Yes</td><td>Repository owner — an organisation name or GitHub username</td></tr>
      <tr><td><code>--repo</code></td><td>Yes</td><td>Repository name (without the owner prefix)</td></tr>
      <tr><td><code>--credentials</code></td><td>No</td><td>Use a named credential set from <code>credentials.yml</code> instead of <code>--token</code></td></tr>
      <tr><td><code>--max</code></td><td>No</td><td>Maximum entities per type (applies to both issues and PRs independently)</td></tr>
      <tr><td><code>--max-issues</code></td><td>No</td><td>Maximum issues to sync</td></tr>
      <tr><td><code>--max-prs</code></td><td>No</td><td>Maximum pull requests to sync</td></tr>
      <tr><td><code>--open-only</code></td><td>No</td><td>Only sync open issues and PRs; closed items are deleted from the local index</td></tr>
    </tbody>
  </table>

  <p>* Either <code>--token</code> or <code>--credentials</code> is required. See <a href="/docs/reference/configuration#credentials">Named credentials</a> for details on credential sets.</p>

  <h2 id="what-syncs">What gets synced</h2>
  <p>Each issue and pull request becomes an <em>entity</em> in Frozen Ink. The rendered markdown for each entity includes:</p>
  <ul>
    <li>Title, body, and state (open / closed / merged)</li>
    <li>Labels, milestone, and assignees</li>
    <li>All comments in chronological order</li>
    <li>Cross-references to linked issues and PRs</li>
    <li>Timestamps for creation, last update, and closure</li>
    <li>For PRs: review decisions, reviewer names, and a summary of changed files</li>
  </ul>
  <p>GitHub issue numbers are preserved, so searching for <code>#1234</code> in the quick switcher jumps directly to that issue.</p>

  <h2 id="sync">Syncing</h2>
  <pre><code><span class="cmt"># First sync (fetches everything)</span>
fink sync my-issues

<span class="cmt"># Subsequent syncs are incremental — only changed items are re-fetched</span>
fink sync my-issues

<span class="cmt"># Keep it fresh automatically with the background daemon</span>
fink daemon start</code></pre>

  <p>The first sync on a large repository may take several minutes. Subsequent syncs are fast — only issues and PRs updated since the last run are fetched.</p>

  <h2 id="rate-limits">Rate limits</h2>
  <p>The GitHub REST API allows <strong>5,000 authenticated requests per hour</strong>. A first sync on a repository with 2,000 issues uses roughly 100–200 requests. Incremental syncs typically use far fewer.</p>

  <div class="callout callout-warning">
    <div class="callout-icon">⚠️</div>
    <div class="callout-body">
      <strong>Very large repositories</strong>
      <p>Repositories with tens of thousands of issues may approach rate limit thresholds on first sync. If a sync is interrupted by a rate limit, simply run <code>fink sync</code> again after the limit resets — it will resume from where it left off.</p>
    </div>
  </div>

  <h2 id="tips">Tips &amp; notes</h2>
  <ul>
    <li><strong>One collection per repo.</strong> The GitHub connector connects to a single repository. To index multiple repos, add a separate collection for each.</li>
    <li><strong>From scattered sources to a single index.</strong> Combine GitHub issues with your Obsidian notes and Git commit history into one searchable index. Once synced, <code>fink search "payment flow"</code> finds matching issues, notes, and commits in a single query. See <a href="/docs/key-scenarios#multi-source-search">Multi-source search</a>.</li>
    <li><strong>Private repos are supported.</strong> As long as your token has access, private repositories work identically to public ones.</li>
    <li><strong>Deleted issues.</strong> GitHub's API does not surface deleted issues. If an issue is deleted on GitHub, it will remain in your local index until you remove and re-add the collection.</li>
    <li><strong>Token rotation.</strong> If you need to update the token, use <code>fink update my-issues --token ghp_newToken</code>.</li>
  </ul>

  <div class="docs-pagination">
    <span></span>
    <a href="/docs/connectors/obsidian" class="docs-pagination-card next">
      <span class="docs-pagination-label">Next →</span>
      <span class="docs-pagination-title">Obsidian Connector</span>
    </a>
  </div>
  `,
});
