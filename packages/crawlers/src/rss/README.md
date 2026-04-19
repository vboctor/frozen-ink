# RSS Crawler

The RSS crawler syncs blog/news content from RSS or Atom feeds into Frozen Ink.

## Config

- `feedUrl` (required): feed URL.
- `siteUrl` (optional): website root for sitemap discovery.
- `maxItems` (optional): cap entities emitted per run.
- `sitemapBackfill` (default `true`): on first sync, discover older posts from sitemaps.
- `fetchArticleContent` (default `true`): fetch article HTML when feed summaries are limited.

## Sync Behavior

- Initial sync reads the feed and optionally backfills from sitemap URLs.
- Incremental sync uses a watermark (`latest updated/published timestamp`) and a recent seen-ID window.
- Missing posts in newer feed windows are **not treated as deletions**.

## Attachments

Image/media URLs are extracted from:

- RSS `<enclosure>` and `media:*` fields
- Feed HTML (`content:encoded` / `description`)
- Fetched article HTML fallback

Downloaded images are stored under:

- `attachments/rss/YYYY/...`
