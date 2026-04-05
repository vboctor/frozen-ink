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
  it("produces [[target]] syntax", () => {
    expect(wikilink("My Page")).toBe("[[My Page]]");
  });

  it("produces [[target|label]] syntax with label", () => {
    expect(wikilink("My Page", "click here")).toBe("[[My Page|click here]]");
  });

  it("handles paths with slashes", () => {
    expect(wikilink("folder/page")).toBe("[[folder/page]]");
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
  it("produces ![[path]] syntax", () => {
    expect(embed("image.png")).toBe("![[image.png]]");
  });

  it("handles paths with folders", () => {
    expect(embed("attachments/photo.jpg")).toBe("![[attachments/photo.jpg]]");
  });
});
