import { describe, it, expect } from "bun:test";
import { ObsidianTheme } from "../theme";
import type { ThemeRenderContext } from "@veecontext/core";

const theme = new ObsidianTheme();

function makeContext(overrides: Partial<ThemeRenderContext["entity"]> & { content?: string; relativePath?: string } = {}): ThemeRenderContext {
  return {
    entity: {
      externalId: overrides.externalId ?? "notes/test.md",
      entityType: overrides.entityType ?? "note",
      title: overrides.title ?? "Test Note",
      data: {
        content: overrides.content ?? "# Test Note\n\nSome content.",
        relativePath: overrides.relativePath ?? "notes/test.md",
      },
      url: undefined,
      tags: overrides.tags ?? [],
    },
    collectionName: "my-vault",
    crawlerType: "obsidian",
  };
}

describe("ObsidianTheme", () => {
  it("has correct crawlerType", () => {
    expect(theme.crawlerType).toBe("obsidian");
  });

  it("renders content as-is (passthrough)", () => {
    const ctx = makeContext({ content: "# Hello\n\n![[image.png]]\n\nSome text with [[wikilink]]." });
    const rendered = theme.render(ctx);
    expect(rendered).toBe("# Hello\n\n![[image.png]]\n\nSome text with [[wikilink]].");
  });

  it("preserves frontmatter in rendered output", () => {
    const content = "---\ntitle: Test\ntags: [a, b]\n---\n\n# Test\n\nContent.";
    const ctx = makeContext({ content });
    expect(theme.render(ctx)).toBe(content);
  });

  it("returns vault-relative path as file path", () => {
    const ctx = makeContext({ relativePath: "projects/alpha/readme.md" });
    expect(theme.getFilePath(ctx)).toBe("projects/alpha/readme.md");
  });

  it("preserves nested directory structure in file path", () => {
    const ctx = makeContext({ relativePath: "daily/2024/01/15.md" });
    expect(theme.getFilePath(ctx)).toBe("daily/2024/01/15.md");
  });
});
