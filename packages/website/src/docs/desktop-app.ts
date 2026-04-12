import { renderDocsPage } from "./layout";

export const desktopAppPage = renderDocsPage({
  title: "Desktop App",
  description:
    "Use the Frozen Ink macOS desktop app to manage collections, sync data, publish, and export — all from a GUI without the terminal.",
  activePath: "/docs/desktop-app",
  tocLinks: [
    { id: "overview", title: "Overview" },
    { id: "getting-started", title: "Getting started" },
    { id: "workspaces", title: "Workspaces" },
    { id: "browse-mode", title: "Browse mode" },
    { id: "manage-mode", title: "Manage mode" },
    { id: "collections-panel", title: "Collections panel", indent: true },
    { id: "sync-panel", title: "Sync panel", indent: true },
    { id: "publish-panel", title: "Publish panel", indent: true },
    { id: "export-panel", title: "Export panel", indent: true },
    { id: "settings-panel", title: "Settings panel", indent: true },
    { id: "system-tray", title: "System tray" },
    { id: "vs-cli", title: "Desktop app vs. CLI" },
  ],
  content: `
  <div class="docs-breadcrumb">
    <a href="/docs">Docs</a>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
    <span>Desktop App</span>
  </div>

  <h1 class="page-title">Desktop App</h1>
  <p class="page-lead">The Frozen Ink desktop app for macOS wraps everything into a native application — no terminal required. You get the full web UI for browsing, plus a management interface for adding collections, triggering syncs, publishing to Cloudflare, and exporting data.</p>

  <h2 id="overview">Overview</h2>
  <p>The desktop app bundles the Frozen Ink server, web UI, and a management layer into a single native macOS application. It runs as a menu bar app with a system tray icon so it stays out of your way while keeping your collections in sync.</p>

  <div class="feature-grid">
    <div class="feature-card">
      <div class="feature-card-icon">🖥️</div>
      <h4>No terminal needed</h4>
      <p>Add collections, trigger syncs, publish to Cloudflare, and export data — all from a GUI with no command line required.</p>
    </div>
    <div class="feature-card">
      <div class="feature-card-icon">📁</div>
      <h4>Workspaces</h4>
      <p>Create separate workspaces for different contexts — personal notes, work projects, client archives — and switch between them instantly.</p>
    </div>
    <div class="feature-card">
      <div class="feature-card-icon">🔄</div>
      <h4>Background sync</h4>
      <p>The app runs in the system tray and syncs your collections automatically. Trigger a manual sync from the tray menu without opening the main window.</p>
    </div>
    <div class="feature-card">
      <div class="feature-card-icon">🔍</div>
      <h4>Same powerful UI</h4>
      <p>The browse experience is identical to the web UI — file tree, tabs, full-text search, backlinks, six themes, and keyboard shortcuts.</p>
    </div>
  </div>

  <h2 id="getting-started">Getting started</h2>
  <div class="steps">
    <div class="step">
      <div class="step-num">1</div>
      <div class="step-body">
        <h4>Download and install</h4>
        <p>Download the macOS app from the <a href="/#download">download page</a>. Open the DMG, drag Frozen Ink to your Applications folder, and launch it.</p>
      </div>
    </div>
    <div class="step">
      <div class="step-num">2</div>
      <div class="step-body">
        <h4>Create a workspace</h4>
        <p>On first launch, you'll see the welcome screen. Click <strong>Create Workspace</strong> and choose a directory where Frozen Ink will store its data for this workspace. A workspace is a self-contained collection of synced data — you can think of it like a project folder.</p>
      </div>
    </div>
    <div class="step">
      <div class="step-num">3</div>
      <div class="step-body">
        <h4>Add your first collection</h4>
        <p>Switch to <strong>Manage</strong> mode using the toggle at the top of the window, then open the <strong>Collections</strong> panel. Click <strong>Add Collection</strong>, choose a type (Obsidian, GitHub, Git, or MantisBT), fill in the details, and save.</p>
      </div>
    </div>
    <div class="step">
      <div class="step-num">4</div>
      <div class="step-body">
        <h4>Sync and browse</h4>
        <p>Click <strong>Sync</strong> next to the collection, wait for it to complete, then switch to <strong>Browse</strong> mode to read your synced content.</p>
      </div>
    </div>
  </div>

  <h2 id="workspaces">Workspaces</h2>
  <p>A workspace is an isolated Frozen Ink environment — its own set of collections, databases, and settings stored in a directory you choose. You can have as many workspaces as you like and switch between them from the app menu or the welcome screen.</p>

  <p>Workspaces are useful for separating contexts:</p>
  <ul>
    <li><strong>Personal</strong> — Obsidian vault, personal GitHub repos, private notes</li>
    <li><strong>Work</strong> — company GitHub, team wikis, project repositories</li>
    <li><strong>Client</strong> — a separate workspace per client engagement</li>
  </ul>

  <p>To open or create a workspace, go to <strong>File → Open Workspace</strong> or use the workspace picker on the welcome screen. The app remembers the last opened workspace and reopens it automatically on launch.</p>

  <div class="callout callout-info">
    <div class="callout-icon">ℹ️</div>
    <div class="callout-body">
      <strong>Workspace data location</strong>
      <p>Each workspace stores its data in the directory you chose when creating it. The app also keeps a list of recent workspaces at <code>~/.frozenink/workspaces.json</code> so it can show them in the welcome screen.</p>
    </div>
  </div>

  <h2 id="browse-mode">Browse mode</h2>
  <p>Browse mode is the reading interface. Switch to it using the mode toggle at the top of the window. It is identical to the web UI you get with <code>fink serve</code>:</p>
  <ul>
    <li><strong>Collection picker</strong> — switch between synced collections (auto-hidden when only one exists)</li>
    <li><strong>File tree</strong> — navigate all markdown files in a resizable sidebar</li>
    <li><strong>Tabs</strong> — open multiple notes side by side; <kbd>Cmd+W</kbd> closes a tab</li>
    <li><strong>Quick switcher</strong> — <kbd>Cmd+P</kbd> or <kbd>Cmd+K</kbd> to search across all collections instantly</li>
    <li><strong>Backlinks panel</strong> — collapsible right panel showing every note that links to the current one</li>
    <li><strong>Navigation history</strong> — <kbd>Cmd+[</kbd> / <kbd>Cmd+]</kbd> to go back and forward</li>
    <li><strong>Themes</strong> — six display themes selectable from the bottom of the sidebar</li>
  </ul>

  <h2 id="manage-mode">Manage mode</h2>
  <p>Manage mode gives you full control over your workspace. Switch to it using the mode toggle at the top of the window. It has five panels accessible from the left navigation:</p>

  <h3 id="collections-panel">Collections panel</h3>
  <p>Lists all collections in the current workspace. From here you can:</p>
  <ul>
    <li><strong>Add a collection</strong> — choose a type and fill in a form with the source-specific settings (path, token, repository, etc.)</li>
    <li><strong>Edit a collection</strong> — update credentials, paths, or other config</li>
    <li><strong>Enable / disable</strong> — temporarily exclude a collection from auto-sync without removing it</li>
    <li><strong>Delete a collection</strong> — removes the collection and all its local data</li>
    <li><strong>Configure MCP</strong> — link or unlink the collection from Claude Code or Claude Desktop directly from the UI</li>
  </ul>

  <h3 id="sync-panel">Sync panel</h3>
  <p>Shows all collections and their last sync status. You can:</p>
  <ul>
    <li>Sync individual collections with a single click</li>
    <li>Sync all collections at once with <strong>Sync All</strong></li>
    <li>Watch real-time progress — entity counts, current operation, elapsed time</li>
    <li>See sync errors with details if a collection fails</li>
  </ul>

  <h3 id="publish-panel">Publish panel</h3>
  <p>Deploy one or more collections to Cloudflare with a form-based interface. You set the deployment name, password, and which collections to include, then click <strong>Publish</strong>. The panel shows upload progress and the final URL when done.</p>
  <p>It also lists existing deployments so you can re-publish (to push updates) or unpublish them.</p>

  <div class="callout callout-info">
    <div class="callout-icon">ℹ️</div>
    <div class="callout-body">
      <strong>Wrangler required for publishing</strong>
      <p>Publishing uses Wrangler under the hood. Install it with <code>npm install -g wrangler</code> and authenticate with <code>wrangler login</code> before using the Publish panel. See <a href="/docs/publishing">Publishing to Cloudflare</a> for the full guide.</p>
    </div>
  </div>

  <h3 id="export-panel">Export panel</h3>
  <p>Export one or more collections as standalone files you can archive, share, or open in any editor:</p>
  <ul>
    <li><strong>Markdown export</strong> — raw <code>.md</code> files plus an index, readable in any text editor or Obsidian</li>
    <li><strong>HTML export</strong> — fully rendered, navigable static HTML pages with no server required</li>
  </ul>
  <p>Choose an output directory, select the collections to include, pick the format, and click <strong>Export</strong>.</p>

  <h3 id="settings-panel">Settings panel</h3>
  <p>Edit app-level configuration stored in <code>frozenink.yml</code> within the workspace:</p>
  <ul>
    <li><strong>Sync interval</strong> — how often the background daemon syncs collections (in minutes)</li>
    <li><strong>UI port</strong> — the local port the embedded server listens on (default: 3000)</li>
  </ul>

  <h2 id="system-tray">System tray</h2>
  <p>Frozen Ink lives in the macOS menu bar. Click the tray icon to access:</p>
  <ul>
    <li><strong>Sync All</strong> — triggers an immediate sync of all collections in the current workspace (the label changes to "Syncing…" while active)</li>
    <li><strong>Open Frozen Ink</strong> — brings the main window to the front</li>
    <li><strong>Quit</strong> — exits the app and stops the background server</li>
  </ul>
  <p>You can close the main window and Frozen Ink will continue running in the tray, keeping the server alive so MCP connections and scheduled syncs keep working.</p>

  <h2 id="vs-cli">Desktop app vs. CLI</h2>
  <p>The desktop app and the <code>fink</code> CLI cover the same underlying capabilities. Here's when to use each:</p>

  <table>
    <thead>
      <tr><th>Task</th><th>Desktop app</th><th>CLI</th></tr>
    </thead>
    <tbody>
      <tr><td>Add / edit collections</td><td>✅ GUI form</td><td>✅ <code>fink add</code></td></tr>
      <tr><td>Sync collections</td><td>✅ One click + progress UI</td><td>✅ <code>fink sync</code></td></tr>
      <tr><td>Browse content</td><td>✅ Native app window</td><td>✅ <code>fink serve</code> + browser</td></tr>
      <tr><td>Full-text search</td><td>✅ <kbd>Cmd+P</kbd></td><td>✅ <code>fink search</code></td></tr>
      <tr><td>Publish to Cloudflare</td><td>✅ Publish panel</td><td>✅ <code>fink publish</code></td></tr>
      <tr><td>Export collections</td><td>✅ Export panel</td><td>✅ Via API</td></tr>
      <tr><td>Configure MCP</td><td>✅ Collections panel</td><td>✅ <code>fink mcp add</code></td></tr>
      <tr><td>Multiple workspaces</td><td>✅ Built-in</td><td>⚠️ Manual directory switching</td></tr>
      <tr><td>Background sync</td><td>✅ System tray daemon</td><td>✅ <code>fink daemon</code></td></tr>
      <tr><td>Scripting / automation</td><td>❌</td><td>✅ Composable commands</td></tr>
      <tr><td>Linux / Windows</td><td>❌ macOS only</td><td>✅ All platforms</td></tr>
    </tbody>
  </table>

  <div class="docs-pagination">
    <a href="/docs/cloud-mcp" class="docs-pagination-card">
      <span class="docs-pagination-label">← Previous</span>
      <span class="docs-pagination-title">Cloud MCP Access</span>
    </a>
    <span></span>
  </div>
  `,
});
