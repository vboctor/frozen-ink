import type {
  AssetFilter,
  Crawler,
  CrawlerEntityData,
  CrawlerMetadata,
  SyncCursor,
  SyncResult,
} from "@frozenink/core";
import { createCryptoHasher } from "@frozenink/core";
import { XMLParser } from "fast-xml-parser";
import type { ParsedFeedPost, ParsedSitemap, RssConfig, RssSyncCursor } from "./types";

const FEED_PAGE_LIMIT = 5;
const SITEMAP_LIMIT = 20;
const DEFAULT_SEEN_WINDOW = 200;

const IMAGE_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".avif",
]);

function arr<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function text(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number") return String(value);
  if (typeof value === "object" && value && "#text" in (value as Record<string, unknown>)) {
    const t = (value as Record<string, unknown>)["#text"];
    return typeof t === "string" ? t.trim() || undefined : undefined;
  }
  return undefined;
}

function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  const noHash = trimmed.replace(/#.*$/, "");
  return noHash.replace(/\/$/, "");
}

function toIso(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function maxIso(a: string | undefined, b: string | undefined): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fileExt(url: string): string {
  const path = url.split("?")[0].toLowerCase();
  const idx = path.lastIndexOf(".");
  return idx === -1 ? "" : path.slice(idx);
}

function guessMimeType(url: string, headerValue: string | null): string {
  if (headerValue) return headerValue.split(";")[0].trim();
  const ext = fileExt(url);
  switch (ext) {
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".gif": return "image/gif";
    case ".webp": return "image/webp";
    case ".svg": return "image/svg+xml";
    case ".bmp": return "image/bmp";
    case ".avif": return "image/avif";
    default: return "application/octet-stream";
  }
}

interface FeedPageResult {
  posts: ParsedFeedPost[];
  nextFeedUrl?: string;
}

export class RssCrawler implements Crawler {
  metadata: CrawlerMetadata = {
    type: "rss",
    displayName: "RSS / Atom Feed",
    description: "Syncs posts from RSS/Atom feeds with optional sitemap backfill",
    version: "1.0",
    configSchema: {
      feedUrl: { type: "string", required: true, description: "RSS/Atom feed URL" },
      siteUrl: { type: "string", required: false, description: "Site URL used for sitemap backfill" },
      maxItems: { type: "number", required: false, description: "Maximum items per sync" },
      sitemapBackfill: { type: "boolean", default: true },
      fetchArticleContent: { type: "boolean", default: true },
    },
    credentialFields: [],
  };

  private config: RssConfig = { feedUrl: "" };
  private fetchFn: typeof fetch = globalThis.fetch;
  private assetFilter: AssetFilter | null = null;
  private progressCallback: ((message: string) => void) | null = null;
  private parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    trimValues: true,
  });

  async initialize(config: Record<string, unknown>): Promise<void> {
    this.config = {
      feedUrl: String(config.feedUrl ?? "").trim(),
      siteUrl: typeof config.siteUrl === "string" ? config.siteUrl.trim() : undefined,
      maxItems: typeof config.maxItems === "number" ? config.maxItems : undefined,
      sitemapBackfill: config.sitemapBackfill !== false,
      fetchArticleContent: config.fetchArticleContent !== false,
    };
  }

  setFetch(fn: typeof fetch): void {
    this.fetchFn = fn;
  }

  setAssetFilter(filter: AssetFilter): void {
    this.assetFilter = filter;
  }

  setProgressCallback(callback: (message: string) => void): void {
    this.progressCallback = callback;
  }

  async validateCredentials(): Promise<boolean> {
    return this.config.feedUrl.length > 0;
  }

  async dispose(): Promise<void> {
    // No-op
  }

  async sync(cursor: SyncCursor | null): Promise<SyncResult> {
    const c = (cursor as RssSyncCursor) ?? {};
    const entities: CrawlerEntityData[] = [];
    const seenIds = new Set(c.seenIds ?? []);

    this.report(`Fetching feed: ${this.config.feedUrl}`);
    const feedPosts = await this.fetchFeedPosts();

    // Feed is always authoritative for latest watermark and incremental detection.
    let newestIso = c.watermark;
    let feedProcessed = 0;
    for (const post of feedPosts) {
      const postTime = post.updatedAt ?? post.publishedAt;
      newestIso = maxIso(newestIso, postTime);
      if (!this.shouldInclude(post, c.watermark, seenIds)) continue;
      feedProcessed += 1;
      this.report(`Processing feed post ${feedProcessed}/${feedPosts.length}: ${post.title}`);
      entities.push(await this.postToEntity(post));
      seenIds.add(post.id);
      if (this.config.maxItems && entities.length >= this.config.maxItems) break;
    }

    if (this.shouldRunBackfill(c) && (!this.config.maxItems || entities.length < this.config.maxItems)) {
      const sitemapCandidates = await this.discoverSitemaps();
      if (sitemapCandidates.length > 0) {
        this.report(`Backfilling from ${sitemapCandidates.length} sitemap candidate(s)`);
      }
      const backfillPosts = await this.fetchBackfillPosts(sitemapCandidates, seenIds, this.config.maxItems ? this.config.maxItems - entities.length : undefined);
      let backfillProcessed = 0;
      for (const post of backfillPosts) {
        const postTime = post.updatedAt ?? post.publishedAt;
        newestIso = maxIso(newestIso, postTime);
        backfillProcessed += 1;
        this.report(`Processing sitemap post ${backfillProcessed}/${backfillPosts.length}: ${post.title}`);
        entities.push(await this.postToEntity(post));
        seenIds.add(post.id);
      }
    }

    return {
      entities,
      nextCursor: {
        watermark: newestIso,
        seenIds: Array.from(seenIds).slice(-DEFAULT_SEEN_WINDOW),
        backfillComplete: this.shouldRunBackfill(c) ? true : c.backfillComplete,
      } satisfies RssSyncCursor,
      hasMore: false,
      deletedExternalIds: [],
    };
  }

  private report(message: string): void {
    this.progressCallback?.(message);
  }

  private shouldRunBackfill(cursor: RssSyncCursor): boolean {
    return this.config.sitemapBackfill !== false && cursor.backfillComplete !== true;
  }

  private shouldInclude(post: ParsedFeedPost, watermark: string | undefined, seenIds: Set<string>): boolean {
    if (!watermark) return true;
    const t = post.updatedAt ?? post.publishedAt;
    if (!t) return !seenIds.has(post.id);
    // Strict `>` so a post whose timestamp equals the stored watermark (i.e.
    // the last sync's newest post) doesn't get reprocessed every run — that
    // was re-downloading its image attachments on every sync.
    return new Date(t).getTime() > new Date(watermark).getTime() || !seenIds.has(post.id);
  }

  private async fetchFeedPosts(): Promise<ParsedFeedPost[]> {
    const all: ParsedFeedPost[] = [];
    let url: string | undefined = this.config.feedUrl;
    let page = 0;
    const seenFeeds = new Set<string>();

    while (url && page < FEED_PAGE_LIMIT && !seenFeeds.has(url)) {
      seenFeeds.add(url);
      page += 1;
      const { posts, nextFeedUrl } = await this.fetchFeedPage(url);
      this.report(`Fetched feed page ${page} with ${posts.length} post(s)`);
      all.push(...posts);
      url = nextFeedUrl;
      if (this.config.maxItems && all.length >= this.config.maxItems) break;
    }

    const deduped = new Map<string, ParsedFeedPost>();
    for (const post of all) {
      if (!deduped.has(post.id)) deduped.set(post.id, post);
    }
    return Array.from(deduped.values());
  }

  private async fetchFeedPage(url: string): Promise<FeedPageResult> {
    const xml = await this.fetchText(url);
    const parsed = this.parser.parse(xml) as Record<string, unknown>;

    const rssChannel = (parsed.rss as Record<string, unknown> | undefined)?.channel as Record<string, unknown> | undefined;
    if (rssChannel) {
      const items = arr(rssChannel.item as Record<string, unknown> | Record<string, unknown>[])
        .map((item) => this.parseRssItem(item))
        .filter((item): item is ParsedFeedPost => !!item);
      return { posts: items };
    }

    const atomFeed = parsed.feed as Record<string, unknown> | undefined;
    if (!atomFeed) {
      throw new Error(`Unsupported feed format: ${url}`);
    }

    const entries = arr(atomFeed.entry as Record<string, unknown> | Record<string, unknown>[])
      .map((entry) => this.parseAtomEntry(entry))
      .filter((item): item is ParsedFeedPost => !!item);

    let nextFeedUrl: string | undefined;
    for (const link of arr(atomFeed.link as Record<string, unknown> | Record<string, unknown>[])) {
      if ((link.rel as string | undefined) === "next" && typeof link.href === "string") {
        nextFeedUrl = new URL(link.href, url).toString();
      }
    }

    return { posts: entries, nextFeedUrl };
  }

  private parseRssItem(item: Record<string, unknown>): ParsedFeedPost | null {
    const rawLink = text(item.link) ?? text((item.guid as Record<string, unknown> | undefined)?.["#text"]) ?? text(item.guid);
    if (!rawLink) return null;
    const link = normalizeUrl(rawLink);
    const title = text(item.title) ?? link;
    const guid = text(item.guid);

    const contentHtml =
      text(item["content:encoded"]) ??
      text(item.description);

    const tags = arr(item.category).map((c) => text(c)).filter((v): v is string => !!v);
    const author = text(item["dc:creator"]) ?? text(item.author);
    const publishedAt = toIso(text(item.pubDate));
    const updatedAt = toIso(text(item.updated) ?? text(item.lastBuildDate));

    const imageUrls = this.extractMediaUrls(item, contentHtml);

    return {
      id: normalizeUrl(guid ?? link),
      url: link,
      title,
      publishedAt,
      updatedAt,
      author,
      tags,
      summary: text(item.description),
      contentHtml,
      imageUrls,
    };
  }

  private parseAtomEntry(entry: Record<string, unknown>): ParsedFeedPost | null {
    const links = arr(entry.link as Record<string, unknown> | Record<string, unknown>[]);
    const preferredLink = links.find((l) => !l.rel || l.rel === "alternate") ?? links[0];
    const href = typeof preferredLink?.href === "string" ? preferredLink.href : undefined;
    if (!href) return null;

    const link = normalizeUrl(href);
    const title = text(entry.title) ?? link;
    const id = text(entry.id) ?? link;
    const contentHtml = text(entry.content) ?? text(entry.summary);
    const tags = arr(entry.category)
      .map((c) => {
        if (typeof c === "object" && c && typeof (c as Record<string, unknown>).term === "string") {
          return String((c as Record<string, unknown>).term);
        }
        return text(c);
      })
      .filter((v): v is string => !!v);

    let author: string | undefined;
    const atomAuthor = entry.author as Record<string, unknown> | Record<string, unknown>[] | undefined;
    const firstAuthor = arr(atomAuthor)[0];
    if (firstAuthor && typeof firstAuthor === "object") {
      author = text((firstAuthor as Record<string, unknown>).name) ?? text((firstAuthor as Record<string, unknown>).email);
    }

    const imageUrls = this.extractMediaUrls(entry, contentHtml);

    return {
      id: normalizeUrl(id),
      url: link,
      title,
      publishedAt: toIso(text(entry.published)),
      updatedAt: toIso(text(entry.updated)),
      author,
      tags,
      summary: text(entry.summary),
      contentHtml,
      imageUrls,
    };
  }

  private extractMediaUrls(node: Record<string, unknown>, html?: string): string[] {
    const urls = new Set<string>();

    for (const enclosure of arr(node.enclosure as Record<string, unknown> | Record<string, unknown>[])) {
      if (typeof enclosure?.url === "string") urls.add(enclosure.url);
    }
    for (const media of arr(node["media:content"] as Record<string, unknown> | Record<string, unknown>[])) {
      if (typeof media?.url === "string") urls.add(media.url);
    }
    for (const mediaThumb of arr(node["media:thumbnail"] as Record<string, unknown> | Record<string, unknown>[])) {
      if (typeof mediaThumb?.url === "string") urls.add(mediaThumb.url);
    }

    if (html) {
      const re = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(html)) !== null) {
        urls.add(m[1]);
      }
    }

    return Array.from(urls)
      .map((u) => u.trim())
      .filter((u) => u.startsWith("http://") || u.startsWith("https://"));
  }

  private async discoverSitemaps(): Promise<string[]> {
    const candidates = new Set<string>();
    const siteUrl = this.config.siteUrl ?? this.urlOrigin(this.config.feedUrl);
    if (!siteUrl) return [];

    const base = siteUrl.replace(/\/$/, "");
    candidates.add(`${base}/sitemap.xml`);
    candidates.add(`${base}/sitemap_index.xml`);
    candidates.add(`${base}/wp-sitemap.xml`);

    try {
      const robots = await this.fetchText(`${base}/robots.txt`);
      for (const line of robots.split("\n")) {
        const m = line.match(/^\s*Sitemap:\s*(\S+)/i);
        if (m) candidates.add(m[1].trim());
      }
    } catch {
      // optional
    }

    return Array.from(candidates);
  }

  private async fetchBackfillPosts(sitemapCandidates: string[], seenIds: Set<string>, remainingLimit?: number): Promise<ParsedFeedPost[]> {
    const posts: ParsedFeedPost[] = [];
    const visited = new Set<string>();
    const queue = [...sitemapCandidates];

    while (queue.length > 0 && visited.size < SITEMAP_LIMIT) {
      const sitemapUrl = queue.shift()!;
      if (visited.has(sitemapUrl)) continue;
      visited.add(sitemapUrl);
      this.report(`Scanning sitemap ${visited.size}/${SITEMAP_LIMIT}: ${sitemapUrl}`);

      try {
        const parsed = await this.fetchSitemap(sitemapUrl);
        for (const nested of parsed.sitemapUrls) {
          if (!visited.has(nested)) queue.push(nested);
        }
        for (const page of parsed.pageUrls) {
          const canonical = normalizeUrl(page.url);
          const id = canonical;
          if (seenIds.has(id)) continue;
          posts.push({
            id,
            url: canonical,
            title: this.titleFromUrl(canonical),
            publishedAt: toIso(page.lastmod),
            updatedAt: toIso(page.lastmod),
            tags: [],
            imageUrls: [],
          });
          seenIds.add(id);
          if (posts.length % 25 === 0) {
            this.report(`Discovered ${posts.length} candidate post(s) from sitemaps`);
          }
          if (remainingLimit && posts.length >= remainingLimit) return posts;
        }
      } catch {
        // Ignore invalid sitemap docs.
      }
    }

    return posts;
  }

  private async fetchSitemap(url: string): Promise<ParsedSitemap> {
    const xml = await this.fetchText(url);
    const parsed = this.parser.parse(xml) as Record<string, unknown>;

    const indexNode = parsed.sitemapindex as Record<string, unknown> | undefined;
    if (indexNode) {
      const nested = arr(indexNode.sitemap as Record<string, unknown> | Record<string, unknown>[])
        .map((s) => text((s as Record<string, unknown>).loc))
        .filter((v): v is string => !!v);
      return { type: "index", sitemapUrls: nested, pageUrls: [] };
    }

    const urlset = parsed.urlset as Record<string, unknown> | undefined;
    if (!urlset) throw new Error(`Unsupported sitemap format: ${url}`);

    const pageUrls: Array<{ url: string; lastmod?: string }> = [];
    for (const u of arr(urlset.url as Record<string, unknown> | Record<string, unknown>[])) {
      const loc = text((u as Record<string, unknown>).loc);
      if (!loc) continue;
      pageUrls.push({
        url: loc,
        lastmod: text((u as Record<string, unknown>).lastmod),
      });
    }

    return { type: "urlset", sitemapUrls: [], pageUrls };
  }

  private async postToEntity(post: ParsedFeedPost): Promise<CrawlerEntityData> {
    this.report(`Resolving content: ${post.title}`);
    const effectiveContent = await this.resolvePostContent(post);
    const images = new Set(post.imageUrls);
    for (const url of this.extractMediaUrls({}, effectiveContent.contentHtml)) {
      images.add(url);
    }

    const attachments = await this.downloadImageAttachments(post, Array.from(images));

    const hash = createCryptoHasher("sha256");
    hash.update(post.id);
    hash.update(post.title);
    hash.update(effectiveContent.contentText);
    if (post.updatedAt) hash.update(post.updatedAt);
    if (post.publishedAt) hash.update(post.publishedAt);

    return {
      externalId: post.id,
      entityType: "post",
      title: post.title,
      url: post.url,
      tags: post.tags,
      contentHash: hash.digest("hex"),
      data: {
        id: post.id,
        url: post.url,
        publishedAt: post.publishedAt,
        updatedAt: post.updatedAt,
        author: post.author,
        tags: post.tags,
        summary: post.summary,
        contentHtml: effectiveContent.contentHtml,
        contentText: effectiveContent.contentText,
        assets: attachments?.map((a) => ({
          filename: a.filename,
          storagePath: a.storagePath,
          mimeType: a.mimeType,
        })),
      },
      attachments,
    };
  }

  private async resolvePostContent(post: ParsedFeedPost): Promise<{ contentHtml: string; contentText: string }> {
    let contentHtml = post.contentHtml ?? "";

    if (!contentHtml && this.config.fetchArticleContent !== false) {
      try {
        this.report(`Fetching article HTML: ${post.url}`);
        const articleHtml = await this.fetchArticleHtml(post.url);
        if (articleHtml) contentHtml = articleHtml;
      } catch {
        // Keep feed-only fallback.
      }
    }

    const summary = post.summary ?? "";
    const contentText = stripTags(contentHtml || summary);
    return { contentHtml, contentText };
  }

  private async fetchArticleHtml(url: string): Promise<string | undefined> {
    const html = await this.fetchText(url);
    const article = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i)?.[0]
      ?? html.match(/<main[^>]*>([\s\S]*?)<\/main>/i)?.[0]
      ?? html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[0];
    return article;
  }

  private async downloadImageAttachments(post: ParsedFeedPost, imageUrls: string[]): Promise<CrawlerEntityData["attachments"]> {
    const attachments: NonNullable<CrawlerEntityData["attachments"]> = [];
    const seen = new Set<string>();

    for (const imageUrl of imageUrls) {
      if (seen.has(imageUrl)) continue;
      seen.add(imageUrl);

      const ext = fileExt(imageUrl);
      if (!IMAGE_EXTENSIONS.has(ext)) continue;
      if (this.assetFilter && !this.assetFilter.allowedExtensions.has(ext)) continue;

      try {
        this.report(`Downloading image for "${post.title}": ${imageUrl}`);
        const res = await this.fetchFn(imageUrl);
        if (!res.ok) continue;

        const len = Number(res.headers.get("content-length") || "0");
        if (this.assetFilter && len > 0 && len > this.assetFilter.maxSizeBytes) continue;

        const bytes = new Uint8Array(await res.arrayBuffer());
        if (this.assetFilter && bytes.length > this.assetFilter.maxSizeBytes) continue;

        const digest = createCryptoHasher("sha256");
        digest.update(imageUrl);
        const short = digest.digest("hex").slice(0, 10);
        const baseName = this.safeFilenameFromUrl(imageUrl, ext, short);
        const year = this.yearPath(post.publishedAt ?? post.updatedAt);
        const stamp = this.dateStamp(post.publishedAt ?? post.updatedAt);
        const storagePath = `attachments/rss/${year}/${stamp}-${baseName}`;

        attachments.push({
          filename: baseName,
          mimeType: guessMimeType(imageUrl, res.headers.get("content-type")),
          content: bytes,
          storagePath,
        });
      } catch {
        // Skip unreachable asset URLs.
      }
    }

    return attachments.length > 0 ? attachments : undefined;
  }

  private safeFilenameFromUrl(url: string, ext: string, fallback: string): string {
    const path = url.split("?")[0];
    const raw = path.split("/").pop() ?? "";
    const cleaned = raw.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-|-$/g, "");
    if (cleaned && cleaned.includes(".")) return cleaned;
    return `image-${fallback}${ext || ".bin"}`;
  }

  private yearPath(iso: string | undefined): string {
    const d = iso ? new Date(iso) : new Date();
    if (Number.isNaN(d.getTime())) return "undated";
    return String(d.getUTCFullYear());
  }

  private dateStamp(iso: string | undefined): string {
    const d = iso ? new Date(iso) : new Date();
    if (Number.isNaN(d.getTime())) return "00000000";
    const y = String(d.getUTCFullYear());
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}${m}${day}`;
  }

  private titleFromUrl(url: string): string {
    const path = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "post";
    return slugify(path).replace(/-/g, " ") || "post";
  }

  private urlOrigin(url: string): string | undefined {
    try {
      return new URL(url).origin;
    } catch {
      return undefined;
    }
  }

  private async fetchText(url: string): Promise<string> {
    const res = await this.fetchFn(url);
    if (!res.ok) throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
    return await res.text();
  }
}
