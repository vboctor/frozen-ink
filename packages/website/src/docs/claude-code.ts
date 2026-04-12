import { renderDocsPage } from "./layout";

export const claudeCodePage = renderDocsPage({
  title: "Claude Code Integration",
  description:
    "Add collection folders and browse your knowledge base from Claude Code, the desktop app, or the terminal TUI.",
  activePath: "/docs/claude-code",
  tocLinks: [
    { id: "overview", title: "Overview" },
    { id: "add-collection-folder", title: "Add a collection folder" },
    { id: "obsidian-vault", title: "Obsidian vault", indent: true },
    { id: "git-repo", title: "Git repository", indent: true },
    { id: "sync-and-serve", title: "Sync & serve" },
    { id: "browsing-in-claude", title: "Browsing in Claude Code" },
    { id: "quick-reference", title: "Quick reference" },
    { id: "desktop-app", title: "Using the desktop app" },
    { id: "combine-with-mcp", title: "Combine with MCP" },
    { id: "claude-cowork", title: "Claude Cowork" },
    { id: "collection-description", title: "Collection descriptions" },
  ],
  content: `
  <div class="docs-breadcrumb">
    <a href="/docs">Docs</a>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
    <span>Claude Code Integration</span>
  </div>

  <h1 class="page-title">Claude Code Integration</h1>
  <p class="page-lead">Frozen Ink works naturally alongside Claude Code. Add your Obsidian vaults, local Git repos, or any other source as Frozen Ink collections, and your knowledge becomes instantly searchable — from the web UI, from the terminal, and via MCP so Claude can query it too.</p>

  <h2 id="overview">Overview</h2>
  <p>There are two complementary ways to use Frozen Ink with Claude Code:</p>

  <div class="feature-grid">
    <div class="feature-card">
      <div class="feature-card-icon">📂</div>
      <h4>Collection folders</h4>
      <p>Point Frozen Ink at your local folders — an Obsidian vault, a Git repository, a project directory. Sync them into the local index so you can browse and search them from the web UI or terminal.</p>
    </div>
    <div class="feature-card">
      <div class="feature-card-icon">🤖</div>
      <h4>MCP for Claude</h4>
      <p>Link collections to Claude Code via the Model Context Protocol. Claude can then search and read your knowledge base without you copying and pasting content into the conversation.</p>
    </div>
  </div>

  <p>This page covers adding collection folders and browsing your knowledge base. For the MCP integration that lets Claude query collections, see <a href="/docs/local-mcp">Local MCP Setup</a>.</p>

  <h2 id="add-collection-folder">Add a collection folder</h2>
  <p>A "collection folder" is simply a Frozen Ink collection that points at a local directory. The two most common cases are an Obsidian vault and a Git repository.</p>

  <h3 id="obsidian-vault">Obsidian vault</h3>
  <p>If your notes live in an Obsidian vault, add it as an <code>obsidian</code> collection. Frozen Ink understands Obsidian's wiki-link syntax, callout blocks, embedded images, and YAML frontmatter:</p>
  <pre><code>fink add obsidian \
  <span class="flag">--name</span> my-vault \
  <span class="flag">--path</span> ~/Documents/MyVault</code></pre>

  <p>This creates a collection named <code>my-vault</code> that points at your vault. The name is used in all subsequent commands:</p>
  <pre><code>fink sync my-vault
fink status</code></pre>

  <h3 id="git-repo">Git repository</h3>
  <p>Add a local code repository to get a searchable index of its commit history, branches, and tags:</p>
  <pre><code>fink add git \
  <span class="flag">--name</span> my-project \
  <span class="flag">--path</span> ~/code/my-project</code></pre>

  <p>Add <code>--include-diffs</code> if you want the full diff of each commit included in the rendered markdown. This is useful for understanding what changed in a given commit:</p>
  <pre><code>fink add git \
  <span class="flag">--name</span>           my-project \
  <span class="flag">--path</span>           ~/code/my-project \
  <span class="flag">--include-diffs</span></code></pre>

  <div class="callout callout-tip">
    <div class="callout-icon">💡</div>
    <div class="callout-body">
      <strong>Add multiple repos at once</strong>
      <p>You can add as many collections as you want. They're indexed separately, but Frozen Ink's full-text search queries all of them simultaneously, so you don't have to choose which one to search.</p>
    </div>
  </div>

  <h2 id="sync-and-serve">Sync &amp; serve</h2>
  <p>After adding your collections, sync them to pull data into the local index, then start the server:</p>
  <pre><code><span class="cmt"># Sync all collections at once</span>
fink sync "*"

<span class="cmt"># Start the local web UI and API server (runs on port 3000)</span>
fink serve</code></pre>

  <p>Open <a href="http://localhost:3000">http://localhost:3000</a> to browse your collections in the web UI.</p>

  <p>To keep collections up to date automatically, start the background daemon:</p>
  <pre><code>fink daemon start</code></pre>

  <h2 id="browsing-in-claude">Browsing in Claude Code</h2>
  <p>With <code>fink serve</code> running, the web UI at <code>localhost:3000</code> is available anywhere in your browser, including side-by-side with Claude Code in a split window.</p>

  <p>The web UI provides:</p>
  <ul>
    <li><strong>Collection picker</strong> — switch between your synced data sources</li>
    <li><strong>File tree</strong> — browse all markdown files in a folder tree, resizable</li>
    <li><strong>Tabs</strong> — open multiple notes simultaneously (<kbd>Cmd+W</kbd> to close)</li>
    <li><strong>Backlinks panel</strong> — see which notes link to the current note (Obsidian-style)</li>
    <li><strong>Quick switcher</strong> — press <kbd>Cmd+P</kbd> or <kbd>Cmd+K</kbd> for instant full-text search across all collections</li>
    <li><strong>6 display themes</strong> — Default Light, Minimal Light, Solarized Light, Nord Dark, Catppuccin Dark, Dracula Dark</li>
  </ul>

  <table>
    <thead>
      <tr><th>Shortcut</th><th>Action</th></tr>
    </thead>
    <tbody>
      <tr><td><kbd>Cmd+P</kbd> / <kbd>Cmd+K</kbd></td><td>Quick switcher / full-text search</td></tr>
      <tr><td><kbd>Cmd+W</kbd></td><td>Close current tab</td></tr>
      <tr><td><kbd>Ctrl+Tab</kbd></td><td>Cycle to next tab</td></tr>
      <tr><td><kbd>Ctrl+Shift+Tab</kbd></td><td>Cycle to previous tab</td></tr>
      <tr><td><kbd>Alt+←</kbd> / <kbd>Cmd+[</kbd></td><td>Navigate back</td></tr>
      <tr><td><kbd>Alt+→</kbd> / <kbd>Cmd+]</kbd></td><td>Navigate forward</td></tr>
      <tr><td><kbd>Cmd+\\</kbd></td><td>Toggle sidebar</td></tr>
    </tbody>
  </table>

  <h2 id="quick-reference">Quick reference</h2>
  <p>Common commands when working with Claude Code and Frozen Ink together:</p>
  <pre><code><span class="cmt"># First time setup</span>
fink init
fink add obsidian <span class="flag">--name</span> notes <span class="flag">--path</span> ~/Documents/MyVault
fink add git <span class="flag">--name</span> myapp <span class="flag">--path</span> ~/code/myapp
fink sync "*"
fink serve

<span class="cmt"># Daily workflow</span>
fink daemon start          <span class="cmt"># auto-sync in background</span>
fink serve                 <span class="cmt"># start web UI when needed</span>
fink search "auth flow"    <span class="cmt"># quick terminal search</span>
fink status                <span class="cmt"># check last sync times</span></code></pre>

  <h2 id="desktop-app">Using the desktop app</h2>
  <p>If you're on macOS, the Frozen Ink desktop app provides all the same functionality without the terminal. It adds:</p>
  <ul>
    <li><strong>Workspace management</strong> — multiple isolated workspaces, each with their own collections</li>
    <li><strong>System tray icon</strong> — sync status, quick access to the UI, daemon control</li>
    <li><strong>Management UI</strong> — add/edit/remove collections, trigger syncs, manage publications — all from a GUI</li>
    <li><strong>Export panel</strong> — export collections as markdown or HTML files with one click</li>
  </ul>

  <p>Download the desktop app from the <a href="/#download">download page</a>. On first launch, create a workspace and add your first collection from the Collections screen.</p>

  <div class="callout callout-info">
    <div class="callout-icon">ℹ️</div>
    <div class="callout-body">
      <strong>CLI and desktop app share data</strong>
      <p>The desktop app and the CLI both read from <code>~/.frozenink/</code>. Collections you add via the CLI are visible in the desktop app and vice versa, as long as you're using the same workspace.</p>
    </div>
  </div>

  <h2 id="combine-with-mcp">Combine with MCP</h2>
  <p>The most powerful Claude Code workflow combines collection folders with MCP. After adding and syncing your collections, link them to Claude Code so Claude can query them directly in any conversation:</p>
  <pre><code>fink mcp add <span class="flag">--tool</span> claude-code notes myapp</code></pre>

  <p>Now, when you're in a Claude Code conversation, you can ask:</p>
  <ul>
    <li><em>"What does my architecture note say about the caching strategy?"</em></li>
    <li><em>"Search my notes for anything about rate limiting"</em></li>
    <li><em>"Find commits in myapp that changed the auth module"</em></li>
  </ul>

  <p>Claude queries Frozen Ink via MCP and brings back exact content from your collections — no manual copy-paste needed.</p>

  <p>See <a href="/docs/local-mcp">Local MCP Setup</a> for the full configuration guide.</p>

  <h2 id="claude-cowork">Claude Cowork</h2>
  <p>Claude Cowork is Anthropic's collaborative AI workspace that lets teams work alongside Claude in a shared environment. Unlike Claude Code (which runs in your terminal), Cowork runs in the browser and doesn't support stdio MCP connections.</p>
  <p>You can still give Cowork access to your Frozen Ink knowledge base by <strong>adding your collections folder as a workspace folder</strong>. Claude Cowork can read files directly from your local filesystem when you share a folder with it.</p>

  <div class="steps">
    <div class="step">
      <div class="step-num">1</div>
      <div class="step-body">
        <h4>Sync your collections</h4>
        <p>Make sure your collections are synced locally. The markdown files in <code>~/.frozenink/collections/</code> are what Cowork will read:</p>
        <pre><code>fink sync "*"</code></pre>
      </div>
    </div>
    <div class="step">
      <div class="step-num">2</div>
      <div class="step-body">
        <h4>Add the collections folder</h4>
        <p>In Claude Cowork, open your workspace settings and add <code>~/.frozenink/collections/</code> as a shared folder. This gives Claude access to all your synced markdown files.</p>
      </div>
    </div>
    <div class="step">
      <div class="step-num">3</div>
      <div class="step-body">
        <h4>Ask questions naturally</h4>
        <p>Claude Cowork can now read from your collections folder. Ask questions and Claude will reference your knowledge base:</p>
        <ul>
          <li><em>"Check my notes for anything about the authentication redesign"</em></li>
          <li><em>"What open GitHub issues do I have tagged with 'performance'?"</em></li>
          <li><em>"Summarize recent commits in my project"</em></li>
        </ul>
      </div>
    </div>
  </div>

  <div class="callout callout-tip">
    <div class="callout-icon">🔄</div>
    <div class="callout-body">
      <strong>Keep it fresh</strong>
      <p>Run <code>fink daemon start</code> to keep your collections auto-syncing in the background. Cowork reads the latest files on disk, so syncing regularly ensures Claude sees up-to-date information.</p>
    </div>
  </div>

  <h2 id="collection-description">Collection descriptions</h2>
  <p>A collection description tells AI assistants what the collection contains and when to consult it. It's included in the MCP server instructions that Claude receives when a collection is linked, making Claude much more effective at routing questions to the right source.</p>

  <p>Set a description when adding a collection:</p>
  <pre><code>fink add github \
  <span class="flag">--name</span>        backend-issues \
  <span class="flag">--repo</span>        acme/backend \
  <span class="flag">--token</span>       ghp_... \
  <span class="flag">--description</span> "GitHub issues and PRs for the acme/backend repo. Search here for bug reports, feature requests, architecture decisions, and code review history."</code></pre>

  <p>Or update an existing collection:</p>
  <pre><code>fink collections update backend-issues \
  <span class="flag">--description</span> "GitHub issues and PRs for the acme/backend repo."</code></pre>

  <p>In the desktop app, the description field appears on the Edit Collection form, below the Display Title. It accepts free-form text — write it as if you're explaining to a colleague what this collection is and what questions it can answer.</p>

  <div class="callout callout-tip">
    <div class="callout-icon">💡</div>
    <div class="callout-body">
      <strong>What makes a good description</strong>
      <p>Include: the data source and project/repo/vault name, the kinds of entities it contains (issues, notes, commits), and the types of questions it can answer. For example: <em>"Obsidian vault for personal engineering notes. Contains architecture decisions, meeting notes, and reference docs. Consult this for design rationale and background context."</em></p>
    </div>
  </div>

  <div class="docs-pagination">
    <a href="/docs/managing-collections" class="docs-pagination-card">
      <span class="docs-pagination-label">← Previous</span>
      <span class="docs-pagination-title">Managing Collections</span>
    </a>
    <a href="/docs/local-mcp" class="docs-pagination-card next">
      <span class="docs-pagination-label">Next →</span>
      <span class="docs-pagination-title">Local MCP Setup</span>
    </a>
  </div>
  `,
});
