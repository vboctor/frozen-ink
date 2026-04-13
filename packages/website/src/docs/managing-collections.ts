import { renderDocsPage } from "./layout";

export const managingCollectionsPage = renderDocsPage({
  title: "Managing Collections",
  description:
    "Add, configure, sync, update, and remove Frozen Ink collections across GitHub, Obsidian, Git, and MantisHub sources.",
  activePath: "/docs/managing-collections",
  tocLinks: [
    { id: "what-is-a-collection", title: "What is a collection" },
    { id: "add-github", title: "GitHub collection" },
    { id: "add-obsidian", title: "Obsidian collection" },
    { id: "add-git", title: "Git collection" },
    { id: "add-mantishub", title: "MantisHub collection" },
    { id: "syncing", title: "Syncing" },
    { id: "daemon", title: "Background daemon" },
    { id: "updating", title: "Updating a collection" },
    { id: "listing-removing", title: "Listing & removing" },
    { id: "config-file", title: "Configuration file" },
    { id: "tui", title: "Using the TUI" },
  ],
  content: `
  <div class="docs-breadcrumb">
    <a href="/docs">Docs</a>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
    <span>Managing Collections</span>
  </div>

  <h1 class="page-title">Managing Collections</h1>
  <p class="page-lead">Collections are the building blocks of Frozen Ink. Each collection connects to one data source and stores a synchronized, searchable snapshot of its content. This guide covers every aspect of creating and maintaining them.</p>

  <h2 id="what-is-a-collection">What is a collection</h2>
  <p>A collection is a named, typed connection to one external data source. Each collection has:</p>
  <ul>
    <li>A <strong>name</strong> — your identifier, used in all CLI commands (e.g., <code>my-vault</code>)</li>
    <li>A <strong>type</strong> — one of <code>github</code>, <code>obsidian</code>, <code>git</code>, <code>mantishub</code></li>
    <li>Source-specific <strong>configuration</strong> — paths, tokens, repository names, etc.</li>
    <li>A <strong>directory</strong> at <code>~/.frozenink/collections/&lt;name&gt;/</code> containing:
      <ul>
        <li><code>&lt;name&gt;.yml</code> — collection config and crawler credentials</li>
        <li><code>db/data.db</code> — SQLite database with all synced entities</li>
        <li><code>markdown/</code> — rendered markdown files</li>
        <li><code>attachments/</code> — binary assets (images, PDFs, etc.)</li>
      </ul>
    </li>
  </ul>
  <p>Collections are independent of each other — syncing, disabling, or removing one has no effect on the others.</p>

  <h2 id="add-github">GitHub collection</h2>
  <p>A GitHub collection syncs <strong>issues and pull requests</strong> from one repository via the GitHub REST API.</p>

  <h3>Prerequisites</h3>
  <p>Create a <strong>personal access token</strong> at <a href="https://github.com/settings/tokens">github.com/settings/tokens</a>. The token needs the <code>repo</code> scope (or <code>public_repo</code> for public repositories). Classic tokens and fine-grained tokens both work.</p>

  <h3>Add the collection</h3>
  <pre><code>fink add github \
  <span class="flag">--name</span>  my-issues \
  <span class="flag">--token</span> ghp_yourPersonalAccessToken \
  <span class="flag">--owner</span> your-org-or-username \
  <span class="flag">--repo</span>  your-repository-name</code></pre>

  <p><strong>What gets synced:</strong></p>
  <ul>
    <li>All issues (open and closed) with title, body, labels, milestone, assignees, comments, and timestamps</li>
    <li>All pull requests with the same fields, plus review status, linked issues, and file diff summaries</li>
    <li>Inline code references and linked URLs are preserved in the rendered markdown</li>
  </ul>

  <div class="callout callout-warning">
    <div class="callout-icon">⚠️</div>
    <div class="callout-body">
      <strong>API rate limits</strong>
      <p>The GitHub REST API allows 5,000 requests/hour for authenticated users. On a large repository (1,000+ issues), the first sync may use a significant portion of your quota. Subsequent incremental syncs are much lighter.</p>
    </div>
  </div>

  <h2 id="add-obsidian">Obsidian collection</h2>
  <p>An Obsidian collection syncs <strong>all markdown notes and attachments</strong> from a local Obsidian vault directory.</p>

  <pre><code>fink add obsidian \
  <span class="flag">--name</span> my-vault \
  <span class="flag">--path</span> ~/Documents/MyVault</code></pre>

  <p><strong>What gets synced:</strong></p>
  <ul>
    <li>All <code>.md</code> files, preserving folder structure</li>
    <li>Obsidian wiki-links (<code>[[note]]</code>) converted to standard markdown links</li>
    <li>Callout blocks (<code>&gt; [!NOTE]</code>) rendered as styled callouts in the web UI</li>
    <li>Embedded images and attachments (<code>![[image.png]]</code>) — viewable in the web UI</li>
    <li>YAML frontmatter preserved and displayed as metadata</li>
    <li>Backlinks automatically computed (shown in the right panel in the web UI)</li>
  </ul>

  <div class="callout callout-info">
    <div class="callout-icon">ℹ️</div>
    <div class="callout-body">
      <strong>Vault path tips</strong>
      <p>Point <code>--path</code> at the root of your Obsidian vault (the directory that contains your <code>.obsidian/</code> config folder). Subdirectories and nested folders are included automatically.</p>
    </div>
  </div>

  <h2 id="add-git">Git collection</h2>
  <p>A Git collection syncs <strong>commits, branches, and tags</strong> from a local Git repository.</p>

  <pre><code>fink add git \
  <span class="flag">--name</span> my-repo \
  <span class="flag">--path</span> ~/projects/my-project</code></pre>

  <p>To include the full diff of each commit in the rendered markdown (useful for code review history):</p>
  <pre><code>fink add git \
  <span class="flag">--name</span>           my-repo \
  <span class="flag">--path</span>           ~/projects/my-project \
  <span class="flag">--include-diffs</span></code></pre>

  <p><strong>What gets synced:</strong></p>
  <ul>
    <li>Every commit with hash, author, date, subject, and body</li>
    <li>All local branches and remote tracking branches</li>
    <li>All tags (annotated and lightweight)</li>
    <li>Full diffs per commit (optional, adds file size)</li>
  </ul>

  <div class="callout callout-warning">
    <div class="callout-icon">⚠️</div>
    <div class="callout-body">
      <strong>Disk space with diffs enabled</strong>
      <p>Enabling <code>--include-diffs</code> on a large repository with many commits can significantly increase the database and markdown output size. Use it selectively for repositories where diff history is important.</p>
    </div>
  </div>

  <h2 id="add-mantishub">MantisHub collection</h2>
  <p>A MantisHub collection syncs <strong>issues and attachments</strong> from a MantisHub or MantisHub instance via the REST API.</p>

  <pre><code>fink add mantishub \
  <span class="flag">--name</span>       my-bugs \
  <span class="flag">--url</span>        https://your-mantis-instance.com \
  <span class="flag">--token</span>      your-api-token \
  <span class="flag">--project-id</span> 1</code></pre>

  <p>Find your API token in MantisHub under <strong>My Account → API Tokens</strong>. The project ID is visible in the URL when you navigate to the project in the MantisHub web interface.</p>

  <h2 id="syncing">Syncing</h2>
  <p>Syncing fetches the latest data from a collection's source and updates the local index:</p>

  <pre><code><span class="cmt"># Sync a single collection</span>
fink sync my-vault

<span class="cmt"># Sync all collections</span>
fink sync "*"

<span class="cmt"># Check sync status for all collections</span>
fink status</code></pre>

  <p>Sync is <strong>incremental by default</strong> — only records that have changed since the last sync are processed. On first sync, all records are fetched.</p>

  <p>If you need to rebuild markdown output without re-fetching from the source (useful after updating templates or fixing a rendering bug):</p>
  <pre><code><span class="cmt"># Regenerate markdown without re-syncing</span>
fink generate "*"

<span class="cmt"># Rebuild just the search index and backlinks</span>
fink index "*"</code></pre>

  <h2 id="daemon">Background daemon</h2>
  <p>The Frozen Ink daemon runs as a background process and syncs collections automatically on their configured interval (default: 30 minutes).</p>

  <pre><code><span class="cmt"># Start the daemon (persists across terminal sessions)</span>
fink daemon start

<span class="cmt"># Check daemon status and last sync times</span>
fink daemon status

<span class="cmt"># Stop the daemon</span>
fink daemon stop</code></pre>

  <p>The daemon's PID file and logs are stored in <code>~/.frozenink/daemon/</code>.</p>

  <div class="callout callout-tip">
    <div class="callout-icon">💡</div>
    <div class="callout-body">
      <strong>Daemon on macOS startup</strong>
      <p>The macOS desktop app starts the daemon automatically and manages it through the system tray. If you're using the CLI only, add <code>fink daemon start</code> to your shell profile to have it start on login.</p>
    </div>
  </div>

  <h2 id="updating">Updating a collection</h2>
  <p>To change the configuration of an existing collection (for example, to update a GitHub token or change a vault path):</p>
  <pre><code><span class="cmt"># Update a collection's configuration</span>
fink update my-vault <span class="flag">--path</span> ~/Documents/NewVaultLocation

<span class="cmt"># Or use the subcommand form</span>
fink collections update my-vault <span class="flag">--token</span> ghp_newToken</code></pre>

  <p>Rename a collection (updates the name used in all CLI commands):</p>
  <pre><code>fink collections rename my-vault personal-notes</code></pre>

  <p>Temporarily disable a collection without deleting it (stops it from being included in <code>fink sync "*"</code>):</p>
  <pre><code>fink collections disable my-vault

<span class="cmt"># Re-enable later</span>
fink collections enable my-vault</code></pre>

  <h2 id="listing-removing">Listing &amp; removing</h2>
  <pre><code><span class="cmt"># List all collections with their type, status, and last sync time</span>
fink collections list

<span class="cmt"># Remove a collection (keeps the source data; deletes local DB and markdown)</span>
fink collections remove my-vault</code></pre>

  <div class="callout callout-important">
    <div class="callout-icon">🚨</div>
    <div class="callout-body">
      <strong>Removal is permanent</strong>
      <p><code>fink collections remove</code> deletes the entire <code>~/.frozenink/collections/&lt;name&gt;/</code> directory — the SQLite database, rendered markdown, and attachments. The original source data (your Obsidian vault, GitHub repo, etc.) is never touched. Back up the directory first if you may need to restore it.</p>
    </div>
  </div>

  <h2 id="config-file">Configuration files</h2>
  <p>Frozen Ink stores its configuration across two locations:</p>
  <ul>
    <li><strong><code>~/.frozenink/frozenink.yml</code></strong> — app-level settings (sync interval, UI port)</li>
    <li><strong><code>~/.frozenink/collections/&lt;name&gt;/&lt;name&gt;.yml</code></strong> — per-collection config and crawler credentials, written by <code>fink add</code> and <code>fink update</code></li>
  </ul>
  <p>You can view and edit app settings with:</p>
  <pre><code>fink config list
fink config get sync.interval
fink config set sync.interval 60   <span class="cmt"># minutes</span></code></pre>

  <h2 id="tui">Using the TUI</h2>
  <p>The interactive terminal UI provides a keyboard-driven interface to all collection management features:</p>
  <pre><code>fink     <span class="cmt"># or: fink tui</span></code></pre>
  <p>Navigate to the <strong>Collections</strong> screen to add, edit, sync, or remove collections. Within a collection, press <kbd>m</kbd> to open the MCP configuration panel.</p>

  <table>
    <thead>
      <tr><th>Key</th><th>Action</th></tr>
    </thead>
    <tbody>
      <tr><td><kbd>↑</kbd> / <kbd>↓</kbd></td><td>Select collection</td></tr>
      <tr><td><kbd>Enter</kbd></td><td>Open collection details</td></tr>
      <tr><td><kbd>s</kbd></td><td>Sync selected collection</td></tr>
      <tr><td><kbd>m</kbd></td><td>Open MCP config for collection</td></tr>
      <tr><td><kbd>d</kbd></td><td>Delete selected collection</td></tr>
      <tr><td><kbd>q</kbd></td><td>Go back / quit</td></tr>
    </tbody>
  </table>

  <div class="docs-pagination">
    <a href="/docs/key-scenarios" class="docs-pagination-card">
      <span class="docs-pagination-label">← Previous</span>
      <span class="docs-pagination-title">Key Scenarios</span>
    </a>
    <a href="/docs/claude-code" class="docs-pagination-card next">
      <span class="docs-pagination-label">Next →</span>
      <span class="docs-pagination-title">Claude Code Integration</span>
    </a>
  </div>
  `,
});
