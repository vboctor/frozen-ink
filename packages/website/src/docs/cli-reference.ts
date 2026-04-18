import { renderDocsPage } from "./layout";

export const cliReferencePage = renderDocsPage({
  title: "CLI Reference",
  description:
    "Complete reference for all Frozen Ink CLI (fink) commands, options, and usage examples.",
  activePath: "/docs/reference/cli",
  canonicalPath: "/docs/reference/cli",
  section: "Reference",
  tocLinks: [
    { id: "overview", title: "Overview" },
    { id: "setup", title: "Setup" },
    { id: "cmd-init", title: "init", indent: true },
    { id: "collections", title: "Collections" },
    { id: "cmd-add", title: "add", indent: true },
    { id: "cmd-update", title: "update", indent: true },
    { id: "cmd-collections", title: "collections", indent: true },
    { id: "cmd-status", title: "status", indent: true },
    { id: "syncing", title: "Syncing & Indexing" },
    { id: "cmd-sync", title: "sync", indent: true },
    { id: "cmd-generate", title: "generate", indent: true },
    { id: "cmd-index", title: "index", indent: true },
    { id: "cmd-search", title: "search", indent: true },
    { id: "cmd-compact", title: "compact", indent: true },
    { id: "serving", title: "Serving & UI" },
    { id: "cmd-serve", title: "serve", indent: true },
    { id: "cmd-daemon", title: "daemon", indent: true },
    { id: "cmd-tui", title: "tui", indent: true },
    { id: "publishing", title: "Publishing" },
    { id: "cmd-publish", title: "publish", indent: true },
    { id: "cmd-unpublish", title: "unpublish", indent: true },
    { id: "cmd-clone", title: "clone", indent: true },
    { id: "cmd-pull", title: "pull", indent: true },
    { id: "mcp-commands", title: "MCP" },
    { id: "cmd-mcp", title: "mcp", indent: true },
    { id: "other", title: "Other" },
    { id: "cmd-config", title: "config", indent: true },
    { id: "cmd-tableplus", title: "tableplus", indent: true },
    { id: "cmd-vscode", title: "vscode", indent: true },
  ],
  content: `
  <div class="docs-breadcrumb">
    <a href="/docs">Docs</a>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
    <span>Reference</span>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
    <span>CLI Reference</span>
  </div>

  <h1 class="page-title">CLI Reference</h1>
  <p class="page-lead">Complete reference for all <code>fink</code> commands. Run <code>fink --help</code> or <code>fink &lt;command&gt; --help</code> for built-in usage information.</p>

  <h2 id="overview">Overview</h2>
  <p>The <code>fink</code> CLI is the primary interface to Frozen Ink. Running <code>fink</code> with no arguments launches the interactive TUI. All commands follow the pattern:</p>
  <pre><code>fink &lt;command&gt; [arguments] [options]</code></pre>

  <div class="callout callout-info">
    <div class="callout-icon">ℹ️</div>
    <div class="callout-body">
      <strong>Global options</strong>
      <p><code>--version</code> prints the current version. <code>--help</code> is available on every command and subcommand.</p>
    </div>
  </div>

  <!-- ===== Setup ===== -->
  <h2 id="setup">Setup</h2>

  <h3 id="cmd-init"><code>fink init</code></h3>
  <p>Initialize a new Frozen Ink home directory. Creates <code>~/.frozenink/</code> with default configuration, the collections directory, and the sites directory.</p>
  <pre><code>fink init</code></pre>
  <p>Safe to re-run — existing configuration is not overwritten.</p>

  <!-- ===== Collections ===== -->
  <h2 id="collections">Collections</h2>

  <h3 id="cmd-add"><code>fink add &lt;type&gt;</code></h3>
  <p>Add a new collection. The <code>type</code> argument specifies the data source connector.</p>

  <h4>Common options (all types)</h4>
  <table>
    <thead><tr><th>Option</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><code>--name &lt;key&gt;</code></td><td>Collection name (required). Alphanumeric, dashes, underscores.</td></tr>
      <tr><td><code>--title &lt;title&gt;</code></td><td>Display title for the collection</td></tr>
      <tr><td><code>--description &lt;text&gt;</code></td><td>Description of what this collection contains</td></tr>
      <tr><td><code>--token &lt;token&gt;</code></td><td>Authentication token (inline)</td></tr>
      <tr><td><code>--credentials &lt;name&gt;</code></td><td>Use a named credential set from <code>~/.frozenink/credentials.yml</code></td></tr>
    </tbody>
  </table>

  <h4>GitHub (<code>fink add github</code>)</h4>
  <pre><code>fink add github <span class="flag">--name</span> my-issues <span class="flag">--repo</span> owner/repo <span class="flag">--token</span> ghp_xxx</code></pre>
  <table>
    <thead><tr><th>Option</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><code>--repo &lt;owner/repo&gt;</code></td><td>Repository in owner/repo format (required)</td></tr>
      <tr><td><code>--max &lt;count&gt;</code></td><td>Maximum entities per type (issues and PRs independently)</td></tr>
      <tr><td><code>--max-issues &lt;count&gt;</code></td><td>Maximum issues to sync</td></tr>
      <tr><td><code>--max-prs &lt;count&gt;</code></td><td>Maximum pull requests to sync</td></tr>
      <tr><td><code>--open-only</code></td><td>Only sync open issues/PRs; closed items are deleted</td></tr>
    </tbody>
  </table>

  <h4>Obsidian (<code>fink add obsidian</code>)</h4>
  <pre><code>fink add obsidian <span class="flag">--name</span> my-vault <span class="flag">--path</span> ~/Documents/MyVault</code></pre>
  <table>
    <thead><tr><th>Option</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><code>--path &lt;path&gt;</code></td><td>Path to the Obsidian vault directory (required)</td></tr>
    </tbody>
  </table>

  <h4>Git (<code>fink add git</code>)</h4>
  <pre><code>fink add git <span class="flag">--name</span> my-repo <span class="flag">--path</span> ~/projects/my-project</code></pre>
  <table>
    <thead><tr><th>Option</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><code>--path &lt;path&gt;</code></td><td>Path to the Git repository (required)</td></tr>
      <tr><td><code>--include-diffs</code></td><td>Include full commit diffs in rendered markdown</td></tr>
    </tbody>
  </table>

  <h4>MantisHub (<code>fink add mantishub</code>)</h4>
  <pre><code>fink add mantishub <span class="flag">--name</span> my-bugs <span class="flag">--url</span> https://example.mantishub.io <span class="flag">--token</span> xxx <span class="flag">--project-name</span> MyProject</code></pre>
  <table>
    <thead><tr><th>Option</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><code>--url &lt;url&gt;</code></td><td>Base URL of the MantisHub instance (required)</td></tr>
      <tr><td><code>--project-name &lt;name&gt;</code></td><td>Project name</td></tr>
      <tr><td><code>--max &lt;count&gt;</code></td><td>Maximum entities to sync</td></tr>
      <tr><td><code>--sync-entities &lt;types&gt;</code></td><td>Comma-separated entity types: <code>issues,pages,users</code></td></tr>
    </tbody>
  </table>

  <h3 id="cmd-update"><code>fink update &lt;collection&gt;</code></h3>
  <p>Update the configuration of an existing collection. Accepts the same options as <code>fink add</code> for the relevant crawler type.</p>
  <pre><code>fink update my-vault <span class="flag">--path</span> ~/Documents/NewVaultLocation
fink update my-issues <span class="flag">--token</span> ghp_newToken</code></pre>

  <h3 id="cmd-collections"><code>fink collections &lt;subcommand&gt;</code></h3>
  <p>Manage collections with the following subcommands:</p>
  <table>
    <thead><tr><th>Subcommand</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><code>list</code></td><td>List all collections with type, status, and last sync time</td></tr>
      <tr><td><code>rename &lt;old&gt; &lt;new&gt;</code></td><td>Rename a collection</td></tr>
      <tr><td><code>enable &lt;name&gt;</code></td><td>Enable a disabled collection</td></tr>
      <tr><td><code>disable &lt;name&gt;</code></td><td>Disable a collection (excluded from <code>fink sync "*"</code>)</td></tr>
      <tr><td><code>remove &lt;name&gt;</code></td><td>Permanently delete a collection and all its local data</td></tr>
      <tr><td><code>update &lt;name&gt;</code></td><td>Update collection configuration (alias for <code>fink update</code>)</td></tr>
    </tbody>
  </table>

  <h3 id="cmd-status"><code>fink status</code></h3>
  <p>Show the status of all collections — entity counts, last sync time, enabled/disabled state, and publish status.</p>
  <pre><code>fink status</code></pre>

  <!-- ===== Syncing & Indexing ===== -->
  <h2 id="syncing">Syncing &amp; Indexing</h2>

  <h3 id="cmd-sync"><code>fink sync &lt;collection&gt;</code></h3>
  <p>Synchronize one or more collections with their data sources. Sync is incremental by default.</p>
  <pre><code><span class="cmt"># Sync a single collection</span>
fink sync my-vault

<span class="cmt"># Sync all enabled collections</span>
fink sync "*"</code></pre>
  <table>
    <thead><tr><th>Option</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><code>--full</code></td><td>Force a full sync (ignore cursor, re-fetch everything)</td></tr>
      <tr><td><code>--max &lt;count&gt;</code></td><td>Maximum entities to sync in this run</td></tr>
    </tbody>
  </table>

  <h3 id="cmd-generate"><code>fink generate &lt;collection&gt;</code></h3>
  <p>Regenerate markdown files from the database without re-syncing from the data source. Useful after changing theme settings or fixing rendering issues.</p>
  <pre><code>fink generate "*"</code></pre>

  <h3 id="cmd-index"><code>fink index &lt;collection&gt;</code></h3>
  <p>Rebuild the full-text search index and backlinks for one or more collections.</p>
  <pre><code>fink index "*"</code></pre>

  <h3 id="cmd-search"><code>fink search &lt;query&gt;</code></h3>
  <p>Search across all collections from the command line using full-text search.</p>
  <pre><code>fink search "authentication flow"</code></pre>

  <h3 id="cmd-compact"><code>fink compact &lt;collection&gt;</code></h3>
  <p>Compact the SQLite database for a collection, reclaiming disk space after deletions.</p>
  <pre><code>fink compact my-vault</code></pre>

  <!-- ===== Serving & UI ===== -->
  <h2 id="serving">Serving &amp; UI</h2>

  <h3 id="cmd-serve"><code>fink serve</code></h3>
  <p>Start the local web UI and API server. Opens the Frozen Ink browser interface at <a href="http://localhost:3000">http://localhost:3000</a>.</p>
  <pre><code>fink serve</code></pre>

  <h3 id="cmd-daemon"><code>fink daemon &lt;subcommand&gt;</code></h3>
  <p>Manage the background sync daemon.</p>
  <table>
    <thead><tr><th>Subcommand</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><code>start</code></td><td>Start the daemon (persists across terminal sessions)</td></tr>
      <tr><td><code>stop</code></td><td>Stop the running daemon</td></tr>
      <tr><td><code>status</code></td><td>Show daemon status and last sync times</td></tr>
    </tbody>
  </table>

  <h3 id="cmd-tui"><code>fink tui</code></h3>
  <p>Launch the interactive terminal UI. Provides keyboard-driven access to collections, sync, search, publish, and settings. Also launched by running <code>fink</code> with no arguments.</p>
  <pre><code>fink        <span class="cmt"># launches TUI by default</span>
fink tui    <span class="cmt"># explicit</span></code></pre>

  <!-- ===== Publishing ===== -->
  <h2 id="publishing">Publishing</h2>

  <h3 id="cmd-publish"><code>fink publish &lt;collections...&gt;</code></h3>
  <p>Publish one or more collections to Cloudflare as a password-protected website with remote MCP access. See <a href="/docs/publishing">Publishing</a> for the full guide.</p>
  <pre><code>fink publish my-vault <span class="flag">--password</span> secret123</code></pre>

  <h3 id="cmd-unpublish"><code>fink unpublish &lt;collection&gt;</code></h3>
  <p>Remove a published deployment from Cloudflare. Deletes the Worker, D1 database, and R2 bucket. Local data is unaffected.</p>
  <pre><code>fink unpublish my-vault</code></pre>

  <h3 id="cmd-clone"><code>fink clone &lt;url&gt;</code></h3>
  <p>Clone a published collection to your local machine. See <a href="/docs/clone-pull">Clone &amp; Pull</a> for details.</p>
  <pre><code>fink clone https://my-vault.example.workers.dev <span class="flag">--password</span> secret123</code></pre>
  <table>
    <thead><tr><th>Option</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><code>--name &lt;name&gt;</code></td><td>Local collection name (defaults to remote name)</td></tr>
      <tr><td><code>--password &lt;password&gt;</code></td><td>Password for the published site</td></tr>
      <tr><td><code>--dry-run</code></td><td>Preview without downloading</td></tr>
    </tbody>
  </table>

  <h3 id="cmd-pull"><code>fink pull &lt;collection&gt;</code></h3>
  <p>Pull updates from a remote published site into a cloned collection.</p>
  <pre><code>fink pull my-vault</code></pre>
  <table>
    <thead><tr><th>Option</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><code>--dry-run</code></td><td>Show what would change without applying</td></tr>
    </tbody>
  </table>

  <!-- ===== MCP ===== -->
  <h2 id="mcp-commands">MCP</h2>

  <h3 id="cmd-mcp"><code>fink mcp &lt;subcommand&gt;</code></h3>
  <p>Manage MCP (Model Context Protocol) server links for AI clients. See <a href="/docs/integrations/local-mcp">Local MCP Setup</a> for the full guide.</p>
  <table>
    <thead><tr><th>Subcommand</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><code>link &lt;client&gt; &lt;collection&gt;</code></td><td>Register a collection with an MCP client</td></tr>
      <tr><td><code>unlink &lt;client&gt; &lt;collection&gt;</code></td><td>Remove a collection from an MCP client</td></tr>
      <tr><td><code>status</code></td><td>Show which collections are linked to which clients</td></tr>
    </tbody>
  </table>

  <!-- ===== Other ===== -->
  <h2 id="other">Other</h2>

  <h3 id="cmd-config"><code>fink config &lt;subcommand&gt;</code></h3>
  <p>Manage app-level configuration stored in <code>~/.frozenink/frozenink.yml</code>. See <a href="/docs/reference/configuration">Configuration</a> for details.</p>
  <table>
    <thead><tr><th>Subcommand</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><code>get &lt;key&gt;</code></td><td>Get a config value (supports dot notation, e.g., <code>sync.interval</code>)</td></tr>
      <tr><td><code>set &lt;key&gt; &lt;value&gt;</code></td><td>Set a config value (auto-converts types)</td></tr>
      <tr><td><code>list</code></td><td>Show all configuration values</td></tr>
    </tbody>
  </table>

  <h3 id="cmd-tableplus"><code>fink tableplus &lt;collection&gt;</code></h3>
  <p>Open a collection's SQLite database in TablePlus for inspection and debugging.</p>
  <pre><code>fink tableplus my-vault</code></pre>

  <h3 id="cmd-vscode"><code>fink vscode &lt;collection&gt;</code></h3>
  <p>Open a collection's content directory in VS Code.</p>
  <pre><code>fink vscode my-vault</code></pre>

  <div class="docs-pagination">
    <a href="/docs/integrations/anythingllm" class="docs-pagination-card">
      <span class="docs-pagination-label">&larr; Previous</span>
      <span class="docs-pagination-title">AnythingLLM</span>
    </a>
    <a href="/docs/reference/configuration" class="docs-pagination-card next">
      <span class="docs-pagination-label">Next &rarr;</span>
      <span class="docs-pagination-title">Configuration</span>
    </a>
  </div>
  `,
});
