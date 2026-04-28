import { describe, expect, it } from "bun:test";
import { enmlToMarkdown, parseEvernoteRecognitionXml } from "../enml";

const noResources = { resourceByHash: {} };

describe("enmlToMarkdown", () => {
  it("strips the en-note wrapper and produces clean markdown", () => {
    const enml = `<?xml version="1.0"?><!DOCTYPE en-note SYSTEM "..."><en-note><p>Hello <strong>world</strong></p></en-note>`;
    expect(enmlToMarkdown(enml, noResources).trim()).toBe("Hello **world**");
  });

  it("renders en-todo as GFM checkboxes", () => {
    const enml = `<en-note><en-todo checked="true"/>Done<br/><en-todo/>Pending</en-note>`;
    const md = enmlToMarkdown(enml, noResources);
    expect(md).toContain("- [x] Done");
    expect(md).toContain("- [ ] Pending");
  });

  it("substitutes en-media references with image and link refs", () => {
    const enml = `<en-note><en-media hash="abc" type="image/png"/><en-media hash="def" type="application/pdf"/></en-note>`;
    const md = enmlToMarkdown(enml, {
      resourceByHash: {
        abc: { filename: "pic.png", mimeType: "image/png", assetPath: "attachments/evernote/x/pic.png" },
        def: { filename: "doc.pdf", mimeType: "application/pdf", assetPath: "attachments/evernote/x/doc.pdf" },
      },
    });
    expect(md).toContain("![pic.png](attachments/evernote/x/pic.png)");
    expect(md).toContain("[doc.pdf](attachments/evernote/x/doc.pdf)");
  });

  it("converts links and headings", () => {
    const enml = `<en-note><h2>Title</h2><a href="https://x">x</a></en-note>`;
    const md = enmlToMarkdown(enml, noResources);
    expect(md).toContain("## Title");
    expect(md).toContain("[x](https://x)");
  });

  it("encrypted blocks are replaced with a placeholder", () => {
    const enml = `<en-note><en-crypt cipher="RC2" length="64">…</en-crypt></en-note>`;
    expect(enmlToMarkdown(enml, noResources)).toContain("[encrypted content]");
  });
});

describe("parseEvernoteRecognitionXml", () => {
  it("returns an empty string for empty input", () => {
    expect(parseEvernoteRecognitionXml("")).toBe("");
    expect(parseEvernoteRecognitionXml("<recoIndex/>")).toBe("");
  });

  it("picks the highest-confidence token per item", () => {
    const xml = `
      <recoIndex>
        <item><t w="50">helo</t><t w="80">hello</t></item>
        <item><t w="30">wrld</t><t w="90">world</t></item>
      </recoIndex>`;
    expect(parseEvernoteRecognitionXml(xml)).toBe("hello world");
  });
});
