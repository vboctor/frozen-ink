import { renderDocsPage } from "./layout";

export const keyScenariosPage = renderDocsPage({
  title: "Key Scenarios",
  description:
    "Explore the most common Frozen Ink workflows: offline GitHub access, AI-ready context, team knowledge sharing, and more.",
  activePath: "/docs/key-scenarios",
  tocLinks: [
    { id: "offline-github", title: "Offline GitHub access" },
    { id: "obsidian-to-cloud", title: "Obsidian notes for cloud AI" },
    { id: "team-knowledge", title: "Team knowledge sharing" },
    { id: "local-ai", title: "Local AI assistant context" },
    { id: "multi-source-search", title: "Multi-source search" },
    { id: "archival", title: "Historical archival" },
  ],
  content: `
  <div class="docs-breadcrumb">
    <a href="/docs">Docs</a>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
    <span>Key Scenarios</span>
  </div>

  <h1 class="page-title">Key Scenarios</h1>
  <p class="page-lead">Frozen Ink is designed around a set of real-world knowledge workflows. Here are the scenarios it solves best — with the exact steps to set each one up.</p>

  <h2 id="offline-github">Offline GitHub access</h2>
  <p><strong>Situation:</strong> You work on a project hosted on GitHub. You want to read and reference issues and pull requests without a network connection — on a flight, in a coffee shop with bad Wi-Fi, or simply for faster local lookups.</p>

  <h3>Setup</h3>
  <div class="steps">
    <div class="step">
      <div class="step-num">1</div>
      <div class="step-body">
        <h4>Add the GitHub collection</h4>
        <p>Create a personal access token in <a href="https://github.com/settings/tokens">GitHub Settings</a> with <code>repo:read</code> scope, then add the collection:</p>
        <pre><code>fink add github <span class="flag">--name</span> my-project-issues \
  <span class="flag">--token</span> ghp_yourToken \
  <span class="flag">--owner</span> your-org \
  <span class="flag">--repo</span>  your-repo</code></pre>
      </div>
    </div>
    <div class="step">
      <div class="step-num">2</div>
      <div class="step-body">
        <h4>Sync the collection</h4>
        <pre><code>fink sync my-project-issues</code></pre>
        <p>Frozen Ink fetches all issues and pull requests, renders them as markdown, and builds the full-text search index. On a large repo this may take a few minutes on first sync — subsequent syncs are incremental.</p>
      </div>
    </div>
    <div class="step">
      <div class="step-num">3</div>
      <div class="step-body">
        <h4>Schedule automatic syncs</h4>
        <p>Start the background daemon so your local copy stays fresh automatically:</p>
        <pre><code>fink daemon start</code></pre>
        <p>The daemon runs in the background and syncs collections on their configured interval (default: every 30 minutes).</p>
      </div>
    </div>
    <div class="step">
      <div class="step-num">4</div>
      <div class="step-body">
        <h4>Browse offline</h4>
        <p>Run <code>fink serve</code> and open <a href="http://localhost:3000">http://localhost:3000</a>. Your issues and PRs are now browsable, searchable, and available even when GitHub is unreachable.</p>
      </div>
    </div>
  </div>

  <div class="callout callout-tip">
    <div class="callout-icon">💡</div>
    <div class="callout-body">
      <strong>Search by issue number</strong>
      <p>GitHub issue numbers are preserved in the rendered markdown, so you can type <code>#1234</code> in the quick switcher to jump directly to an issue.</p>
    </div>
  </div>

  <h2 id="obsidian-to-cloud">Obsidian notes for cloud AI</h2>
  <p><strong>Situation:</strong> Your Obsidian vault contains architectural decisions, runbooks, and reference notes built up over years. You want Claude or another cloud AI to have access to this context without uploading sensitive notes to a third-party service.</p>

  <h3>Setup</h3>
  <div class="steps">
    <div class="step">
      <div class="step-num">1</div>
      <div class="step-body">
        <h4>Add your Obsidian vault</h4>
        <pre><code>fink add obsidian <span class="flag">--name</span> my-vault <span class="flag">--path</span> ~/Documents/MyVault</code></pre>
      </div>
    </div>
    <div class="step">
      <div class="step-num">2</div>
      <div class="step-body">
        <h4>Sync and verify</h4>
        <pre><code>fink sync my-vault
fink status</code></pre>
      </div>
    </div>
    <div class="step">
      <div class="step-num">3</div>
      <div class="step-body">
        <h4>Option A — Local MCP (private, zero-upload)</h4>
        <p>Link the collection to Claude Code so it can query your notes locally, with no data leaving your machine:</p>
        <pre><code>fink mcp add --tool claude-code my-vault</code></pre>
        <p>See <a href="/docs/local-mcp">Local MCP Setup</a> for the full configuration guide.</p>
      </div>
    </div>
    <div class="step">
      <div class="step-num">4</div>
      <div class="step-body">
        <h4>Option B — Publish for cloud AI access</h4>
        <p>Publish the vault to Cloudflare so any AI agent with your password can query it remotely:</p>
        <pre><code>fink publish my-vault <span class="flag">--password</span> secret123 <span class="flag">--name</span> my-vault-pub</code></pre>
        <p>See <a href="/docs/cloud-mcp">Cloud MCP Access</a> for how to wire this up in Claude.</p>
      </div>
    </div>
  </div>

  <h2 id="team-knowledge">Team knowledge sharing</h2>
  <p><strong>Situation:</strong> Your team maintains notes, architecture docs, and internal references in Obsidian or a private GitHub repo. You want to share this with the full team without requiring everyone to install Frozen Ink locally.</p>

  <p>Publish the relevant collections to Cloudflare once. Everyone on the team gets a password-protected URL they can browse in any browser:</p>
  <pre><code><span class="cmt"># Publish multiple collections to one deployment</span>
fink publish architecture-notes github-issues internal-docs \
  <span class="flag">--password</span> team-secret \
  <span class="flag">--name</span>     team-knowledge</code></pre>

  <p>The published site has:</p>
  <ul>
    <li>Full-text search across all published collections</li>
    <li>The same web UI everyone gets locally</li>
    <li>Password protection — a login form before any content is visible</li>
    <li>An MCP endpoint so cloud AI agents can query it too</li>
  </ul>

  <p>To update when content changes, re-sync locally and re-publish with the same <code>--name</code>:</p>
  <pre><code>fink sync "*"
fink publish architecture-notes github-issues internal-docs \
  <span class="flag">--password</span> team-secret <span class="flag">--name</span> team-knowledge</code></pre>

  <h2 id="local-ai">Local AI assistant context</h2>
  <p><strong>Situation:</strong> You use Claude Code for software development. When working on a feature, you want Claude to have instant access to your project's GitHub issues, git history, and design notes — without manually pasting content into every conversation.</p>

  <p>Link all relevant collections to Claude Code:</p>
  <pre><code>fink mcp add <span class="flag">--tool</span> claude-code my-project-issues my-repo my-vault</code></pre>

  <p>Now, in any Claude Code session, Claude can:</p>
  <ul>
    <li>Search your GitHub issues: <em>"Find all open issues related to the payment flow"</em></li>
    <li>Read specific entities: <em>"Show me the details of issue #247"</em></li>
    <li>Browse your notes: <em>"What does my architecture doc say about the database layer?"</em></li>
    <li>Search git history: <em>"Find commits that changed the authentication module"</em></li>
  </ul>

  <div class="callout callout-info">
    <div class="callout-icon">ℹ️</div>
    <div class="callout-body">
      <strong>No manual server management</strong>
      <p>Claude Code launches the MCP server automatically via stdio when it needs to query a collection. You don't need to run <code>fink serve</code> beforehand — the MCP link handles everything.</p>
    </div>
  </div>

  <h2 id="multi-source-search">Multi-source search</h2>
  <p><strong>Situation:</strong> You're debugging a production issue. The relevant context is spread across GitHub (the related PR), your Obsidian vault (a runbook you wrote last year), and your Git log (the commits that introduced the change). You want to search all of these in one query.</p>

  <p>Once all three are synced, Frozen Ink's full-text search covers them all simultaneously:</p>
  <pre><code><span class="cmt"># CLI search</span>
fink search "payment gateway timeout"

<span class="cmt"># Or use Cmd+P in the web UI — searches across all collections at once</span></code></pre>

  <p>Results are ranked by relevance and labeled with their collection, so you immediately know whether you're looking at a GitHub issue, an Obsidian note, or a Git commit.</p>

  <h2 id="archival">Historical archival</h2>
  <p><strong>Situation:</strong> Your team is migrating away from MantisBT to a new bug tracker. You want to preserve a complete, searchable record of all historical issues before decommissioning the old system.</p>

  <div class="steps">
    <div class="step">
      <div class="step-num">1</div>
      <div class="step-body">
        <h4>Sync one final time</h4>
        <pre><code>fink sync my-mantis-archive</code></pre>
      </div>
    </div>
    <div class="step">
      <div class="step-num">2</div>
      <div class="step-body">
        <h4>Export as static files</h4>
        <p>Export the entire collection as standalone markdown or HTML files that need no server to read:</p>
        <pre><code><span class="cmt"># Markdown export</span>
curl -X POST http://localhost:3000/api/export \
  -H 'Content-Type: application/json' \
  -d '{"collections": ["my-mantis-archive"], "outputDir": "/tmp/archive", "format": "markdown"}'

<span class="cmt"># HTML export (fully navigable static site)</span>
curl -X POST http://localhost:3000/api/export \
  -H 'Content-Type: application/json' \
  -d '{"collections": ["my-mantis-archive"], "outputDir": "/tmp/archive-html", "format": "html"}'</code></pre>
      </div>
    </div>
    <div class="step">
      <div class="step-num">3</div>
      <div class="step-body">
        <h4>Publish for permanent access</h4>
        <p>Optionally publish to Cloudflare for a permanent, shareable URL that the whole team can bookmark:</p>
        <pre><code>fink publish my-mantis-archive <span class="flag">--password</span> archive-pw <span class="flag">--name</span> mantis-history</code></pre>
      </div>
    </div>
  </div>

  <div class="callout callout-tip">
    <div class="callout-icon">📦</div>
    <div class="callout-body">
      <strong>The SQLite file is self-contained</strong>
      <p>The database at <code>~/.frozenink/collections/my-mantis-archive/db/data.db</code> is a standard SQLite file. Back it up like any file. It can be opened with any SQLite browser and contains the complete dataset indefinitely.</p>
    </div>
  </div>

  <div class="docs-pagination">
    <a href="/docs/what-is-frozen-ink" class="docs-pagination-card">
      <span class="docs-pagination-label">← Previous</span>
      <span class="docs-pagination-title">What is Frozen Ink</span>
    </a>
    <a href="/docs/managing-collections" class="docs-pagination-card next">
      <span class="docs-pagination-label">Next →</span>
      <span class="docs-pagination-title">Managing Collections</span>
    </a>
  </div>
  `,
});
