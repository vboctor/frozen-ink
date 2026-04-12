import { renderDocsPage } from "./layout";

export const connectorGitPage = renderDocsPage({
  title: "Git Connector",
  description:
    "Sync a local Git repository's commit history, branches, and tags into Frozen Ink for search and AI queries.",
  activePath: "/docs/connectors/git",
  tocLinks: [
    { id: "overview", title: "Overview" },
    { id: "prerequisites", title: "Prerequisites" },
    { id: "add", title: "Adding a Git collection" },
    { id: "what-syncs", title: "What gets synced" },
    { id: "include-diffs", title: "Including diffs", indent: true },
    { id: "sync", title: "Syncing" },
    { id: "tips", title: "Tips & notes" },
  ],
  content: `
  <div class="docs-breadcrumb">
    <a href="/docs">Docs</a>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
    <a href="/docs/connectors/git">Connectors</a>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
    <span>Git</span>
  </div>

  <h1 class="page-title">Git Connector</h1>
  <p class="page-lead">The Git connector syncs commit history, branches, and tags from a local Git repository. It gives you a searchable, AI-accessible record of your project's history — useful for understanding what changed, when, and why.</p>

  <h2 id="overview">Overview</h2>
  <p>Each Git collection maps to one local repository. Commits are rendered as markdown with the commit message, author, date, and optionally the full diff. Branches and tags are indexed separately so you can browse the state of the repo at any point in history.</p>

  <h2 id="prerequisites">Prerequisites</h2>
  <p>A local Git repository — a directory containing a <code>.git/</code> folder. The repository does not need to have a remote; local-only repos work fine.</p>

  <h2 id="add">Adding a Git collection</h2>
  <pre><code>fink add git \
  <span class="flag">--name</span> my-repo \
  <span class="flag">--path</span> ~/projects/my-project</code></pre>

  <p>To include the full diff of each commit in the rendered output:</p>
  <pre><code>fink add git \
  <span class="flag">--name</span>           my-repo \
  <span class="flag">--path</span>           ~/projects/my-project \
  <span class="flag">--include-diffs</span></code></pre>

  <table>
    <thead><tr><th>Flag</th><th>Required</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><code>--name</code></td><td>Yes</td><td>Your name for this collection</td></tr>
      <tr><td><code>--path</code></td><td>Yes</td><td>Absolute path to the repository root (the directory containing <code>.git/</code>)</td></tr>
      <tr><td><code>--include-diffs</code></td><td>No</td><td>Include the full file diff for each commit in the rendered markdown</td></tr>
    </tbody>
  </table>

  <h2 id="what-syncs">What gets synced</h2>

  <h3>Commits</h3>
  <p>Every commit in the repository history becomes an entity. Each commit's rendered markdown includes:</p>
  <ul>
    <li>Commit hash (short and full)</li>
    <li>Author name and email</li>
    <li>Commit date and timezone</li>
    <li>Subject line and body</li>
    <li>Parent commit references</li>
    <li>List of changed files with their change type (added, modified, deleted, renamed)</li>
    <li>Full diff (if <code>--include-diffs</code> is enabled)</li>
  </ul>

  <h3>Branches</h3>
  <p>All local branches and remote tracking branches are indexed. Each branch record includes its name, the tip commit hash, and whether it's the current HEAD.</p>

  <h3>Tags</h3>
  <p>Both lightweight and annotated tags are indexed. Annotated tags include the tagger name, date, and tag message.</p>

  <h3 id="include-diffs">Including diffs</h3>
  <p>When <code>--include-diffs</code> is enabled, the full unified diff of each commit is included in the rendered markdown. This is valuable when you want Claude or a search query to find commits by what code they changed — not just by commit message.</p>

  <div class="callout callout-warning">
    <div class="callout-icon">⚠️</div>
    <div class="callout-body">
      <strong>Disk space with diffs enabled</strong>
      <p>On a repository with many large commits, enabling diffs significantly increases the size of the local database and markdown output. Use it selectively for repositories where code-level history search is important.</p>
    </div>
  </div>

  <h2 id="sync">Syncing</h2>
  <pre><code><span class="cmt"># Sync after new commits land</span>
fink sync my-repo

<span class="cmt"># Auto-sync via daemon</span>
fink daemon start</code></pre>

  <p>Sync is incremental — commits already in the index are not re-processed. New commits (since the last sync) are fetched and indexed on each run.</p>

  <h2 id="tips">Tips &amp; notes</h2>
  <ul>
    <li><strong>One collection per repo.</strong> Add a separate collection for each repository you want to index.</li>
    <li><strong>Remote not required.</strong> The connector reads from the local <code>.git/</code> directory only. Repos without a remote, or repos where you haven't fetched recently, work fine — you'll just see the local branch state.</li>
    <li><strong>Repo path changes.</strong> If you move the repository, update with <code>fink update my-repo --path /new/path</code>.</li>
    <li><strong>Toggle diffs later.</strong> You can enable or disable <code>--include-diffs</code> at any time by running <code>fink update my-repo --include-diffs</code> or <code>fink update my-repo --no-include-diffs</code>, then re-syncing.</li>
  </ul>

  <div class="docs-pagination">
    <a href="/docs/connectors/obsidian" class="docs-pagination-card">
      <span class="docs-pagination-label">← Previous</span>
      <span class="docs-pagination-title">Obsidian Connector</span>
    </a>
    <a href="/docs/connectors/mantisbt" class="docs-pagination-card next">
      <span class="docs-pagination-label">Next →</span>
      <span class="docs-pagination-title">MantisBT Connector</span>
    </a>
  </div>
  `,
});
