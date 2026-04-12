import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, copyFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { ObsidianCrawler } from "../crawler";

let vaultDir: string;
let crawler: ObsidianCrawler;

beforeEach(() => {
  vaultDir = join(tmpdir(), `obsidian-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(vaultDir, { recursive: true });
  mkdirSync(join(vaultDir, ".obsidian"), { recursive: true });

  crawler = new ObsidianCrawler();
});

afterEach(() => {
  rmSync(vaultDir, { recursive: true, force: true });
});

function writeVaultFile(relativePath: string, content: string): void {
  const fullPath = join(vaultDir, relativePath);
  const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(fullPath, content);
}

function writeVaultBinary(relativePath: string, content: Buffer): void {
  const fullPath = join(vaultDir, relativePath);
  const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(fullPath, content);
}

describe("ObsidianCrawler", () => {
  it("has correct metadata", () => {
    expect(crawler.metadata.type).toBe("obsidian");
    expect(crawler.metadata.displayName).toBe("Obsidian Vault");
  });

  it("validates vault path exists", async () => {
    const valid = await crawler.validateCredentials({ vaultPath: vaultDir });
    expect(valid).toBe(true);
  });

  it("rejects invalid vault path", async () => {
    const valid = await crawler.validateCredentials({ vaultPath: "/nonexistent/path" });
    expect(valid).toBe(false);
  });

  it("rejects empty vault path", async () => {
    const valid = await crawler.validateCredentials({ vaultPath: "" });
    expect(valid).toBe(false);
  });

  it("syncs markdown files from vault", async () => {
    writeVaultFile("notes/hello.md", "# Hello World\n\nThis is a test note.");
    writeVaultFile("notes/second.md", "# Second Note\n\nAnother note.");

    await crawler.initialize({ vaultPath: vaultDir }, { vaultPath: vaultDir });
    const result = await crawler.sync(null);

    expect(result.entities.length).toBe(2);
    expect(result.hasMore).toBe(false);

    const hello = result.entities.find((e) => e.externalId === "notes/hello.md");
    expect(hello).toBeDefined();
    expect(hello!.title).toBe("Hello World");
    expect(hello!.entityType).toBe("note");
    expect(hello!.data.content).toBe("# Hello World\n\nThis is a test note.");
  });

  it("extracts title from H1 heading", async () => {
    writeVaultFile("test.md", "# My Title\n\nContent here.");
    await crawler.initialize({ vaultPath: vaultDir }, { vaultPath: vaultDir });
    const result = await crawler.sync(null);
    expect(result.entities[0].title).toBe("My Title");
  });

  it("falls back to filename for title when no H1", async () => {
    writeVaultFile("my-note.md", "Just some content without a heading.");
    await crawler.initialize({ vaultPath: vaultDir }, { vaultPath: vaultDir });
    const result = await crawler.sync(null);
    expect(result.entities[0].title).toBe("my-note");
  });

  it("extracts title from H1 after frontmatter", async () => {
    writeVaultFile("test.md", "---\ntags: [test]\n---\n\n# Post Frontmatter Title\n\nBody.");
    await crawler.initialize({ vaultPath: vaultDir }, { vaultPath: vaultDir });
    const result = await crawler.sync(null);
    expect(result.entities[0].title).toBe("Post Frontmatter Title");
  });

  it("extracts tags from frontmatter array", async () => {
    writeVaultFile("tagged.md", "---\ntags: [foo, bar, baz]\n---\n\n# Tagged Note");
    await crawler.initialize({ vaultPath: vaultDir }, { vaultPath: vaultDir });
    const result = await crawler.sync(null);
    expect(result.entities[0].tags).toEqual(["foo", "bar", "baz"]);
  });

  it("extracts tags from frontmatter list", async () => {
    writeVaultFile("tagged.md", "---\ntags:\n  - alpha\n  - beta\n---\n\n# Tagged Note");
    await crawler.initialize({ vaultPath: vaultDir }, { vaultPath: vaultDir });
    const result = await crawler.sync(null);
    expect(result.entities[0].tags).toEqual(["alpha", "beta"]);
  });

  it("extracts inline hashtags from body", async () => {
    writeVaultFile("tagged.md", "# Note\n\nThis has #inline and #tags in it.");
    await crawler.initialize({ vaultPath: vaultDir }, { vaultPath: vaultDir });
    const result = await crawler.sync(null);
    expect(result.entities[0].tags).toContain("inline");
    expect(result.entities[0].tags).toContain("tags");
  });

  it("skips .obsidian directory", async () => {
    writeVaultFile("note.md", "# Note");
    writeFileSync(join(vaultDir, ".obsidian", "workspace.json"), "{}");
    await crawler.initialize({ vaultPath: vaultDir }, { vaultPath: vaultDir });
    const result = await crawler.sync(null);
    expect(result.entities.length).toBe(1);
    expect(result.entities[0].externalId).toBe("note.md");
  });

  it("performs incremental sync based on mtime", async () => {
    writeVaultFile("old.md", "# Old Note");

    await crawler.initialize({ vaultPath: vaultDir }, { vaultPath: vaultDir });
    const firstResult = await crawler.sync(null);
    expect(firstResult.entities.length).toBe(1);

    // Second sync with same cursor — no changes
    const secondResult = await crawler.sync(firstResult.nextCursor);
    expect(secondResult.entities.length).toBe(0);

    // Add a new file — should appear in third sync
    // Need a small delay to ensure mtime is after lastSyncTime
    await new Promise((r) => setTimeout(r, 50));
    writeVaultFile("new.md", "# New Note");
    const thirdResult = await crawler.sync(firstResult.nextCursor);
    expect(thirdResult.entities.length).toBe(1);
    expect(thirdResult.entities[0].externalId).toBe("new.md");
  });

  it("detects deleted files", async () => {
    writeVaultFile("keep.md", "# Keep");
    writeVaultFile("delete-me.md", "# Delete Me");

    await crawler.initialize({ vaultPath: vaultDir }, { vaultPath: vaultDir });
    const firstResult = await crawler.sync(null);
    expect(firstResult.entities.length).toBe(2);

    // Delete one file
    rmSync(join(vaultDir, "delete-me.md"));

    const secondResult = await crawler.sync(firstResult.nextCursor);
    expect(secondResult.deletedExternalIds).toContain("delete-me.md");
  });

  it("stores imageRefMap mapping image references to resolved vault paths", async () => {
    const imgContent = Buffer.from("image-bytes");
    writeVaultBinary("assets/diagram.png", imgContent);
    writeVaultFile("note.md", "# Note\n\n![[diagram.png]]");

    await crawler.initialize({ vaultPath: vaultDir }, { vaultPath: vaultDir });
    const result = await crawler.sync(null);

    const entity = result.entities[0];
    const imageRefMap = entity.data.imageRefMap as Record<string, string>;
    expect(imageRefMap).toBeDefined();
    // Short-form "diagram.png" resolves to "assets/diagram.png"
    expect(imageRefMap["diagram.png"]).toBe("assets/diagram.png");
  });

  it("includes image attachments referenced via wiki embeds", async () => {
    const imgContent = Buffer.from("fake-png-data");
    writeVaultBinary("images/photo.png", imgContent);
    writeVaultFile("note.md", "# Note\n\n![[images/photo.png]]");

    await crawler.initialize({ vaultPath: vaultDir }, { vaultPath: vaultDir });
    const result = await crawler.sync(null);

    const entity = result.entities[0];
    expect(entity.attachments).toBeDefined();
    expect(entity.attachments!.length).toBe(1);
    expect(entity.attachments![0].filename).toBe("photo.png");
    expect(entity.attachments![0].mimeType).toBe("image/png");
    expect(entity.attachments![0].storagePath).toBe("attachments/images/photo.png");
    expect(Buffer.from(entity.attachments![0].content).toString()).toBe("fake-png-data");
  });

  it("resolves short-form image references by filename", async () => {
    const imgContent = Buffer.from("image-data");
    writeVaultBinary("assets/screenshot.jpg", imgContent);
    writeVaultFile("note.md", "# Note\n\n![[screenshot.jpg]]");

    await crawler.initialize({ vaultPath: vaultDir }, { vaultPath: vaultDir });
    const result = await crawler.sync(null);

    const entity = result.entities[0];
    expect(entity.attachments).toBeDefined();
    expect(entity.attachments!.length).toBe(1);
    expect(entity.attachments![0].mimeType).toBe("image/jpeg");
    expect(entity.attachments![0].storagePath).toBe("attachments/assets/screenshot.jpg");
  });

  it("handles standard markdown image syntax with relative paths", async () => {
    const imgContent = Buffer.from("svg-data");
    writeVaultBinary("diagram.svg", imgContent);
    writeVaultFile("note.md", "# Note\n\n![Diagram](diagram.svg)");

    await crawler.initialize({ vaultPath: vaultDir }, { vaultPath: vaultDir });
    const result = await crawler.sync(null);

    const entity = result.entities[0];
    expect(entity.attachments).toBeDefined();
    expect(entity.attachments!.length).toBe(1);
    expect(entity.attachments![0].mimeType).toBe("image/svg+xml");
  });

  it("ignores external URLs in image syntax", async () => {
    writeVaultFile("note.md", "# Note\n\n![External](https://example.com/img.png)");

    await crawler.initialize({ vaultPath: vaultDir }, { vaultPath: vaultDir });
    const result = await crawler.sync(null);

    const entity = result.entities[0];
    expect(entity.attachments).toBeUndefined();
  });

  it("extracts image refs correctly", () => {
    const content = `# Test
![[photo.png]]
![[subfolder/image.jpg|400]]
![alt](relative/path.svg)
![ext](https://example.com/skip.png)
`;
    const refs = crawler.extractImageRefs(content);
    expect(refs).toEqual(["photo.png", "subfolder/image.jpg", "relative/path.svg"]);
  });

  it("parses frontmatter correctly", async () => {
    writeVaultFile("meta.md", `---
title: My Doc
date: 2024-01-15
tags: [project, notes]
---

# My Doc

Content here.`);

    await crawler.initialize({ vaultPath: vaultDir }, { vaultPath: vaultDir });
    const result = await crawler.sync(null);

    const entity = result.entities[0];
    expect(entity.data.frontmatter).toEqual({
      title: "My Doc",
      date: "2024-01-15",
      tags: ["project", "notes"],
    });
  });

  it("handles nested directory structure", async () => {
    writeVaultFile("projects/alpha/readme.md", "# Alpha Project");
    writeVaultFile("projects/beta/readme.md", "# Beta Project");
    writeVaultFile("daily/2024/01/01.md", "# Jan 1");

    await crawler.initialize({ vaultPath: vaultDir }, { vaultPath: vaultDir });
    const result = await crawler.sync(null);

    expect(result.entities.length).toBe(3);
    const ids = result.entities.map((e) => e.externalId).sort();
    expect(ids).toEqual([
      "daily/2024/01/01.md",
      "projects/alpha/readme.md",
      "projects/beta/readme.md",
    ]);
  });
});
