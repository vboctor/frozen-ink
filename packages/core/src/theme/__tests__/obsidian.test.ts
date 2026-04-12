import { describe, it, expect } from "bun:test";
import { frontmatter, wikilink, callout, embed } from "../obsidian";

describe("frontmatter", () => {
  it("produces valid YAML frontmatter with simple fields", () => {
    const result = frontmatter({ title: "My Note", tags: ["a", "b"] });
    expect(result).toStartWith("---\n");
    expect(result).toEndWith("\n---");
    expect(result).toContain("title: My Note");
    expect(result).toContain("  - a");
    expect(result).toContain("  - b");
  });

  it("handles string, number, boolean, and null values", () => {
    const result = frontmatter({
      name: "test",
      count: 42,
      active: true,
      deleted: false,
      nothing: null,
    });
    expect(result).toContain("name: test");
    expect(result).toContain("count: 42");
    expect(result).toContain("active: true");
    expect(result).toContain("deleted: false");
    expect(result).toContain("nothing: null");
  });

  it("quotes strings that contain special characters", () => {
    const result = frontmatter({
      label: "key: value",
      comment: "has # hash",
    });
    expect(result).toContain('label: "key: value"');
    expect(result).toContain('comment: "has # hash"');
  });

  it("quotes YAML reserved words", () => {
    const result = frontmatter({ status: "true", flag: "yes" });
    expect(result).toContain('status: "true"');
    expect(result).toContain('flag: "yes"');
  });

  it("handles empty fields object", () => {
    const result = frontmatter({});
    expect(result).toBe("---\n---");
  });

  it("handles empty arrays", () => {
    const result = frontmatter({ items: [] });
    expect(result).toContain("items: []");
  });
});

describe("wikilink", () => {
  it("produces root-relative link without sourcePath", () => {
    expect(wikilink("My Page")).toBe("[My Page](My Page.md)");
  });

  it("produces link with label without sourcePath", () => {
    expect(wikilink("My Page", "click here")).toBe("[click here](My Page.md)");
  });

  it("handles paths with slashes without sourcePath", () => {
    expect(wikilink("folder/page")).toBe("[folder/page](folder/page.md)");
  });

  it("produces same-directory relative link when source and target share a folder", () => {
    // commits/abc.md → commits/def.md = just "def.md"
    expect(wikilink("commits/def", "def", "commits/abc.md")).toBe("[def](def.md)");
  });

  it("produces cross-directory relative link", () => {
    // branches/main.md → commits/abc.md = "../commits/abc.md"
    expect(wikilink("commits/abc", "abc", "branches/main.md")).toBe("[abc](../commits/abc.md)");
  });

  it("handles deep source paths", () => {
    // project/issues/42.md → users/john = "../../users/john.md"
    expect(wikilink("users/john", "@john", "project/issues/42.md")).toBe("[@john](../../users/john.md)");
  });

  it("handles same-project cross-type paths", () => {
    // project/issues/42.md → project/issues/100 = "100.md"
    expect(wikilink("project/issues/100", "#100", "project/issues/42.md")).toBe("[#100](100.md)");
  });
});

describe("callout", () => {
  it("produces > [!type] title callout block", () => {
    const result = callout("info", "Note", "Some content here");
    expect(result).toBe("> [!info] Note\n> Some content here");
  });

  it("handles multi-line content", () => {
    const result = callout("warning", "Warning", "Line 1\nLine 2\nLine 3");
    expect(result).toBe(
      "> [!warning] Warning\n> Line 1\n> Line 2\n> Line 3",
    );
  });

  it("supports different callout types", () => {
    const result = callout("tip", "Pro Tip", "Use wikilinks");
    expect(result).toStartWith("> [!tip] Pro Tip");
  });
});

describe("embed", () => {
  it("produces default relative attachment path without sourcePath", () => {
    expect(embed("image.png")).toBe("![image](../../attachments/image.png)");
  });

  it("handles paths with folders without sourcePath", () => {
    expect(embed("git/abc1234/photo.jpg")).toBe("![photo](../../attachments/git/abc1234/photo.jpg)");
  });

  it("computes correct relative path from one-level-deep source", () => {
    // markdown/commits/abc.md → attachments/git/abc/logo.png
    expect(embed("git/abc/logo.png", "commits/abc.md")).toBe("![logo](../../attachments/git/abc/logo.png)");
  });

  it("computes correct relative path from two-level-deep source", () => {
    // markdown/project/issues/42.md → attachments/files/img.png
    expect(embed("files/img.png", "project/issues/42.md")).toBe("![img](../../../attachments/files/img.png)");
  });
});
