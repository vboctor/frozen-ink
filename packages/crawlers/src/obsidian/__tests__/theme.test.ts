import { describe, it, expect } from "bun:test";
import { ObsidianTheme } from "../theme";
import type { ThemeRenderContext } from "@frozenink/core";

const theme = new ObsidianTheme();

function makeContext(
  overrides: Partial<ThemeRenderContext["entity"]> & {
    content?: string;
    relativePath?: string;
    imageRefMap?: Record<string, string>;
  } = {},
  contextOverrides: Partial<Omit<ThemeRenderContext, "entity">> = {},
): ThemeRenderContext {
  return {
    entity: {
      externalId: overrides.externalId ?? "notes/test.md",
      entityType: overrides.entityType ?? "note",
      title: overrides.title ?? "Test Note",
      data: {
        content: overrides.content ?? "# Test Note\n\nSome content.",
        relativePath: overrides.relativePath ?? "notes/test.md",
        imageRefMap: overrides.imageRefMap ?? {},
      },
      url: undefined,
      tags: overrides.tags ?? [],
    },
    collectionName: "my-vault",
    crawlerType: "obsidian",
    ...contextOverrides,
  };
}

describe("ObsidianTheme", () => {
  it("has correct crawlerType", () => {
    expect(theme.crawlerType).toBe("obsidian");
  });

  it("returns vault-relative path as file path", () => {
    const ctx = makeContext({ relativePath: "projects/alpha/readme.md" });
    expect(theme.getFilePath(ctx)).toBe("projects/alpha/readme.md");
  });

  it("preserves nested directory structure in file path", () => {
    const ctx = makeContext({ relativePath: "daily/2024/01/15.md" });
    expect(theme.getFilePath(ctx)).toBe("daily/2024/01/15.md");
  });

  // --- Wikilink conversion ---

  it("converts wikilinks to standard markdown links using resolveWikilink", () => {
    const ctx = makeContext(
      { content: "See [[Other Note]] for details.", relativePath: "notes/test.md" },
      { resolveWikilink: (t) => (t === "Other Note" ? "notes/Other Note" : undefined) },
    );
    const md = theme.render(ctx);
    // Same directory → just filename
    expect(md).toContain("[Other Note](Other Note.md)");
    expect(md).not.toContain("[[");
  });

  it("resolves bare wikilink to file in a different folder via stem matching", () => {
    const ctx = makeContext(
      { content: "See [[Topic]] for info.", relativePath: "notes/test.md" },
      { resolveWikilink: (t) => (t === "Topic" ? "projects/Topic" : undefined) },
    );
    const md = theme.render(ctx);
    // notes/test.md → ../projects/Topic.md
    expect(md).toContain("[Topic](../projects/Topic.md)");
  });

  it("converts labeled wikilinks with correct relative path", () => {
    const ctx = makeContext(
      { content: "Read [[guides/setup|Setup Guide]] first.", relativePath: "notes/test.md" },
      { resolveWikilink: (t) => (t === "guides/setup" ? "guides/setup" : undefined) },
    );
    const md = theme.render(ctx);
    expect(md).toContain("[Setup Guide](../guides/setup.md)");
  });

  it("renders unresolved wikilinks as plain text", () => {
    const ctx = makeContext(
      { content: "See [[Missing Page]] here.", relativePath: "notes/test.md" },
      { resolveWikilink: () => undefined },
    );
    const md = theme.render(ctx);
    expect(md).toContain("Missing Page");
    expect(md).not.toContain("[[");
    expect(md).not.toContain("](");
  });

  it("renders unresolved labeled wikilinks using the label text", () => {
    const ctx = makeContext(
      { content: "See [[gone|Click Here]] now.", relativePath: "notes/test.md" },
      { resolveWikilink: () => undefined },
    );
    const md = theme.render(ctx);
    expect(md).toContain("Click Here");
    expect(md).not.toContain("[[");
  });

  it("resolves bare wikilink from deeply nested file to different folder", () => {
    const ctx = makeContext(
      { content: "See [[Topic]] here.", relativePath: "daily/2024/01/note.md" },
      { resolveWikilink: (t) => (t === "Topic" ? "projects/Topic" : undefined) },
    );
    const md = theme.render(ctx);
    // daily/2024/01/note.md → ../../../projects/Topic.md
    expect(md).toContain("[Topic](../../../projects/Topic.md)");
  });

  it("resolves path-qualified wikilink across folders", () => {
    const ctx = makeContext(
      { content: "See [[projects/setup]] here.", relativePath: "notes/test.md" },
      { resolveWikilink: (t) => (t === "projects/setup" ? "projects/setup" : undefined) },
    );
    const md = theme.render(ctx);
    expect(md).toContain("[setup](../projects/setup.md)");
  });

  it("strips section anchors from wikilinks for resolution", () => {
    const ctx = makeContext(
      { content: "See [[Topic#section-two]] here.", relativePath: "notes/test.md" },
      { resolveWikilink: (t) => (t === "Topic" ? "guides/Topic" : undefined) },
    );
    const md = theme.render(ctx);
    expect(md).toContain("[Topic](../guides/Topic.md)");
    expect(md).not.toContain("#section-two");
  });

  it("handles multiple wikilinks in same content (resolved and unresolved)", () => {
    const ctx = makeContext(
      { content: "See [[Found]] and [[Missing]] and [[Also Found]].", relativePath: "notes/test.md" },
      {
        resolveWikilink: (t) => {
          if (t === "Found") return "docs/Found";
          if (t === "Also Found") return "notes/Also Found";
          return undefined;
        },
      },
    );
    const md = theme.render(ctx);
    expect(md).toContain("[Found](../docs/Found.md)");
    expect(md).toContain("Missing");
    expect(md).not.toContain("[[Missing]]");
    expect(md).toContain("[Also Found](Also Found.md)");
  });

  // --- Image embed conversion ---

  it("converts image embeds to standard markdown using imageRefMap", () => {
    const ctx = makeContext({
      content: "![[photo.png]]",
      relativePath: "notes/test.md",
      imageRefMap: { "photo.png": "images/photo.png" },
    });
    const md = theme.render(ctx);
    // notes/test.md (markdown/notes/test.md) → ../../attachments/images/photo.png
    expect(md).toContain("![photo](../../attachments/images/photo.png)");
    expect(md).not.toContain("![[");
  });

  it("handles image embeds with pipe sizing (Obsidian |400 syntax)", () => {
    const ctx = makeContext({
      content: "![[photo.png|400]]",
      relativePath: "notes/test.md",
      imageRefMap: { "photo.png": "images/photo.png" },
    });
    const md = theme.render(ctx);
    expect(md).toContain("![photo](../../attachments/images/photo.png)");
  });

  it("uses raw ref as fallback when imageRefMap has no entry", () => {
    const ctx = makeContext({
      content: "![[unknown.png]]",
      relativePath: "notes/test.md",
      imageRefMap: {},
    });
    const md = theme.render(ctx);
    expect(md).toContain("![unknown](../../attachments/unknown.png)");
  });

  it("computes correct image relative path from deeply nested file", () => {
    const ctx = makeContext({
      content: "![[diagram.png]]",
      relativePath: "projects/alpha/docs/readme.md",
      imageRefMap: { "diagram.png": "assets/diagram.png" },
    });
    const md = theme.render(ctx);
    // markdown/projects/alpha/docs/readme.md → ../../../../attachments/assets/diagram.png
    expect(md).toContain("![diagram](../../../../attachments/assets/diagram.png)");
  });

  // --- H1 header injection ---

  it("preserves existing H1 header", () => {
    const ctx = makeContext({
      content: "# My Title\n\nBody text.",
      relativePath: "notes/my-note.md",
    });
    const md = theme.render(ctx);
    expect(md).toContain("# My Title");
    // Should NOT prepend another H1
    expect(md).not.toContain("# my-note");
  });

  it("adds H1 from filename when content has no H1", () => {
    const ctx = makeContext({
      content: "Just some body text without a heading.",
      relativePath: "notes/daily-standup.md",
    });
    const md = theme.render(ctx);
    expect(md).toStartWith("# daily-standup\n\n");
    expect(md).toContain("Just some body text");
  });

  it("adds H1 after frontmatter when content has no H1", () => {
    const ctx = makeContext({
      content: "---\ntags: [journal]\n---\n\nNo heading here.",
      relativePath: "daily/2024-01-15.md",
    });
    const md = theme.render(ctx);
    expect(md).toStartWith("---\ntags: [journal]\n---\n\n# 2024-01-15\n\n");
    expect(md).toContain("No heading here.");
  });

  it("does not treat H1 inside code block as real H1", () => {
    const ctx = makeContext({
      content: "```\n# This is code\n```\n\nBody.",
      relativePath: "notes/snippet.md",
    });
    const md = theme.render(ctx);
    expect(md).toContain("# snippet\n\n");
  });

  it("adds H1 when content only has H2 headings", () => {
    const ctx = makeContext({
      content: "## Section One\n\nBody.\n\n## Section Two\n\nMore.",
      relativePath: "notes/my-topic.md",
    });
    const md = theme.render(ctx);
    expect(md).toStartWith("# my-topic\n\n");
    expect(md).toContain("## Section One");
  });

  it("adds H1 for empty body content", () => {
    const ctx = makeContext({
      content: "",
      relativePath: "notes/empty.md",
    });
    const md = theme.render(ctx);
    expect(md).toBe("# empty\n\n");
  });

  it("preserves frontmatter in rendered output when H1 exists", () => {
    const content = "---\ntitle: Test\ntags: [a, b]\n---\n\n# Test\n\nContent.";
    const ctx = makeContext({ content, relativePath: "notes/test.md" });
    const md = theme.render(ctx);
    expect(md).toContain("---\ntitle: Test");
    expect(md).toContain("# Test");
  });
});
