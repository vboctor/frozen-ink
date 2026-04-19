import { renderDocsPage } from "./layout";

export const configurationPage = renderDocsPage({
  title: "Configuration",
  description:
    "Reference for Frozen Ink configuration files: frozenink.yml global config, per-collection YAML, credentials.yml, and data directory structure.",
  activePath: "/docs/reference/configuration",
  canonicalPath: "/docs/reference/configuration",
  section: "Reference",
  tocLinks: [
    { id: "overview", title: "Overview" },
    { id: "global-config", title: "Global config (frozenink.yml)" },
    { id: "config-commands", title: "Managing config via CLI", indent: true },
    { id: "collection-config", title: "Collection config" },
    { id: "collection-fields", title: "Collection fields", indent: true },
    { id: "crawler-config", title: "Crawler-specific config", indent: true },
    { id: "publish-state", title: "Publish state", indent: true },
    { id: "credentials", title: "Named credentials" },
    { id: "credentials-usage", title: "Using named credentials", indent: true },
    { id: "data-directory", title: "Data directory structure" },
  ],
  content: `
  <div class="docs-breadcrumb">
    <a href="/docs">Docs</a>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
    <span>Reference</span>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
    <span>Configuration</span>
  </div>

  <h1 class="page-title">Configuration</h1>
  <p class="page-lead">Frozen Ink uses YAML configuration files stored in the <code>~/.frozenink/</code> directory. This reference covers every config file, field, and the overall data directory structure.</p>

  <h2 id="overview">Overview</h2>
  <p>Configuration is split across several files:</p>
  <table>
    <thead><tr><th>File</th><th>Purpose</th></tr></thead>
    <tbody>
      <tr><td><code>~/.frozenink/frozenink.yml</code></td><td>App-level settings (sync interval, UI port, etc.)</td></tr>
      <tr><td><code>~/.frozenink/credentials.yml</code></td><td>Named credential sets (reusable across collections)</td></tr>
      <tr><td><code>~/.frozenink/collections/&lt;name&gt;/&lt;name&gt;.yml</code></td><td>Per-collection config, credentials, and publish state</td></tr>
    </tbody>
  </table>
  <p>All config files are created and managed by CLI commands (<code>fink init</code>, <code>fink add</code>, <code>fink config</code>). You can also edit them directly — Frozen Ink reads them on each operation.</p>

  <h2 id="global-config">Global config (<code>frozenink.yml</code>)</h2>
  <p>Created by <code>fink init</code>. Controls app-wide behavior:</p>
  <pre><code><span class="cmt"># ~/.frozenink/frozenink.yml</span>
sync:
  interval: 30        <span class="cmt"># minutes between sync cycles</span>
  concurrency: 3      <span class="cmt"># max concurrent sync operations</span>
  retries: 2          <span class="cmt"># retry count for failed syncs</span>
log:
  level: info         <span class="cmt"># log level: debug, info, warn, error</span></code></pre>

  <h3 id="config-commands">Managing config via CLI</h3>
  <p>Use <code>fink config</code> to view and modify settings without editing files directly:</p>
  <pre><code><span class="cmt"># View all settings</span>
fink config list

<span class="cmt"># Get a specific value (dot notation)</span>
fink config get sync.interval

<span class="cmt"># Set a value (auto-converts types)</span>
fink config set sync.interval 60
fink config set log.level debug</code></pre>

  <div class="callout callout-info">
    <div class="callout-icon">ℹ️</div>
    <div class="callout-body">
      <strong>Type conversion</strong>
      <p><code>fink config set</code> automatically converts values: <code>"true"</code>/<code>"false"</code> become booleans, numeric strings become numbers, <code>"null"</code> becomes null. Everything else is stored as a string.</p>
    </div>
  </div>

  <h2 id="collection-config">Collection config</h2>
  <p>Each collection has its own YAML file at <code>~/.frozenink/collections/&lt;name&gt;/&lt;name&gt;.yml</code>. This file is created by <code>fink add</code> and updated by <code>fink update</code> and <code>fink publish</code>.</p>

  <h3 id="collection-fields">Collection fields</h3>
  <pre><code><span class="cmt"># ~/.frozenink/collections/my-issues/my-issues.yml</span>
title: "My GitHub Issues"       <span class="cmt"># display title (defaults to collection name)</span>
description: "Bug tracker"      <span class="cmt"># optional description</span>
crawler: github                 <span class="cmt"># crawler type: github, obsidian, git, rss, mantishub, remote</span>
enabled: true                   <span class="cmt"># whether this collection is active</span>
config:                         <span class="cmt"># crawler-specific configuration</span>
  owner: my-org
  repo: my-repo
credentials:                    <span class="cmt"># inline credentials OR named reference</span>
  token: ghp_xxx</code></pre>

  <h3 id="crawler-config">Crawler-specific config</h3>
  <p>The <code>config</code> section varies by crawler type:</p>

  <h4>GitHub</h4>
  <table>
    <thead><tr><th>Field</th><th>Type</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><code>owner</code></td><td>string</td><td>Repository owner (user or org)</td></tr>
      <tr><td><code>repo</code></td><td>string</td><td>Repository name</td></tr>
      <tr><td><code>maxIssues</code></td><td>number</td><td>Maximum issues to sync</td></tr>
      <tr><td><code>maxPullRequests</code></td><td>number</td><td>Maximum pull requests to sync</td></tr>
      <tr><td><code>openOnly</code></td><td>boolean</td><td>Only sync open issues/PRs</td></tr>
    </tbody>
  </table>

  <h4>Obsidian</h4>
  <table>
    <thead><tr><th>Field</th><th>Type</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><code>path</code></td><td>string</td><td>Absolute path to the Obsidian vault</td></tr>
    </tbody>
  </table>

  <h4>Git</h4>
  <table>
    <thead><tr><th>Field</th><th>Type</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><code>path</code></td><td>string</td><td>Absolute path to the Git repository</td></tr>
      <tr><td><code>includeDiffs</code></td><td>boolean</td><td>Include full commit diffs in markdown</td></tr>
    </tbody>
  </table>

  <h4>RSS</h4>
  <table>
    <thead><tr><th>Field</th><th>Type</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><code>feedUrl</code></td><td>string</td><td>RSS/Atom feed URL</td></tr>
      <tr><td><code>siteUrl</code></td><td>string</td><td>Optional site URL for sitemap discovery</td></tr>
      <tr><td><code>maxItems</code></td><td>number</td><td>Maximum items emitted per sync run</td></tr>
      <tr><td><code>sitemapBackfill</code></td><td>boolean</td><td>Backfill older URLs from sitemaps on first sync</td></tr>
      <tr><td><code>fetchArticleContent</code></td><td>boolean</td><td>Fetch article HTML when feed content is limited</td></tr>
    </tbody>
  </table>

  <h4>MantisHub</h4>
  <table>
    <thead><tr><th>Field</th><th>Type</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><code>url</code></td><td>string</td><td>Base URL of the instance</td></tr>
      <tr><td><code>projectName</code></td><td>string</td><td>Project name</td></tr>
      <tr><td><code>maxEntities</code></td><td>number</td><td>Maximum entities to sync</td></tr>
      <tr><td><code>syncEntities</code></td><td>string</td><td>Entity types to sync (e.g., <code>"issues,pages,users"</code>)</td></tr>
    </tbody>
  </table>

  <h4>Remote (cloned collections)</h4>
  <table>
    <thead><tr><th>Field</th><th>Type</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><code>sourceUrl</code></td><td>string</td><td>URL of the published site this was cloned from</td></tr>
    </tbody>
  </table>

  <h3 id="publish-state">Publish state</h3>
  <p>When a collection is published, a <code>publish</code> section is added to its config file automatically:</p>
  <pre><code>publish:
  url: https://my-issues.example.workers.dev
  mcpUrl: https://my-issues.example.workers.dev/mcp
  password:
    protected: true
    hash: "salt:hex"
  publishedAt: "2026-04-05T12:00:00Z"</code></pre>
  <p>This section is managed by <code>fink publish</code> and <code>fink unpublish</code>. Do not edit it manually.</p>

  <h2 id="credentials">Named credentials</h2>
  <p>Instead of storing tokens directly in each collection's config file, you can create named credential sets in <code>~/.frozenink/credentials.yml</code> and reference them by name.</p>

  <pre><code><span class="cmt"># ~/.frozenink/credentials.yml</span>
github-work:
  token: ghp_workToken123
github-personal:
  token: ghp_personalToken456
mantishub-prod:
  token: api_token_here</code></pre>

  <h3 id="credentials-usage">Using named credentials</h3>
  <p>Reference a named credential set when adding a collection:</p>
  <pre><code>fink add github <span class="flag">--name</span> work-issues \
  <span class="flag">--repo</span> my-org/my-repo \
  <span class="flag">--credentials</span> github-work</code></pre>

  <p>The collection's config file stores the reference name instead of the raw token:</p>
  <pre><code><span class="cmt"># my-issues.yml — references credential by name</span>
credentials: github-work</code></pre>

  <div class="callout callout-tip">
    <div class="callout-icon">💡</div>
    <div class="callout-body">
      <strong>When to use named credentials</strong>
      <p>Named credentials are useful when multiple collections share the same token (e.g., several GitHub repos under the same org). Update the token once in <code>credentials.yml</code> and all collections pick it up automatically.</p>
    </div>
  </div>

  <h2 id="data-directory">Data directory structure</h2>
  <p>The default Frozen Ink home directory (<code>~/.frozenink/</code>) has this layout:</p>

  <pre><code>~/.frozenink/
  frozenink.yml                     <span class="cmt"># app configuration</span>
  credentials.yml                   <span class="cmt"># named credential sets</span>
  collections/
    &lt;name&gt;/
      &lt;name&gt;.yml                    <span class="cmt"># collection config</span>
      db/data.db                    <span class="cmt"># SQLite database (entities, search index)</span>
      content/                      <span class="cmt"># rendered markdown files</span>
        issues/42-login-error.md
        commits/abc1234-fix-bug.md
      attachments/                  <span class="cmt"># binary assets (images, etc.)</span>
        images/photo.png</code></pre>

  <p>The <code>content/</code> and <code>attachments/</code> directories are regenerable from the database — they can be safely deleted and rebuilt with <code>fink generate</code>. The database (<code>db/data.db</code>) is the source of truth for synced entity data.</p>

  <div class="docs-pagination">
    <a href="/docs/reference/cli" class="docs-pagination-card">
      <span class="docs-pagination-label">&larr; Previous</span>
      <span class="docs-pagination-title">CLI Reference</span>
    </a>
    <span></span>
  </div>
  `,
});
