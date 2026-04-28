import { existsSync, readFileSync } from "fs";
import { homedir, platform } from "os";
import { join, dirname, basename } from "path";
import type {
  Crawler,
  CrawlerMetadata,
  CrawlerEntityData,
  SyncCursor,
  SyncResult,
  AssetFilter,
} from "@frozenink/core";
import { openDatabase, createCryptoHasher } from "@frozenink/core";
import type {
  EvernoteConfig,
  EvernoteCredentials,
  EvernoteSyncCursor,
  EvernoteNoteRow,
  EvernoteNotebookRow,
  EvernoteResourceRow,
  EvernoteTagRow,
} from "./types";
import { copyConduitStorage, findRemoteGraphDb, isWalDirty } from "./snapshot";
import { enmlToMarkdown, encodePathForMarkdown } from "./enml";
import { extractAttachmentText } from "./ocr";
import {
  decodeRteBlob,
  extractRte,
  rteDatPath,
  ATTACHMENT_PLACEHOLDER_PREFIX,
  ATTACHMENT_PLACEHOLDER_SUFFIX,
} from "./rte";

export interface EvernoteNotebookSummary {
  guid: string;
  name: string;
  noteCount: number;
  /** Sum of attachment sizes across notes in this notebook, in bytes. */
  totalBytes: number;
}

/**
 * Read the notebook list (with note count and aggregate attachment size) from
 * a conduit-storage directory without instantiating the full crawler. Used by
 * the desktop "Add Collection" form so the user can pick which notebooks to
 * sync. Reads the live file directly when the WAL is checkpointed; otherwise
 * snapshots first to stay safe alongside a running Evernote.
 */
export async function listEvernoteNotebooks(
  conduitStorageDir?: string,
): Promise<EvernoteNotebookSummary[]> {
  const dir = conduitStorageDir || defaultConduitPath();
  if (!existsSync(dir)) {
    throw new Error(`Evernote conduit-storage directory not found: ${dir}`);
  }
  const live = findRemoteGraphDb(dir);
  if (!live) throw new Error(`No Evernote RemoteGraph DB found in ${dir}`);

  let dbPath = live;
  let cleanup: (() => void) | null = null;
  if (isWalDirty(live)) {
    const snap = copyConduitStorage(dirname(live));
    dbPath = snap.dbPath;
    cleanup = snap.cleanup;
  }

  const db = openDatabase(dbPath);
  try {
    try { db.exec("PRAGMA query_only = 1;"); } catch { /* ok */ }

    const tables = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map(
        (t) => t.name,
      ),
    );
    if (!tables.has("Nodes_Notebook")) return [];

    type NotebookRow = { id: string; name: string | null };
    const notebookRows = db
      .prepare(`SELECT id, label AS name FROM Nodes_Notebook`)
      .all() as NotebookRow[];

    // Per-notebook note count + aggregate attachment size in one shot.
    type CountRow = { notebookId: string; n: number };
    const countRows = db
      .prepare(
        `SELECT parent_Notebook_id AS notebookId, COUNT(*) AS n
           FROM Nodes_Note
          WHERE parent_Notebook_id IS NOT NULL AND (deleted IS NULL OR deleted = 0)
          GROUP BY parent_Notebook_id`,
      )
      .all() as CountRow[];
    const counts = new Map(countRows.map((r) => [r.notebookId, r.n] as const));

    type SizeRow = { notebookId: string; bytes: number };
    let sizes = new Map<string, number>();
    if (tables.has("Attachment")) {
      const sizeRows = db
        .prepare(
          `SELECT n.parent_Notebook_id AS notebookId, SUM(a.dataSize) AS bytes
             FROM Attachment a JOIN Nodes_Note n ON n.id = a.parent_Note_id
            WHERE a.isActive = 1 AND n.parent_Notebook_id IS NOT NULL
            GROUP BY n.parent_Notebook_id`,
        )
        .all() as SizeRow[];
      sizes = new Map(sizeRows.map((r) => [r.notebookId, r.bytes ?? 0] as const));
    }

    return notebookRows
      .map((r) => ({
        guid: r.id,
        name: r.name ?? "(unnamed)",
        noteCount: counts.get(r.id) ?? 0,
        totalBytes: sizes.get(r.id) ?? 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } finally {
    try { db.close?.(); } catch { /* ignore */ }
    if (cleanup) cleanup();
  }
}

/**
 * Recover the Evernote user identifier (e.g. `User1234567`) from the path of
 * the RemoteGraph database. Filenames look like `UDB-User1234567+RemoteGraph.sql`
 * — the literal `User<id>` segment is what shows up under `resource-cache/`.
 */
function extractUserIdFromDbPath(dbPath: string): string | null {
  const m = basename(dbPath).match(/(User\d+)/);
  return m ? m[1] : null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Wrap a flat OCR string from `AttachmentSearchText` into the minimal
 * `<recoIndex>` shape that `parseEvernoteRecognitionXml()` consumes — this
 * keeps a single tier-1 code path in the OCR cascade.
 */
function recognitionAsXml(plainText: string): string {
  const escaped = plainText
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<recoIndex><item><t w="100">${escaped}</t></item></recoIndex>`;
}

/**
 * Auto-detect candidate locations for Evernote v10's conduit-storage
 * directory. Different platforms and install sources put it in different
 * places — we return all the spots worth checking, in priority order.
 *
 *   macOS:
 *     - Mac App Store / direct download (sandboxed):
 *       `~/Library/Containers/com.evernote.Evernote/Data/Library/Application Support/Evernote/conduit-storage`
 *     - Setapp variant: same container path with the Setapp bundle id.
 *     - Unsandboxed legacy v10 builds occasionally used
 *       `~/Library/Application Support/Evernote/conduit-storage`.
 *
 *   Windows:
 *     - Default installer: `%LOCALAPPDATA%\Evernote\Evernote\conduit-storage`
 *     - Microsoft Store (MSIX) builds: under `%LOCALAPPDATA%\Packages\<pkg>\LocalCache\...`
 *       — we glob the Packages directory for any folder whose name starts
 *       with `Evernote` and contains `conduit-storage`.
 *
 *   Linux:
 *     - AppImage / Snap / .deb: `~/.config/Evernote/conduit-storage`
 *     - Snap confined: `~/snap/evernote/current/.config/Evernote/conduit-storage`
 *
 * The legacy non-v10 client stored data under a totally different layout
 * (`~/Library/Application Support/Evernote/accounts/...` on macOS); we
 * don't support that and simply won't find a RemoteGraph DB there.
 */
function defaultConduitCandidates(): string[] {
  const home = homedir();
  const out: string[] = [];
  if (platform() === "darwin") {
    out.push(join(home, "Library/Containers/com.evernote.Evernote/Data/Library/Application Support/Evernote/conduit-storage"));
    // Setapp build
    out.push(join(home, "Library/Containers/com.evernote.EvernoteSetapp/Data/Library/Application Support/Evernote/conduit-storage"));
    // Unsandboxed
    out.push(join(home, "Library/Application Support/Evernote/conduit-storage"));
  } else if (platform() === "win32") {
    const local = process.env.LOCALAPPDATA || join(home, "AppData", "Local");
    const roaming = process.env.APPDATA || join(home, "AppData", "Roaming");
    out.push(join(local, "Evernote", "Evernote", "conduit-storage"));
    out.push(join(local, "Programs", "Evernote", "conduit-storage"));
    out.push(join(roaming, "Evernote", "conduit-storage"));
    // MSIX / Microsoft Store: scan the Packages directory.
    try {
      const packagesDir = join(local, "Packages");
      const { readdirSync } = require("fs") as typeof import("fs");
      for (const entry of readdirSync(packagesDir)) {
        if (entry.toLowerCase().startsWith("evernote")) {
          out.push(join(packagesDir, entry, "LocalCache", "Roaming", "Evernote", "conduit-storage"));
          out.push(join(packagesDir, entry, "LocalCache", "Local", "Evernote", "conduit-storage"));
        }
      }
    } catch {
      // packages dir may not exist
    }
  } else {
    // Linux + other Unixes
    const xdg = process.env.XDG_CONFIG_HOME || join(home, ".config");
    out.push(join(xdg, "Evernote", "conduit-storage"));
    out.push(join(home, "snap", "evernote", "current", ".config", "Evernote", "conduit-storage"));
  }
  return out;
}

/** First candidate that actually exists, or the canonical macOS path as a last-resort label. */
function autoDetectConduitPath(): string {
  for (const candidate of defaultConduitCandidates()) {
    if (existsSync(candidate)) return candidate;
  }
  return defaultConduitCandidates()[0];
}

function defaultConduitPath(): string {
  return autoDetectConduitPath();
}

const SYNC_CONTEXT_KEY = "default";

interface InternalState {
  conduitDir: string;
  /** Root of Evernote's app-support directory (parent of `conduit-storage/`). */
  evernoteRoot: string;
  /** Derived from the DB filename (e.g. `UDB-User1234+RemoteGraph.sql` → `User1234`). */
  userId: string | null;
  dbPath: string;
  livePath: string;
  cleanup: (() => void) | null;
  db: any;
  notebookFilter: Set<string> | null;
}

export class EvernoteCrawler implements Crawler {
  metadata: CrawlerMetadata = {
    type: "evernote",
    displayName: "Evernote",
    description:
      "Imports notes, attachments, and OCR text from the local Evernote v10 macOS database",
    // Bumped on each enml/encoding fix to trigger SyncEngine to re-render
    // every existing entity from its stored data (see AGENTS.md — minor
    // bump = re-render markdown). 1.1 added Yjs decoding + image-syntax
    // PDFs; 1.2 percent-encodes markdown-special chars (`*`, `(`, `)`)
    // in attachment URLs so filenames like `11292025_*000779*…` stop
    // tripping markdown's emphasis parser.
    version: "1.2",
    configSchema: {
      conduitStoragePath: {
        type: "string",
        required: false,
        description: "Override path to Evernote's conduit-storage directory",
      },
      notebooks: {
        type: "array",
        required: false,
        description: "Optional notebook allowlist (names or GUIDs)",
      },
      snapshot: {
        type: "boolean",
        required: false,
        description: "Snapshot the DB+WAL+SHM into a temp dir before reading (default true)",
      },
    },
    credentialFields: ["conduitStoragePath"],
  };

  private state: InternalState | null = null;
  private snapshotMode = true;
  private assetFilter: AssetFilter | null = null;
  private progressCallback: ((message: string) => void) | null = null;

  setAssetFilter(filter: AssetFilter): void {
    this.assetFilter = filter;
  }

  setProgressCallback(callback: (message: string) => void): void {
    this.progressCallback = callback;
  }

  async initialize(
    config: Record<string, unknown>,
    credentials: Record<string, unknown>,
  ): Promise<void> {
    const cfg = config as unknown as EvernoteConfig;
    const creds = credentials as unknown as EvernoteCredentials;
    const conduitDir =
      creds.conduitStoragePath || cfg.conduitStoragePath || defaultConduitPath();
    if (!existsSync(conduitDir)) {
      throw new Error(`Evernote conduit-storage directory not found: ${conduitDir}`);
    }
    this.snapshotMode = cfg.snapshot !== false;

    let dbPath: string;
    let cleanup: (() => void) | null = null;
    const live = findRemoteGraphDb(conduitDir);
    if (!live) throw new Error(`No Evernote RemoteGraph DB found in ${conduitDir}`);

    // Snapshot is on by default, but if the WAL is empty we know Evernote
    // has checkpointed and quit — reading the live file is safe and
    // dramatically cheaper than copying gigabytes of attachments metadata.
    if (this.snapshotMode && isWalDirty(live)) {
      const snap = copyConduitStorage(dirname(live));
      dbPath = snap.dbPath;
      cleanup = snap.cleanup;
    } else {
      dbPath = live;
    }

    const db = openDatabase(dbPath);
    try {
      db.exec("PRAGMA query_only = 1;");
    } catch {
      // older sqlite builds may not support it; safe to ignore for read-only access patterns
    }

    this.state = {
      conduitDir,
      // app-support root sits one level above conduit-storage
      evernoteRoot: dirname(conduitDir),
      userId: extractUserIdFromDbPath(live),
      dbPath,
      livePath: live,
      cleanup,
      db,
      notebookFilter:
        cfg.notebooks && cfg.notebooks.length > 0 ? new Set(cfg.notebooks) : null,
    };
  }

  async sync(cursor: SyncCursor | null): Promise<SyncResult> {
    if (!this.state) throw new Error("Evernote crawler not initialized");
    const c = (cursor as EvernoteSyncCursor | null) ?? {};
    const highWaterByContext = { ...(c.highWaterByContext ?? {}) };
    const previousKnown = c.knownNodes ?? {};
    const high = highWaterByContext[SYNC_CONTEXT_KEY] ?? 0;

    this.report("Reading notebooks");
    const notebooks = this.readNotebooks();
    const notebookById = new Map(notebooks.map((n) => [n.guid, n]));

    this.report("Reading tags");
    const tags = this.readTags();
    const tagById = new Map(tags.map((t) => [t.guid, t]));

    this.report("Reading notes");
    const notes = this.readNotes();
    const resourcesByNote = this.readResources();
    const offlineBodyById = this.readOfflineSearchContent();
    // Some v10 builds keep tag→note links in a separate Edges table rather
    // than embedded in the note's NodeFields. Build a supplemental index.
    const edgeTagsByNote = this.readTagEdges(new Set(tagById.keys()));

    const filtered = notes.filter((n) => this.matchesNotebookFilter(n, notebookById));
    const newKnownNodes: Record<string, number> = {};
    for (const n of filtered) {
      newKnownNodes[n.guid] = n.updateSequenceNum;
    }

    // Tombstones: ids known in the previous run but absent now, plus any
    // node whose `active` flag flipped to false in this snapshot.
    const deletedExternalIds: string[] = [];
    for (const guid of Object.keys(previousKnown)) {
      if (!newKnownNodes[guid]) deletedExternalIds.push(guid);
    }
    for (const n of filtered) {
      if (!n.active) deletedExternalIds.push(n.guid);
    }

    let newHigh = high;
    const entities: CrawlerEntityData[] = [];

    let processed = 0;
    for (const note of filtered) {
      processed++;
      if (note.updateSequenceNum <= high) continue;
      if (!note.active) continue; // already counted as deletion above

      this.report(`Building note ${processed}/${filtered.length}: ${note.title}`);
      const notebook = note.notebookId ? notebookById.get(note.notebookId) : undefined;
      const resources = resourcesByNote.get(note.guid) ?? [];

      // Resolve the note body, in priority order:
      //   1. Decoded text from the v10 binary RTE blob (`conduit-fs/.../<guid>.dat`).
      //      This is the most complete source — contains the full note body
      //      Evernote actually renders. Best-effort text extraction; loses
      //      formatting but recovers all the searchable content.
      //   2. `Offline_Search_Note_Content.content` — Evernote's own
      //      pre-stripped plain text, populated for offline-cached notes.
      //   3. The `Nodes_Note.snippet` preview (loaded as `note.enml` upstream).
      //   4. Legacy on-disk `content.enml` for very old installs.
      // Body resolution. Prefer the Yjs decoder — it gives back real ENML
      // in original document order, with `<en-media>` tags positioned where
      // the user actually placed them. If decoding fails, fall back to the
      // byte-walking extractor (which emits placeholder tokens) and
      // finally to plain-text sources.
      let enml = "";
      // Hashes seen by the byte-walker only — used to drive placeholder
      // substitution. With proper Yjs decoding we don't need this; the
      // ENML's `<en-media>` tags already reference attachments by hash.
      let inlinedAttachmentHashes: string[] = [];
      const rte = this.readRteBody(note.guid);
      if (rte?.kind === "enml") {
        enml = rte.enml;
        inlinedAttachmentHashes = rte.attachmentHashes;
      } else if (rte?.kind === "fallback") {
        enml = rte.text;
        inlinedAttachmentHashes = rte.attachmentHashes;
      }
      if (!enml && offlineBodyById.has(note.guid)) {
        enml = offlineBodyById.get(note.guid) ?? "";
      }
      if (!enml && note.enml) enml = note.enml;
      if (!enml) {
        for (const candidate of this.legacyEnmlPaths(note.guid)) {
          try {
            if (existsSync(candidate)) {
              enml = readFileSync(candidate, "utf-8");
              break;
            }
          } catch {
            // try next
          }
        }
      }

      const resourceByHash: Record<
        string,
        { filename: string; mimeType: string; assetPath: string }
      > = {};
      const attachments: NonNullable<CrawlerEntityData["attachments"]> = [];

      for (const r of resources) {
        const filename = r.filename || `${r.hash}`;
        const mime = r.mime || "application/octet-stream";
        const storagePath = `attachments/evernote/${note.guid}/${filename}`;
        resourceByHash[r.hash] = {
          filename,
          mimeType: mime,
          assetPath: storagePath,
        };

        const blob = this.readResourceBlob(note.guid, r.hash);
        if (!blob) continue;

        const recognitionXml =
          r.recognition || note.recognitionByResourceHash?.[r.hash];
        const text = await extractAttachmentText({
          buffer: blob,
          mimeType: mime,
          filename,
          evernoteRecognitionXml: recognitionXml,
          maxBytes: this.assetFilter?.maxSizeBytes,
        });

        attachments.push({
          filename,
          mimeType: mime,
          content: blob,
          storagePath,
          ...(text ? { text } : {}),
        });
      }

      let markdown = enml ? enmlToMarkdown(enml, { resourceByHash }) : "";

      // The byte-walking fallback occasionally recovers the note's title as
      // a quoted prefix glued onto the body (e.g. `"<title>G Paid on…`).
      // Real ENML from the Yjs decoder doesn't have this problem — the
      // title is stored separately — so this scrub only runs for fallback
      // output.
      if (rte?.kind === "fallback" && markdown && note.title) {
        const titleEsc = escapeRegExp(note.title);
        const titleStripRe = new RegExp(
          `^["']?\\s*${titleEsc}\\s*["']?[a-zA-Z0-9]?\\s*\\n?`,
        );
        markdown = markdown.replace(titleStripRe, "");
        markdown = markdown
          .split("\n")
          .filter((line) => {
            const trimmed = line.trim();
            return trimmed !== note.title
              && trimmed !== `"${note.title}"`
              && trimmed !== `'${note.title}'`;
          })
          .join("\n");
      }

      // Substitute `[[EVERNOTE_ATTACHMENT:<hash>]]` placeholders that the
      // fallback extractor leaves in its output. Yjs-decoded ENML doesn't
      // contain placeholders — `<en-media>` tags are already substituted
      // by enmlToMarkdown above.
      if (rte?.kind === "fallback" && markdown && inlinedAttachmentHashes.length > 0) {
        const placeholderRe = new RegExp(
          `${escapeRegExp(ATTACHMENT_PLACEHOLDER_PREFIX)}([a-f0-9]+)${escapeRegExp(ATTACHMENT_PLACEHOLDER_SUFFIX)}`,
          "gi",
        );
        markdown = markdown.replace(placeholderRe, (_match, rawHash: string) => {
          const hash = rawHash.toLowerCase();
          let res = resourceByHash[hash];
          if (!res) {
            const fallback = Object.keys(resourceByHash).find((k) => k.endsWith(hash) || hash.endsWith(k));
            if (fallback) res = resourceByHash[fallback];
          }
          if (!res) return "";
          const url = encodePathForMarkdown(res.assetPath);
          const isImage = res.mimeType.startsWith("image/");
          const isPdf = res.mimeType === "application/pdf" || /\.pdf$/i.test(res.filename);
          if (isImage || isPdf) return `\n\n![${res.filename}](${url})\n\n`;
          return `\n\n[${res.filename}](${url})\n\n`;
        });
      }

      // Detect which attachments ended up referenced inline so the theme
      // can drop them from the trailing Attachments section. Works for
      // both ENML- and placeholder-driven substitution paths since both
      // emit the same `attachments/evernote/…` storage path.
      const inlinedHashesUsed = new Set<string>();
      for (const r of resources) {
        const storagePath = `attachments/evernote/${note.guid}/${r.filename || r.hash}`;
        const encoded = encodePathForMarkdown(storagePath);
        if (markdown.includes(storagePath) || markdown.includes(encoded)) {
          inlinedHashesUsed.add(storagePath);
        }
      }

      // Merge tag GUIDs from the note's NodeFields with any links discovered
      // via the Edges table, then resolve to display names. Dedupe so a tag
      // referenced both inline and via an edge only appears once. Notebook
      // membership is intentionally NOT pushed into tags — it's structured
      // metadata, surfaced separately by the theme.
      const tagGuidSet = new Set<string>(note.tagGuids ?? []);
      for (const g of edgeTagsByNote.get(note.guid) ?? []) tagGuidSet.add(g);
      const tagNames: string[] = [];
      const seenNames = new Set<string>();
      for (const g of tagGuidSet) {
        const name = tagById.get(g)?.name;
        if (name && !seenNames.has(name)) {
          seenNames.add(name);
          tagNames.push(name);
        }
      }

      // Pre-build a serialisable attachment list the theme can render
      // directly — without it the theme has no way to find the assets that
      // belong to a note (CrawlerEntityData.attachments doesn't make it onto
      // ThemeRenderContext.entity). `inline: true` flags attachments that
      // are already substituted into the body so the theme can omit them
      // from the trailing Attachments section.
      const dataAttachments = attachments.map((a) => {
        const storagePath = a.storagePath ?? "";
        return {
          filename: a.filename,
          mimeType: a.mimeType,
          storagePath,
          inline: inlinedHashesUsed.has(storagePath),
        };
      });

      const hasher = createCryptoHasher("sha256");
      hasher.update(note.contentHash || "");
      hasher.update(String(note.updateSequenceNum));
      hasher.update(JSON.stringify(tagNames));
      const contentHash = hasher.digest("hex");

      // Sort key: ISO-8601-ish timestamp of the note's last update so a lex
      // sort matches chronological order. Falls back to creation time, then
      // to the title — `~` is sentinel that pushes undated notes to the
      // bottom under DESC (any real ISO date sorts before `~`).
      const sortStamp = (() => {
        const ts = note.updated ?? note.created;
        if (!ts || !Number.isFinite(ts)) return `~${note.title}`;
        const d = new Date(ts);
        return Number.isNaN(d.getTime()) ? `~${note.title}` : d.toISOString();
      })();

      entities.push({
        externalId: note.guid,
        entityType: "note",
        title: note.title || "(untitled)",
        contentHash,
        sortKey: sortStamp,
        url: `evernote:///view/0/${note.guid}/${note.guid}/`,
        tags: tagNames,
        data: {
          notebookId: note.notebookId,
          notebookName: notebook?.name,
          created: note.created,
          updated: note.updated,
          usn: note.updateSequenceNum,
          markdown,
          attachments: dataAttachments,
        },
        attachments: attachments.length > 0 ? attachments : undefined,
      });

      if (note.updateSequenceNum > newHigh) newHigh = note.updateSequenceNum;
    }

    highWaterByContext[SYNC_CONTEXT_KEY] = newHigh;

    return {
      entities,
      nextCursor: { highWaterByContext, knownNodes: newKnownNodes },
      hasMore: false,
      deletedExternalIds,
    };
  }

  async validateCredentials(credentials: Record<string, unknown>): Promise<boolean> {
    const creds = credentials as unknown as EvernoteCredentials;
    const dir = creds.conduitStoragePath || defaultConduitPath();
    if (!existsSync(dir)) return false;
    return Boolean(findRemoteGraphDb(dir));
  }

  async dispose(): Promise<void> {
    if (!this.state) return;
    try {
      this.state.db?.close?.();
    } catch {
      // ignore
    }
    if (this.state.cleanup) {
      try { this.state.cleanup(); } catch { /* ignore */ }
    }
    this.state = null;
  }

  private report(msg: string): void {
    this.progressCallback?.(msg);
  }

  private matchesNotebookFilter(
    note: EvernoteNoteRow,
    notebookById: Map<string, EvernoteNotebookRow>,
  ): boolean {
    if (!this.state?.notebookFilter) return true;
    if (!note.notebookId) return false;
    const f = this.state.notebookFilter;
    if (f.has(note.notebookId)) return true;
    const nb = notebookById.get(note.notebookId);
    return Boolean(nb && f.has(nb.name));
  }

  /**
   * Return paths to try when looking for an ENML file on disk for a note.
   * Modern v10 builds embed ENML in NodeFields, so this is only consulted as
   * a fallback for older / migrated installs.
   */
  private legacyEnmlPaths(noteGuid: string): string[] {
    const out: string[] = [];
    const userId = this.state?.userId;
    if (!userId) return out;
    const root = this.state!.evernoteRoot;
    out.push(join(root, "accounts", "www.evernote.com", userId, "content", `c${noteGuid}`, "content.enml"));
    out.push(join(root, "content", `c${noteGuid}`, "content.enml"));
    return out;
  }

  /**
   * Decode the v10 binary RTE blob for a note and return a best-effort
   * plain-text body. Returns an empty string when the file isn't on disk
   * (e.g. the note hasn't been opened in the desktop app) or contains no
   * recoverable text.
   *
   * The conduit-fs root is one level deep under
   * `<app-support>/conduit-fs/<urlencoded-host>/<account>/rte/Note/internal_rteDoc/`.
   * We scan for the account directory once and cache the resolved root.
   */
  private cachedRteRoot: string | null | undefined = undefined;
  private resolveRteRoot(): string | null {
    if (this.cachedRteRoot !== undefined) return this.cachedRteRoot;
    const root = this.state!.evernoteRoot;
    const conduitFs = `${root}/conduit-fs`;
    if (!existsSync(conduitFs)) {
      this.cachedRteRoot = null;
      return null;
    }
    const { readdirSync, statSync } = require("fs") as typeof import("fs");
    try {
      for (const host of readdirSync(conduitFs)) {
        const hostDir = `${conduitFs}/${host}`;
        if (!statSync(hostDir).isDirectory()) continue;
        for (const account of readdirSync(hostDir)) {
          const candidate = `${hostDir}/${account}/rte/Note/internal_rteDoc`;
          if (existsSync(candidate)) {
            this.cachedRteRoot = candidate;
            return candidate;
          }
        }
      }
    } catch {
      // fall through
    }
    this.cachedRteRoot = null;
    return null;
  }

  /**
   * Returns either real ENML decoded from the Yjs blob (preferred — preserves
   * original document order) or, on failure, the byte-walking extractor's
   * placeholder-style output. The caller distinguishes via the returned
   * `kind`.
   */
  private readRteBody(noteGuid: string):
    | { kind: "enml"; enml: string; attachmentHashes: string[] }
    | { kind: "fallback"; text: string; attachmentHashes: string[] }
    | null {
    const root = this.resolveRteRoot();
    if (!root) return null;
    const path = rteDatPath(root, noteGuid);
    try {
      if (!existsSync(path)) return null;
      const buf = readFileSync(path);
      const decoded = decodeRteBlob(buf);
      if (decoded) {
        return { kind: "enml", enml: decoded.enml, attachmentHashes: decoded.attachmentHashes };
      }
      const fallback = extractRte(buf);
      if (fallback.text || fallback.attachmentHashes.length > 0) {
        return { kind: "fallback", text: fallback.text, attachmentHashes: fallback.attachmentHashes };
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Read the offline-cached plain text body Evernote stores for notes the
   * user has marked for offline access. Only a subset of notes have this,
   * but where present it's a clean stripped-text version that we can use as
   * a fallback when the RTE blob isn't available.
   */
  private readOfflineSearchContent(): Map<string, string> {
    const out = new Map<string, string>();
    const db = this.state!.db;
    try {
      const rows = db
        .prepare(`SELECT id, content FROM Offline_Search_Note_Content WHERE content IS NOT NULL AND content != ''`)
        .all() as Array<{ id: string; content: string }>;
      for (const r of rows) out.set(r.id, r.content);
    } catch {
      // Table absent on older builds.
    }
    return out;
  }

  /**
   * Resolve a resource blob by note guid + content hash. v10 stores them in
   * `Evernote/resource-cache/<userId>/<noteGuid>/<hash>` (no extension); some
   * installs also keep a copy in the legacy `accounts/.../content/c<guid>/resource/<hash>`
   * tree. Try both.
   */
  private readResourceBlob(noteGuid: string, hash: string): Buffer | null {
    const userId = this.state?.userId;
    const root = this.state!.evernoteRoot;
    const candidates: string[] = [];
    if (userId) {
      candidates.push(join(root, "resource-cache", userId, noteGuid, hash));
      candidates.push(join(root, "accounts", "www.evernote.com", userId, "content", `c${noteGuid}`, "resource", hash));
    }
    candidates.push(join(root, "resource-cache", noteGuid, hash));
    for (const p of candidates) {
      try {
        if (existsSync(p)) return readFileSync(p);
      } catch {
        // try next
      }
    }
    return null;
  }

  // ── DB readers ──────────────────────────────────────────────────────
  //
  // Evernote v10 (Conduit) writes one SQLite table per node type
  // (`Nodes_Note`, `Nodes_Notebook`, `Nodes_Tag`, …). Note↔tag links live in
  // a `NoteTag` junction table, attachments in `Attachment`, and pre-OCR'd
  // attachment text in `AttachmentSearchText`. The note body itself is NOT
  // stored in this DB — it lives in a binary RTE blob under
  // `<app-support>/conduit-fs/.../rte/Note/internal_rteDoc/<aaa>/<bbb>/<guid>.dat`
  // and is not yet parseable by the crawler. We extract everything we can
  // from SQL (title, notebook, tags, attachments, OCR text, snippet) and
  // leave the body empty — searchable via tags + attachment OCR.

  private readNotes(): EvernoteNoteRow[] {
    const db = this.state!.db;
    const stmt = db.prepare(
      `SELECT id, label AS title, parent_Notebook_id AS notebookId,
              content_hash AS contentHash, deleted, version, created, updated,
              snippet
         FROM Nodes_Note`,
    );
    type Row = {
      id: string;
      title: string | null;
      notebookId: string | null;
      contentHash: string | null;
      deleted: number | null;
      version: number;
      created: number | null;
      updated: number | null;
      snippet: string | null;
    };
    return (stmt.all() as Row[]).map((r) => ({
      guid: r.id,
      title: r.title ?? "",
      notebookId: r.notebookId ?? undefined,
      contentHash: r.contentHash ?? undefined,
      active: !r.deleted,
      created: r.created ?? undefined,
      updated: r.updated ?? undefined,
      // v10 exposes the Evernote `version` field — equivalent to USN for
      // change tracking. Falls back to 0 for unsynced local notes.
      updateSequenceNum: Math.floor(r.version ?? 0),
      tagGuids: undefined,
      recognitionByResourceHash: undefined,
      enml: r.snippet ?? undefined,
    }));
  }

  private readNotebooks(): EvernoteNotebookRow[] {
    const db = this.state!.db;
    type Row = { id: string; name: string | null; version: number | null };
    const rows = db
      .prepare(`SELECT id, label AS name, version FROM Nodes_Notebook`)
      .all() as Row[];
    return rows.map((r) => ({
      guid: r.id,
      name: r.name ?? "(unnamed)",
      updateSequenceNum: Math.floor(r.version ?? 0),
    }));
  }

  private readTags(): EvernoteTagRow[] {
    const db = this.state!.db;
    type Row = { id: string; name: string | null };
    const rows = db.prepare(`SELECT id, label AS name FROM Nodes_Tag`).all() as Row[];
    return rows.map((r) => ({ guid: r.id, name: r.name ?? "" }));
  }

  /** Build the noteGuid → tagGuid[] index from the `NoteTag` junction table. */
  private readTagEdges(_knownTagIds: Set<string>): Map<string, string[]> {
    const out = new Map<string, string[]>();
    const db = this.state!.db;
    type Row = { Note_id: string; Tag_id: string };
    const rows = db.prepare(`SELECT Note_id, Tag_id FROM NoteTag`).all() as Row[];
    for (const row of rows) {
      const list = out.get(row.Note_id) ?? [];
      if (!list.includes(row.Tag_id)) list.push(row.Tag_id);
      out.set(row.Note_id, list);
    }
    return out;
  }

  private readResources(): Map<string, EvernoteResourceRow[]> {
    const out = new Map<string, EvernoteResourceRow[]>();
    const db = this.state!.db;
    type Row = {
      id: string;
      noteGuid: string;
      hash: string;
      mime: string | null;
      filename: string | null;
      size: number | null;
    };
    const rows = db
      .prepare(
        `SELECT id, parent_Note_id AS noteGuid, dataHash AS hash,
                mime, filename, dataSize AS size
           FROM Attachment WHERE isActive = 1`,
      )
      .all() as Row[];

    // Pre-OCR'd searchable text for attachments. Keyed by attachment id.
    const recognitionById = new Map<string, string>();
    try {
      const recRows = db
        .prepare(`SELECT id, searchText FROM AttachmentSearchText`)
        .all() as Array<{ id: string; searchText: string | null }>;
      for (const r of recRows) {
        if (r.searchText) recognitionById.set(r.id, r.searchText);
      }
    } catch {
      // Older builds may lack this table — OCR cascade will fall through.
    }

    for (const r of rows) {
      const row: EvernoteResourceRow = {
        guid: r.id,
        noteGuid: r.noteGuid,
        hash: r.hash,
        mime: r.mime ?? undefined,
        filename: r.filename ?? undefined,
        size: r.size ?? undefined,
        // Evernote's pre-OCR'd text is plain (not the raw recoIndex XML), so
        // we wrap it in a minimal recoIndex doc that parseEvernoteRecognitionXml
        // already understands.
        recognition: recognitionById.has(r.id)
          ? recognitionAsXml(recognitionById.get(r.id)!)
          : undefined,
      };
      const list = out.get(r.noteGuid) ?? [];
      list.push(row);
      out.set(r.noteGuid, list);
    }
    return out;
  }
}

