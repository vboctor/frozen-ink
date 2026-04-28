import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openDatabase } from "@frozenink/core";
import { EvernoteCrawler, listEvernoteNotebooks } from "../crawler";

interface Fixture {
  conduitDir: string;
  cleanup: () => void;
}

/**
 * Build a synthetic conduit-storage tree that mirrors Evernote v10's actual
 * schema: per-type Nodes_* tables, a NoteTag junction, an Attachment table,
 * and an AttachmentSearchText table for OCR'd attachment text.
 */
function buildFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "frozenink-evernote-test-"));
  const conduitDir = join(root, "conduit-storage");
  mkdirSync(conduitDir, { recursive: true });

  const dbPath = join(conduitDir, "UDB-User1+RemoteGraph.sql");
  const db = openDatabase(dbPath);

  db.exec(`
    CREATE TABLE Nodes_Notebook (id TEXT PRIMARY KEY, label TEXT, version REAL);
    CREATE TABLE Nodes_Note (
      id TEXT PRIMARY KEY,
      label TEXT,
      parent_Notebook_id TEXT,
      content_hash TEXT,
      deleted INTEGER,
      version REAL,
      created INTEGER,
      updated INTEGER,
      snippet TEXT
    );
    CREATE TABLE Nodes_Tag (id TEXT PRIMARY KEY, label TEXT);
    CREATE TABLE NoteTag (id TEXT PRIMARY KEY, Note_id TEXT, Tag_id TEXT);
    CREATE TABLE Attachment (
      id TEXT PRIMARY KEY,
      filename TEXT,
      mime TEXT,
      isActive INTEGER,
      dataHash TEXT,
      dataSize INTEGER,
      parent_Note_id TEXT
    );
    CREATE TABLE AttachmentSearchText (id TEXT PRIMARY KEY, searchText TEXT);
  `);

  db.prepare("INSERT INTO Nodes_Notebook(id, label, version) VALUES (?, ?, ?)")
    .run("nb-personal", "Personal", 1);
  db.prepare("INSERT INTO Nodes_Notebook(id, label, version) VALUES (?, ?, ?)")
    .run("nb-work", "Work", 1);

  for (const [id, title, nb, ver] of [
    ["note-1", "Hello note", "nb-personal", 10],
    ["note-2", "Work plan", "nb-work", 20],
    ["note-3", "Drafted", "nb-personal", 30],
  ] as const) {
    db.prepare(
      "INSERT INTO Nodes_Note(id, label, parent_Notebook_id, content_hash, deleted, version, created, updated, snippet) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(id, title, nb, `hash-${id}`, 0, ver, 0, 0, `Snippet of ${id}`);
  }

  db.prepare("INSERT INTO Nodes_Tag(id, label) VALUES (?, ?)").run("tag-a", "TagA");
  db.prepare("INSERT INTO Nodes_Tag(id, label) VALUES (?, ?)").run("tag-b", "TagB");
  db.prepare("INSERT INTO NoteTag(id, Note_id, Tag_id) VALUES (?, ?, ?)").run("nt-1", "note-1", "tag-a");
  db.prepare("INSERT INTO NoteTag(id, Note_id, Tag_id) VALUES (?, ?, ?)").run("nt-2", "note-1", "tag-b");

  db.prepare(
    "INSERT INTO Attachment(id, filename, mime, isActive, dataHash, dataSize, parent_Note_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run("att-1", "pic.png", "image/png", 1, "deadbeef", 4, "note-1");
  db.prepare("INSERT INTO AttachmentSearchText(id, searchText) VALUES (?, ?)")
    .run("att-1", "OCR text from picture");
  db.close();

  const resCacheDir = join(root, "resource-cache", "User1", "note-1");
  mkdirSync(resCacheDir, { recursive: true });
  writeFileSync(join(resCacheDir, "deadbeef"), Buffer.from([1, 2, 3, 4]));

  return { conduitDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe("EvernoteCrawler", () => {
  let fixture: Fixture;
  beforeEach(() => {
    fixture = buildFixture();
  });
  afterEach(() => {
    fixture.cleanup();
  });

  it("emits one entity per active note with tags from the NoteTag junction table", async () => {
    const crawler = new EvernoteCrawler();
    await crawler.initialize({ conduitStoragePath: fixture.conduitDir, snapshot: false }, {});
    try {
      const result = await crawler.sync(null);
      expect(result.entities).toHaveLength(3);
      const note1 = result.entities.find((e) => e.externalId === "note-1")!;
      expect(note1.tags).toContain("TagA");
      expect(note1.tags).toContain("TagB");
      // Notebook membership is structured metadata, NOT a tag.
      expect(note1.tags).not.toContain("notebook:Personal");
      expect((note1.data as any).notebookName).toBe("Personal");
      expect(note1.attachments?.[0]?.text).toBe("OCR text from picture");
    } finally {
      await crawler.dispose();
    }
  });

  it("only re-emits notes whose version advances on the second sync", async () => {
    const crawler = new EvernoteCrawler();
    await crawler.initialize({ conduitStoragePath: fixture.conduitDir, snapshot: false }, {});
    try {
      const first = await crawler.sync(null);
      expect(first.entities).toHaveLength(3);
      const second = await crawler.sync(first.nextCursor);
      expect(second.entities).toHaveLength(0);
    } finally {
      await crawler.dispose();
    }
  });

  it("reports deletions when a note disappears or is marked deleted", async () => {
    const crawler = new EvernoteCrawler();
    await crawler.initialize({ conduitStoragePath: fixture.conduitDir, snapshot: false }, {});
    try {
      const first = await crawler.sync(null);
      const dbPath = join(fixture.conduitDir, "UDB-User1+RemoteGraph.sql");
      const db = openDatabase(dbPath);
      db.exec("DELETE FROM Nodes_Note WHERE id = 'note-2'");
      db.close();
      await crawler.dispose();

      const c2 = new EvernoteCrawler();
      await c2.initialize({ conduitStoragePath: fixture.conduitDir, snapshot: false }, {});
      try {
        const result = await c2.sync(first.nextCursor);
        expect(result.deletedExternalIds).toContain("note-2");
      } finally {
        await c2.dispose();
      }
    } finally {
      // already disposed
    }
  });

  it("respects the notebooks allowlist", async () => {
    const crawler = new EvernoteCrawler();
    await crawler.initialize(
      { conduitStoragePath: fixture.conduitDir, snapshot: false, notebooks: ["Work"] },
      {},
    );
    try {
      const result = await crawler.sync(null);
      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].externalId).toBe("note-2");
    } finally {
      await crawler.dispose();
    }
  });
});

describe("listEvernoteNotebooks", () => {
  let fixture: Fixture;
  beforeEach(() => {
    fixture = buildFixture();
  });
  afterEach(() => {
    fixture.cleanup();
  });

  it("returns notebooks with note counts and aggregate attachment sizes", async () => {
    const summaries = await listEvernoteNotebooks(fixture.conduitDir);
    const byName = Object.fromEntries(summaries.map((s) => [s.name, s]));
    expect(byName.Personal.noteCount).toBe(2);
    expect(byName.Personal.totalBytes).toBe(4);
    expect(byName.Work.noteCount).toBe(1);
    expect(byName.Work.totalBytes).toBe(0);
  });
});
