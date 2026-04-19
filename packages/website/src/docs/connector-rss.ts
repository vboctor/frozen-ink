import { renderDocsPage } from "./layout";

export const connectorRssPage = renderDocsPage({
  title: "RSS Connector",
  description:
    "Sync RSS/Atom feeds into Frozen Ink with sitemap backfill to work around limited last-N feed windows.",
  activePath: "/docs/connectors/rss",
  canonicalPath: "/docs/connectors/rss",
  section: "Connectors",
  tocLinks: [
    { id: "overview", title: "Overview" },
    { id: "add", title: "Adding an RSS collection" },
    { id: "sync-behavior", title: "Initial vs incremental sync" },
    { id: "backfill", title: "Sitemap backfill" },
    { id: "tips", title: "Tips & notes" },
  ],
  content: `
  <div class="docs-breadcrumb">
    <a href="/docs">Docs</a>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
    <a href="/docs/connectors/rss">Connectors</a>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
    <span>RSS</span>
  </div>

  <h1 class="page-title">RSS Connector</h1>
  <p class="page-lead">The RSS connector syncs posts from RSS or Atom feeds and stores them as markdown entities in Frozen Ink. It is designed to handle feeds that only expose the most recent N posts.</p>

  <h2 id="overview">Overview</h2>
  <p>Each feed entry becomes a <code>post</code> entity. Optional image/media assets are downloaded and linked in the rendered markdown. On first sync, Frozen Ink can also discover older posts from sitemaps.</p>

  <h2 id="add">Adding an RSS collection</h2>
  <pre><code>fink add rss \\
  <span class="flag">--name</span> my-blog \\
  <span class="flag">--feed-url</span> https://example.com/feed.xml \\
  <span class="flag">--site-url</span> https://example.com</code></pre>

  <table>
    <thead><tr><th>Flag</th><th>Required</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><code>--name</code></td><td>Yes</td><td>Your local collection name</td></tr>
      <tr><td><code>--feed-url</code></td><td>Yes</td><td>RSS/Atom feed URL</td></tr>
      <tr><td><code>--site-url</code></td><td>No</td><td>Website URL for sitemap discovery</td></tr>
      <tr><td><code>--max</code></td><td>No</td><td>Limit items synced per run</td></tr>
      <tr><td><code>--no-sitemap-backfill</code></td><td>No</td><td>Disable initial sitemap backfill</td></tr>
      <tr><td><code>--no-fetch-article-content</code></td><td>No</td><td>Disable article HTML fallback fetching</td></tr>
    </tbody>
  </table>

  <h2 id="sync-behavior">Initial vs incremental sync</h2>
  <p><strong>Initial sync</strong> pulls the feed and (by default) backfills older posts from sitemaps.</p>
  <p><strong>Incremental sync</strong> stores a timestamp watermark and only upserts newly published or updated posts on subsequent runs.</p>
  <p>Missing items in the latest feed window are <strong>not</strong> interpreted as deletions.</p>

  <h2 id="backfill">Sitemap backfill</h2>
  <p>Many feeds only contain the most recent entries. The connector addresses this by checking common sitemap locations (<code>/sitemap.xml</code>, <code>/sitemap_index.xml</code>, <code>/wp-sitemap.xml</code>) and any sitemap hints from <code>robots.txt</code>.</p>
  <p>This recovers older URLs that are no longer present in the feed and keeps your local archive complete.</p>

  <h2 id="tips">Tips &amp; notes</h2>
  <ul>
    <li><strong>Use a stable feed URL.</strong> Feed URL changes reset incremental history.</li>
    <li><strong>Set <code>--site-url</code>.</strong> This improves sitemap discovery on non-standard feed hosts.</li>
    <li><strong>Expect feed variance.</strong> Different blogs expose different fields; Frozen Ink normalizes identifiers by GUID/canonical URL when possible.</li>
  </ul>

  <div class="docs-pagination">
    <a href="/docs/connectors/mantishub" class="docs-pagination-card">
      <span class="docs-pagination-label">← Previous</span>
      <span class="docs-pagination-title">MantisHub Connector</span>
    </a>
    <a href="/docs/integrations/local-mcp" class="docs-pagination-card next">
      <span class="docs-pagination-label">Next →</span>
      <span class="docs-pagination-title">Local MCP Setup</span>
    </a>
  </div>
  `,
});
