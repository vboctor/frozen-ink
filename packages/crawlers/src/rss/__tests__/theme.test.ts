import { describe, expect, it } from "bun:test";
import { RssTheme } from "../theme";
import type { ThemeRenderContext } from "@frozenink/core/theme";

const theme = new RssTheme();

function makeContext(overrides: Partial<ThemeRenderContext["entity"]> = {}): ThemeRenderContext {
  return {
    entity: {
      externalId: "post-1",
      entityType: "post",
      title: "My Post",
      url: "https://example.com/posts/my-post",
      tags: ["rss", "test"],
      data: {
        title: "My Post",
        publishedAt: "2025-01-14T12:00:00.000Z",
        updatedAt: "2025-01-14T12:00:00.000Z",
        summary: "Summary text",
        contentText: "Body text",
        assets: [
          {
            filename: "pic.jpg",
            storagePath: "attachments/rss/2025/20250114-pic.jpg",
          },
        ],
      },
      ...overrides,
    },
    collectionName: "rss-demo",
    crawlerType: "rss",
  };
}

describe("RssTheme", () => {
  it("renders markdown with frontmatter and body", () => {
    const md = theme.render(makeContext());
    expect(md).toContain("title: My Post");
    expect(md).toContain("# My Post");
    expect(md).toContain("Body text");
  });

  it("renders image references from asset storage paths", () => {
    const md = theme.render(makeContext());
    expect(md).toContain("![pic](../../attachments/rss/2025/20250114-pic.jpg)");
  });

  it("builds deterministic dated file paths", () => {
    const path = theme.getFilePath(makeContext());
    expect(path).toBe("2025/20250114-my-post.md");
  });

  it("preserves paragraph breaks from HTML content", () => {
    const md = theme.render(
      makeContext({
        data: {
          title: "My Post",
          publishedAt: "2025-01-14T12:00:00.000Z",
          contentHtml: "<p>One.</p><p>Two.</p>",
          assets: [],
        },
      }),
    );
    expect(md).toContain("One.\n\nTwo.");
  });
});
