import { renderDocsPage } from "./layout";

export const connectorObsidianPage = renderDocsPage({
  title: "Obsidian Connector",
  description:
    "Sync your Obsidian vault into Frozen Ink to browse, search, and share your notes — locally or via MCP.",
  activePath: "/docs/connectors/obsidian",
  tocLinks: [
    { id: "overview", title: "Overview" },
    { id: "prerequisites", title: "Prerequisites" },
    { id: "add", title: "Adding an Obsidian collection" },
    { id: "what-syncs", title: "What gets synced" },
    { id: "wiki-links", title: "Wiki-links & backlinks", indent: true },
    { id: "callouts", title: "Callouts", indent: true },
    { id: "attachments", title: "Attachments", indent: true },
    { id: "sync", title: "Syncing" },
    { id: "tips", title: "Tips & notes" },
  ],
  content: `
  <div class="docs-breadcrumb">
    <a href="/docs">Docs</a>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
    <a href="/docs/connectors/obsidian">Connectors</a>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
    <span>Obsidian</span>
  </div>

  <h1 class="page-title">Obsidian Connector</h1>
  <p class="page-lead">The Obsidian connector syncs all markdown notes and attachments from a local Obsidian vault. It preserves wiki-links, callouts, frontmatter, and embedded images — giving you a browsable, searchable, AI-accessible copy of your vault.</p>

  <h2 id="overview">Overview</h2>
  <p>Point Frozen Ink at your vault directory and it indexes every note. The web UI renders notes with the same formatting you'd expect from Obsidian — wiki-links navigate between notes, callout blocks are styled, and images are embedded inline.</p>
  <p>This makes your vault available to AI assistants via MCP, shareable with teammates via a published deployment, and searchable across all your notes in one place.</p>

  <h2 id="prerequisites">Prerequisites</h2>
  <p>You need a local <strong>Obsidian vault</strong> — a directory on your machine containing markdown files. No Obsidian app installation is required; Frozen Ink reads the files directly from the filesystem.</p>

  <h2 id="add">Adding an Obsidian collection</h2>
  <pre><code>fink add obsidian \
  <span class="flag">--name</span> my-vault \
  <span class="flag">--path</span> ~/Documents/MyVault</code></pre>

  <table>
    <thead><tr><th>Flag</th><th>Required</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><code>--name</code></td><td>Yes</td><td>Your name for this collection, used in all subsequent commands</td></tr>
      <tr><td><code>--path</code></td><td>Yes</td><td>Absolute path to the root of your Obsidian vault</td></tr>
    </tbody>
  </table>

  <div class="callout callout-info">
    <div class="callout-icon">ℹ️</div>
    <div class="callout-body">
      <strong>Point at the vault root</strong>
      <p>Use the top-level vault directory — the one that contains your <code>.obsidian/</code> config folder. Subdirectories and nested folders are included automatically.</p>
    </div>
  </div>

  <h2 id="what-syncs">What gets synced</h2>
  <p>Every <code>.md</code> file in the vault becomes an entity. The folder structure is preserved in the file tree. For each note, Frozen Ink stores:</p>
  <ul>
    <li>The full markdown content</li>
    <li>YAML frontmatter (displayed as metadata in the web UI)</li>
    <li>Tags extracted from frontmatter and inline <code>#tag</code> syntax</li>
    <li>Outgoing and incoming links (backlinks)</li>
    <li>Attachment references</li>
  </ul>

  <h3 id="wiki-links">Wiki-links &amp; backlinks</h3>
  <p>Obsidian-style wiki-links (<code>[[Note Title]]</code> and <code>[[Note Title|alias]]</code>) are converted to standard markdown links that navigate within the Frozen Ink web UI. Backlinks — notes that link <em>to</em> the current note — are displayed in a collapsible panel on the right side of the web UI, just like in Obsidian.</p>

  <h3 id="callouts">Callouts</h3>
  <p>Obsidian callout syntax (<code>&gt; [!NOTE]</code>, <code>&gt; [!TIP]</code>, <code>&gt; [!WARNING]</code>, etc.) is rendered as styled callout blocks in the web UI, preserving the visual hierarchy of your notes.</p>

  <h3 id="attachments">Attachments</h3>
  <p>Images and file attachments embedded with <code>![[image.png]]</code> are copied into the collection's attachments directory and served by the local server. They're viewable inline in the web UI and included in published deployments.</p>

  <h2 id="sync">Syncing</h2>
  <pre><code><span class="cmt"># Sync after making changes in Obsidian</span>
fink sync my-vault

<span class="cmt"># Keep in sync automatically</span>
fink daemon start</code></pre>

  <p>The Obsidian connector reads files directly from disk — no Obsidian app needs to be running. Sync is fast because only files with a newer modification timestamp are re-processed.</p>

  <div class="callout callout-tip">
    <div class="callout-icon">💡</div>
    <div class="callout-body">
      <strong>iCloud & synced vaults</strong>
      <p>If your vault is in iCloud Drive or another cloud-synced folder, make sure the files are fully downloaded locally before syncing. Frozen Ink reads from the local filesystem and cannot access files that haven't been downloaded yet.</p>
    </div>
  </div>

  <h2 id="tips">Tips &amp; notes</h2>
  <ul>
    <li><strong>Multiple vaults.</strong> Add a separate collection for each vault. They're indexed independently and can be published or shared separately.</li>
    <li><strong>Excluded files.</strong> Files in the <code>.obsidian/</code> directory are ignored. All other <code>.md</code> files are included.</li>
    <li><strong>Large vaults.</strong> Vaults with thousands of notes sync quickly — typically in seconds for incremental runs.</li>
    <li><strong>Vault path changes.</strong> If you move your vault, update the collection with <code>fink update my-vault --path /new/path</code>.</li>
    <li><strong>Sharing privately.</strong> Use <a href="/docs/local-mcp">local MCP</a> to give Claude access to your vault without any data leaving your machine. Use <a href="/docs/publishing">publishing</a> only if you intentionally want remote access.</li>
  </ul>

  <div class="docs-pagination">
    <a href="/docs/connectors/github" class="docs-pagination-card">
      <span class="docs-pagination-label">← Previous</span>
      <span class="docs-pagination-title">GitHub Connector</span>
    </a>
    <a href="/docs/connectors/git" class="docs-pagination-card next">
      <span class="docs-pagination-label">Next →</span>
      <span class="docs-pagination-title">Git Connector</span>
    </a>
  </div>
  `,
});
