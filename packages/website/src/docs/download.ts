import { renderDocsPage } from "./layout";

export const downloadPage = renderDocsPage({
  title: "Download",
  description:
    "Download Frozen Ink as a CLI for developers or as a desktop app for everyday use.",
  activePath: "/docs/download",
  canonicalPath: "/docs/download",
  section: "Overview",
  tocLinks: [
    { id: "cli", title: "CLI — for developers" },
    { id: "desktop", title: "Desktop App" },
    { id: "macos", title: "macOS", indent: true },
    { id: "windows", title: "Windows", indent: true },
    { id: "linux", title: "Linux", indent: true },
  ],
  content: `
  <div class="docs-breadcrumb">
    <a href="/docs">Docs</a>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
    <span>Download</span>
  </div>

  <h1 class="page-title">Download Frozen Ink</h1>
  <p class="page-lead">Frozen Ink is available as a command-line tool for developers and AI workflows, and as a native desktop app for everyday use.</p>

  <h2 id="cli">CLI — for developers &amp; AI workflows</h2>
  <p>The CLI is the primary way to manage collections, sync sources, and expose your knowledge base via MCP. It runs on macOS, Windows, and Linux wherever Node.js is available.</p>

  <p><strong>Install globally with npm:</strong></p>
  <pre><code>npm install -g @vboctor/fink</code></pre>

  <p>Verify the install:</p>
  <pre><code>fink --version</code></pre>

  <div class="callout callout-tip">
    <div class="callout-icon">&#128218;</div>
    <div class="callout-body">
      <strong>Next steps</strong>
      <p>Head to the <a href="/docs">Getting Started guide</a> to add your first collection and start browsing your knowledge base.</p>
    </div>
  </div>

  <h2 id="desktop">Desktop App — for everyday use</h2>
  <p>The desktop app provides a native GUI for browsing and managing your knowledge base without using the terminal. Binaries are attached to each GitHub Release.</p>

  <ul>
    <li id="macos"><strong>macOS</strong> — Apple Silicon and Intel, as a <code>.dmg</code> installer</li>
    <li id="windows"><strong>Windows</strong> — 64-bit, as a <code>.exe</code> installer</li>
    <li id="linux"><strong>Linux</strong> — <code>.AppImage</code> (universal) and <code>.deb</code> (Debian/Ubuntu)</li>
  </ul>

  <p style="margin-top: 20px;">All binaries are listed under <em>Assets</em> on the GitHub Releases page.</p>
  <a href="https://github.com/vboctor/frozen-ink/releases/latest" target="_blank" rel="noopener" class="btn btn-primary" style="margin-top:8px;">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
    Download Desktop App
  </a>

  <div class="callout callout-warning">
    <div class="callout-icon">&#9888;&#65039;</div>
    <div class="callout-body">
      <strong>macOS Gatekeeper</strong>
      <p>The app is currently unsigned. If macOS blocks it on first launch, right-click the app and choose <strong>Open</strong>, or run <code>xattr -cr /Applications/FrozenInk.app</code> in Terminal to clear the quarantine attribute.</p>
    </div>
  </div>
`,
});
