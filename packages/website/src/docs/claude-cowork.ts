import { renderDocsPage } from "./layout";

export const claudeCoworkPage = renderDocsPage({
  title: "Claude Cowork Integration",
  description:
    "Give Claude Cowork access to your Frozen Ink knowledge base by sharing your local collections folder as a workspace folder.",
  activePath: "/docs/integrations/claude-cowork",
  canonicalPath: "/docs/integrations/claude-cowork",
  section: "AI Integrations",
  tocLinks: [
    { id: "overview", title: "Overview" },
    { id: "how-it-works", title: "How it works" },
    { id: "setup", title: "Setup" },
    { id: "what-claude-can-do", title: "What Claude can do" },
    { id: "keep-it-fresh", title: "Keeping content fresh" },
    { id: "collection-description", title: "Collection descriptions" },
  ],
  content: `
  <div class="docs-breadcrumb">
    <a href="/docs">Docs</a>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
    <span>AI Integrations</span>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
    <span>Claude Cowork</span>
  </div>

  <h1 class="page-title">Claude Cowork Integration</h1>
  <p class="page-lead">Claude Cowork is Anthropic's collaborative AI workspace that runs in the browser. It doesn't support stdio MCP connections, but you can give Claude access to your entire knowledge base by sharing your local Frozen Ink collections folder as a workspace folder.</p>

  <h2 id="overview">Overview</h2>
  <p>Claude Cowork can read files directly from your local filesystem when you share a folder with it. Frozen Ink stores all synced collection data as markdown files under <code>~/.frozenink/collections/</code> — one subfolder per collection. Sharing that directory with Cowork gives Claude access to every note, issue, commit, and document in your knowledge base.</p>

  <div class="feature-grid">
    <div class="feature-card">
      <div class="feature-card-icon">📁</div>
      <h4>No extra config</h4>
      <p>No MCP setup required. Just point Cowork at your collections folder. Any collection you've synced is immediately available to Claude.</p>
    </div>
    <div class="feature-card">
      <div class="feature-card-icon">🔒</div>
      <h4>Stays local</h4>
      <p>Files are read from your disk, not uploaded to a server. Cowork accesses them the same way it accesses any other folder you share.</p>
    </div>
    <div class="feature-card">
      <div class="feature-card-icon">🗂️</div>
      <h4>All sources at once</h4>
      <p>GitHub issues, Obsidian notes, Git commits, MantisHub tickets — all visible to Claude in the same session as soon as they're synced locally.</p>
    </div>
  </div>

  <h2 id="how-it-works">How it works</h2>
  <p>When Frozen Ink syncs a collection, it writes each entity as a markdown file into a subfolder:</p>
  <pre><code>~/.frozenink/collections/
  my-vault/           <span class="cmt"># Obsidian vault</span>
    note-one.md
    note-two.md
    ...
  backend-issues/     <span class="cmt"># GitHub issues</span>
    issue-1.md
    issue-2.md
    ...
  my-project/         <span class="cmt"># Git commits</span>
    commit-abc123.md
    ...</code></pre>

  <p>Claude Cowork reads these files as plain markdown, the same format Claude already understands. No special rendering or plugin is required.</p>

  <h2 id="setup">Setup</h2>

  <div class="steps">
    <div class="step">
      <div class="step-num">1</div>
      <div class="step-body">
        <h4>Sync your collections</h4>
        <pre><code>fink sync "*"
fink status</code></pre>
        <p>Make sure the collections you want Claude to see are synced. The markdown files in <code>~/.frozenink/collections/</code> are what Cowork will read.</p>
      </div>
    </div>
    <div class="step">
      <div class="step-num">2</div>
      <div class="step-body">
        <h4>Add the collections folder in Cowork</h4>
        <p>In Claude Cowork, open your workspace settings and add <code>~/.frozenink/collections/</code> as a shared folder. Claude can then read all synced collection files.</p>
      </div>
    </div>
    <div class="step">
      <div class="step-num">3</div>
      <div class="step-body">
        <h4>Start asking questions</h4>
        <p>In any Cowork conversation, Claude can now reference your collections. See <a href="#what-claude-can-do">examples below</a>.</p>
      </div>
    </div>
  </div>

  <h2 id="what-claude-can-do">What Claude can do</h2>
  <p>With the collections folder shared, you can ask Claude questions that span your entire knowledge base in a single conversation:</p>

  <ul>
    <li><em>"Check my notes for anything about the authentication redesign"</em></li>
    <li><em>"What open GitHub issues do I have tagged with 'performance'?"</em></li>
    <li><em>"Summarize recent commits that touched the payments module"</em></li>
    <li><em>"Find my meeting notes from the Q3 architecture review"</em></li>
    <li><em>"What does the runbook say about deploying to production?"</em></li>
  </ul>

  <p>Claude reads the markdown files directly and synthesizes answers from them — no MCP tool calls, no extra setup beyond the shared folder.</p>

  <h2 id="keep-it-fresh">Keeping content fresh</h2>
  <p>Cowork reads the files on disk at the time Claude accesses them. To ensure Claude sees up-to-date information, keep your collections synced:</p>

  <pre><code><span class="cmt"># One-shot sync of all collections</span>
fink sync "*"

<span class="cmt"># Auto-sync in the background (recommended)</span>
fink daemon start</code></pre>

  <div class="callout callout-tip">
    <div class="callout-icon">💡</div>
    <div class="callout-body">
      <strong>Run the daemon for always-fresh data</strong>
      <p><code>fink daemon start</code> syncs all collections on a configurable interval in the background. With the daemon running, the files in <code>~/.frozenink/collections/</code> stay current automatically — no manual sync needed before each Cowork session.</p>
    </div>
  </div>

  <h2 id="collection-description">Collection descriptions</h2>
  <p>Each collection folder contains a <code>_collection.md</code> file with metadata about the source — name, type, description, and sync status. Claude reads this automatically when you share the collections folder, which helps it understand what each subfolder contains and route your questions appropriately.</p>

  <p>Set a meaningful description when you create a collection so Claude knows what to look for:</p>
  <pre><code>fink add obsidian \
  <span class="flag">--name</span> my-vault \
  <span class="flag">--path</span> ~/Documents/MyVault \
  <span class="flag">--description</span> "Personal engineering notes: architecture decisions, meeting notes, and reference docs."</code></pre>

  <p>Or update an existing collection:</p>
  <pre><code>fink collections update my-vault \
  <span class="flag">--description</span> "Personal engineering notes: architecture decisions, meeting notes, and reference docs."</code></pre>

  <div class="docs-pagination">
    <a href="/docs/integrations/claude-code" class="docs-pagination-card">
      <span class="docs-pagination-label">← Previous</span>
      <span class="docs-pagination-title">Claude Code Integration</span>
    </a>
    <a href="/docs/integrations/claude-desktop" class="docs-pagination-card next">
      <span class="docs-pagination-label">Next →</span>
      <span class="docs-pagination-title">Claude Desktop Integration</span>
    </a>
  </div>
  `,
});
