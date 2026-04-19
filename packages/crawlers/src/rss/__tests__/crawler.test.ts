import { beforeEach, describe, expect, it } from "bun:test";
import { RssCrawler } from "../crawler";

function textResponse(body: string, status = 200, contentType = "application/xml"): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": contentType },
  });
}

describe("RssCrawler", () => {
  let crawler: RssCrawler;

  beforeEach(async () => {
    crawler = new RssCrawler();
    await crawler.initialize({
      feedUrl: "https://example.com/feed.xml",
      siteUrl: "https://example.com",
      sitemapBackfill: true,
      fetchArticleContent: true,
    });
  });

  it("syncs feed entries on initial run", async () => {
    crawler.setFetch(async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/feed.xml")) {
        return textResponse(`<?xml version="1.0"?>
          <rss><channel>
            <item>
              <guid>post-1</guid>
              <title>First Post</title>
              <link>https://example.com/posts/first</link>
              <pubDate>Tue, 14 Jan 2025 12:00:00 GMT</pubDate>
              <description><![CDATA[<p>Hello</p>]]></description>
            </item>
          </channel></rss>`);
      }
      if (url.endsWith("/robots.txt")) return textResponse("", 404, "text/plain");
      if (url.includes("sitemap")) return textResponse("<urlset></urlset>");
      return textResponse("", 404);
    });

    const result = await crawler.sync(null);
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].externalId).toBe("post-1");
    expect(result.entities[0].entityType).toBe("post");
    expect((result.nextCursor as { watermark?: string }).watermark).toBeTruthy();
  });

  it("runs incremental sync by watermark and seen IDs", async () => {
    crawler.setFetch(async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/feed.xml")) {
        return textResponse(`<?xml version="1.0"?>
          <rss><channel>
            <item>
              <guid>old</guid>
              <title>Old</title>
              <link>https://example.com/posts/old</link>
              <pubDate>Tue, 14 Jan 2025 12:00:00 GMT</pubDate>
            </item>
            <item>
              <guid>new</guid>
              <title>New</title>
              <link>https://example.com/posts/new</link>
              <pubDate>Tue, 15 Jan 2025 12:00:00 GMT</pubDate>
            </item>
          </channel></rss>`);
      }
      if (url.endsWith("/robots.txt")) return textResponse("", 404, "text/plain");
      if (url.includes("sitemap")) return textResponse("<urlset></urlset>");
      return textResponse("", 404);
    });

    const result = await crawler.sync({
      watermark: "2025-01-15T00:00:00.000Z",
      seenIds: ["old"],
      backfillComplete: true,
    });
    expect(result.entities.map((e) => e.externalId)).toEqual(["new"]);
  });

  it("backfills from sitemap URLs on first sync", async () => {
    crawler.setFetch(async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/feed.xml")) {
        return textResponse(`<?xml version="1.0"?>
          <rss><channel>
            <item>
              <guid>post-1</guid>
              <title>Latest</title>
              <link>https://example.com/posts/latest</link>
              <pubDate>Tue, 15 Jan 2025 12:00:00 GMT</pubDate>
            </item>
          </channel></rss>`);
      }
      if (url.endsWith("/robots.txt")) {
        return textResponse("Sitemap: https://example.com/sitemap.xml", 200, "text/plain");
      }
      if (url.endsWith("/sitemap.xml")) {
        return textResponse(`<?xml version="1.0"?>
          <urlset>
            <url><loc>https://example.com/posts/older-one</loc><lastmod>2024-01-01</lastmod></url>
            <url><loc>https://example.com/posts/older-two</loc><lastmod>2024-01-02</lastmod></url>
          </urlset>`);
      }
      if (url.endsWith("/sitemap_index.xml") || url.endsWith("/wp-sitemap.xml")) {
        return textResponse("<urlset></urlset>");
      }
      if (url.includes("/posts/older-")) {
        return textResponse("<html><body><article>Older body</article></body></html>", 200, "text/html");
      }
      return textResponse("", 404);
    });

    const result = await crawler.sync(null);
    expect(result.entities.map((e) => e.externalId).sort()).toEqual([
      "https://example.com/posts/older-one",
      "https://example.com/posts/older-two",
      "post-1",
    ]);
    expect((result.nextCursor as { backfillComplete?: boolean }).backfillComplete).toBe(true);
  });

  it("downloads image attachments from feed content", async () => {
    crawler.setFetch(async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/feed.xml")) {
        return textResponse(`<?xml version="1.0"?>
          <rss><channel>
            <item>
              <guid>post-1</guid>
              <title>With Image</title>
              <link>https://example.com/posts/with-image</link>
              <pubDate>Tue, 14 Jan 2025 12:00:00 GMT</pubDate>
              <description><![CDATA[<p>Body</p><img src="https://cdn.example.com/pic.jpg" />]]></description>
            </item>
          </channel></rss>`);
      }
      if (url === "https://cdn.example.com/pic.jpg") {
        return new Response(Uint8Array.from([1, 2, 3]), {
          status: 200,
          headers: {
            "Content-Type": "image/jpeg",
            "Content-Length": "3",
          },
        });
      }
      if (url.endsWith("/robots.txt")) return textResponse("", 404, "text/plain");
      if (url.includes("sitemap")) return textResponse("<urlset></urlset>");
      return textResponse("", 404);
    });

    const result = await crawler.sync({ backfillComplete: true });
    expect(result.entities).toHaveLength(1);
    const attachments = result.entities[0].attachments ?? [];
    expect(attachments).toHaveLength(1);
    expect(attachments[0].filename.endsWith(".jpg")).toBe(true);
    expect(attachments[0].storagePath?.includes("attachments/rss/2025/20250114-")).toBe(true);
  });
});
