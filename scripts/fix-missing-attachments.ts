#!/usr/bin/env bun
/**
 * One-off repair script: download missing attachment files for MantisBT collections.
 *
 * Handles two cases:
 *   A. Attachment has no storagePath (never downloaded): download and set storagePath.
 *   B. Attachment has storagePath but file is missing from disk: re-download to same path.
 *
 * Uses the MantisBT REST API (with auth token if configured) for reliable downloads.
 * Falls back to file_download.php for public trackers.
 *
 * After running, regenerate markdown with:
 *   bun run fink -- generate <collection>
 *
 * Usage:
 *   bun scripts/fix-missing-attachments.ts xdebug
 *   bun scripts/fix-missing-attachments.ts mantisbt
 */

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

const COLLECTION = process.argv[2];
if (!COLLECTION) {
  console.error("Usage: bun scripts/fix-missing-attachments.ts <collection>");
  process.exit(1);
}

const FROZENINK_DIR = join(homedir(), ".frozenink");
const COLLECTIONS_DIR = join(FROZENINK_DIR, "collections");
const COLLECTION_DIR = join(COLLECTIONS_DIR, COLLECTION);
const DB_PATH = join(COLLECTION_DIR, "db", "data.db");

if (!existsSync(DB_PATH)) {
  console.error(`DB not found: ${DB_PATH}`);
  process.exit(1);
}

const configFile = join(COLLECTION_DIR, `${COLLECTION}.yml`);
if (!existsSync(configFile)) {
  console.error(`Config not found: ${configFile}`);
  process.exit(1);
}
const configText = await Bun.file(configFile).text();
const urlMatch = configText.match(/url:\s*(.+)/);
if (!urlMatch) {
  console.error("Could not find url in config");
  process.exit(1);
}
const BASE_URL = urlMatch[1].trim().replace(/\/+$/, "");

// Load auth token from credentials if configured.
let AUTH_TOKEN = "";
const credMatch = configText.match(/^credentials:\s*(\S+)/m);
if (credMatch && credMatch[1] !== "{}") {
  const credName = credMatch[1];
  const globalCreds = join(FROZENINK_DIR, "credentials.yml");
  if (existsSync(globalCreds)) {
    const credsText = await Bun.file(globalCreds).text();
    const tokenMatch = new RegExp(`${credName}:\\s*\\n\\s+token:\\s*(\\S+)`).exec(credsText);
    if (tokenMatch) AUTH_TOKEN = tokenMatch[1];
  }
}

console.log(`Collection: ${COLLECTION}  Base URL: ${BASE_URL}`);
console.log(`Auth token: ${AUTH_TOKEN ? `${AUTH_TOKEN.slice(0, 4)}…(${AUTH_TOKEN.length} chars)` : "none"}\n`);

const db = new Database(DB_PATH, { readwrite: true });

const rows = db.query<{ external_id: string; data: string }, []>(
  "SELECT external_id, data FROM entities WHERE json_extract(data, '$.source.id') IS NOT NULL"
).all();

console.log(`Found ${rows.length} entities to scan...\n`);

let fixed = 0;
let skipped = 0;
let errors = 0;

const authHeaders: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (compatible; FrozenInk/1.0)",
};
if (AUTH_TOKEN) authHeaders["Authorization"] = AUTH_TOKEN;

/** Download via REST API (returns base64-decoded binary). */
async function downloadViaRestApi(issueId: number, fileId: number): Promise<Buffer | null> {
  const url = `${BASE_URL}/api/rest/issues/${issueId}/files/${fileId}`;
  try {
    const res = await fetch(url, { headers: authHeaders });
    if (!res.ok) return null;
    const data = (await res.json()) as { files?: Array<{ content?: string }> };
    const b64 = data.files?.[0]?.content;
    if (!b64) return null;
    return Buffer.from(b64, "base64");
  } catch {
    return null;
  }
}

/** Download via file_download.php (works on public trackers without auth). */
async function downloadViaLegacy(fileId: number, type: "bug" | "bugnote"): Promise<Buffer | null> {
  const url = `${BASE_URL}/file_download.php?file_id=${fileId}&type=${type}`;
  try {
    const res = await fetch(url, { headers: authHeaders, redirect: "follow" });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    // If the server returns HTML it's a login redirect or error page — skip.
    if (ct.includes("text/html")) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

function slugifyProjectName(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

function assetFilename(id: number, filename: string): string {
  return `${id}-${filename}`;
}

for (const row of rows) {
  const entityData = JSON.parse(row.data) as {
    source: {
      id: number;
      project?: { name?: string };
      attachments?: Array<{ id?: number; filename: string; content_type?: string; size?: number; storagePath?: string }>;
      notes?: Array<{ id: number; attachments?: Array<{ id: number; filename: string; content_type?: string; storagePath?: string }> }>;
    };
    assets?: Array<{ filename: string; mimeType: string; storagePath: string; hash?: string }>;
  };

  const source = entityData.source;
  const issueId = source.id;

  // Case A: no storagePath (never downloaded).
  const missingIssueAtts = (source.attachments ?? []).filter((f) => !f.storagePath);
  const missingNoteAtts = (source.notes ?? []).flatMap((note) =>
    (note.attachments ?? []).filter((att) => !att.storagePath).map((att) => ({ ...att, noteId: note.id }))
  );

  // Case B: storagePath set but file missing from disk.
  const staleIssueAtts = (source.attachments ?? []).filter(
    (f) => f.storagePath && !existsSync(join(COLLECTION_DIR, f.storagePath))
  );
  const staleNoteAtts = (source.notes ?? []).flatMap((note) =>
    (note.attachments ?? [])
      .filter((att) => att.storagePath && !existsSync(join(COLLECTION_DIR, att.storagePath)))
      .map((att) => ({ ...att, noteId: note.id }))
  );

  if (
    missingIssueAtts.length === 0 &&
    missingNoteAtts.length === 0 &&
    staleIssueAtts.length === 0 &&
    staleNoteAtts.length === 0
  )
    continue;

  const total = missingIssueAtts.length + missingNoteAtts.length + staleIssueAtts.length + staleNoteAtts.length;
  console.log(`Issue ${issueId}: ${total} attachment(s) to fix (${missingIssueAtts.length + missingNoteAtts.length} new, ${staleIssueAtts.length + staleNoteAtts.length} stale)`);

  // Determine asset prefix for NEW (no-storagePath) attachments.
  let assetPrefix: string | null = null;
  // Try to infer from existing storagePaths (even stale ones give us the right directory).
  for (const f of source.attachments ?? []) {
    if (f.storagePath) { assetPrefix = dirname(f.storagePath); break; }
  }
  if (!assetPrefix) {
    for (const note of source.notes ?? []) {
      for (const att of note.attachments ?? []) {
        if (att.storagePath) { assetPrefix = dirname(att.storagePath); break; }
      }
      if (assetPrefix) break;
    }
  }
  if (!assetPrefix && source.project?.name) {
    assetPrefix = `content/${slugifyProjectName(source.project.name)}/issues/assets`;
  }

  // Fetch from REST API if issue-level attachments are missing their IDs.
  if (missingIssueAtts.some((f) => f.id === undefined)) {
    try {
      const res = await fetch(`${BASE_URL}/api/rest/issues/${issueId}`, { headers: authHeaders });
      if (res.ok) {
        const apiData = (await res.json()) as { issues: Array<{ attachments?: Array<{ id: number; filename: string }> }> };
        const apiAtts = apiData.issues?.[0]?.attachments ?? [];
        for (const f of missingIssueAtts) {
          if (f.id === undefined) {
            const match = apiAtts.find((a) => a.filename === f.filename);
            if (match) f.id = match.id;
          }
        }
      }
    } catch { /* ignore */ }
  }

  let changed = false;

  // Helper: download a file and save it.
  async function saveAttachment(
    fileId: number,
    filename: string,
    mimeType: string | undefined,
    storagePath: string,
    noteType: "bug" | "bugnote",
  ): Promise<boolean> {
    const diskPath = join(COLLECTION_DIR, storagePath);
    mkdirSync(dirname(diskPath), { recursive: true });

    // Try REST API first (works with auth), then legacy URL.
    let content = await downloadViaRestApi(issueId, fileId);
    if (!content) content = await downloadViaLegacy(fileId, noteType);
    if (!content) {
      console.warn(`    ✗ Could not download ${filename} (id=${fileId})`);
      errors++;
      return false;
    }
    writeFileSync(diskPath, content);
    if (!entityData.assets) entityData.assets = [];
    // Remove stale entry if present.
    entityData.assets = entityData.assets.filter((a) => a.storagePath !== storagePath);
    entityData.assets.push({ filename, mimeType: mimeType ?? "application/octet-stream", storagePath });
    console.log(`    ✓ ${filename} (${content.length} bytes) → ${storagePath}`);
    fixed++;
    return true;
  }

  // Process new issue-level attachments (no storagePath).
  for (const f of missingIssueAtts) {
    if (!assetPrefix) { console.warn(`    No asset prefix for issue ${issueId}`); skipped++; continue; }
    if (f.id === undefined) { console.warn(`    No ID for ${f.filename}`); skipped++; continue; }
    const storedName = assetFilename(f.id, f.filename);
    const storagePath = `${assetPrefix}/${storedName}`;
    if (await saveAttachment(f.id, storedName, f.content_type, storagePath, "bug")) {
      f.storagePath = storagePath;
      changed = true;
    }
  }

  // Process stale issue-level attachments (storagePath set but file missing).
  for (const f of staleIssueAtts) {
    const storagePath = f.storagePath!;
    // Extract file ID from stored filename (format: {id}-{filename}).
    const storedName = storagePath.split("/").pop()!;
    const idMatch = storedName.match(/^(\d+)-/);
    if (!idMatch) { console.warn(`    Cannot parse ID from ${storedName}`); skipped++; continue; }
    const fileId = parseInt(idMatch[1], 10);
    await saveAttachment(fileId, storedName, f.content_type, storagePath, "bug");
    changed = true; // storagePath already set correctly, just restore the file
  }

  // Process new note attachments (no storagePath).
  for (const att of missingNoteAtts) {
    if (!assetPrefix) { console.warn(`    No asset prefix for note att`); skipped++; continue; }
    const storedName = assetFilename(att.id, att.filename);
    const storagePath = `${assetPrefix}/${storedName}`;
    if (await saveAttachment(att.id, storedName, att.content_type, storagePath, "bugnote")) {
      const noteAtt = source.notes?.find((n) => n.id === att.noteId)?.attachments?.find((a) => a.id === att.id);
      if (noteAtt) { noteAtt.storagePath = storagePath; changed = true; }
    }
  }

  // Process stale note attachments (storagePath set but file missing).
  for (const att of staleNoteAtts) {
    const storagePath = att.storagePath!;
    const storedName = storagePath.split("/").pop()!;
    const idMatch = storedName.match(/^(\d+)-/);
    if (!idMatch) { console.warn(`    Cannot parse ID from ${storedName}`); skipped++; continue; }
    const fileId = parseInt(idMatch[1], 10);
    await saveAttachment(fileId, storedName, att.content_type, storagePath, "bugnote");
    changed = true;
  }

  if (changed) {
    db.run("UPDATE entities SET data = ? WHERE external_id = ?", [
      JSON.stringify(entityData),
      row.external_id,
    ]);
  }
}

db.close();

console.log(`\nDone. Fixed: ${fixed}  Skipped: ${skipped}  Errors: ${errors}`);
console.log(`\nRun: bun run fink -- generate ${COLLECTION}  to regenerate markdown with updated storagePaths.`);
