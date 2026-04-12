/**
 * TextBundle / TextPack export.
 *
 * A TextBundle (.textbundle) is a macOS package containing:
 *   - info.json   — format metadata
 *   - text.md     — the markdown document
 *   - assets/     — referenced images
 *
 * A TextPack (.textpack) is the same structure zipped into a single file.
 * Bear, Ulysses, and other writing apps can open both formats.
 *
 * This module produces a TextPack (zip buffer) from a markdown file and its
 * attachments on disk, so the result can be streamed directly to the browser.
 */

import { existsSync, readFileSync } from "fs";
import { join, basename } from "path";
import { getFrozenInkHome } from "../config/loader";

// ---------------------------------------------------------------------------
// Minimal ZIP builder (store-only, no compression — images are already
// compressed and markdown is tiny). No external dependencies required.
// ---------------------------------------------------------------------------

function crc32(buf: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  name: string; // path inside zip
  data: Uint8Array;
}

function buildZip(entries: ZipEntry[]): Uint8Array {
  const localHeaders: Uint8Array[] = [];
  const centralHeaders: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = new TextEncoder().encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    // Local file header (30 bytes + name + data)
    const local = new Uint8Array(30 + nameBytes.length + size);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); // signature
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0, true); // flags
    lv.setUint16(8, 0, true); // compression: store
    lv.setUint16(10, 0, true); // mod time
    lv.setUint16(12, 0, true); // mod date
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true); // compressed size
    lv.setUint32(22, size, true); // uncompressed size
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true); // extra length
    local.set(nameBytes, 30);
    local.set(entry.data, 30 + nameBytes.length);
    localHeaders.push(local);

    // Central directory header (46 bytes + name)
    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); // signature
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(8, 0, true); // flags
    cv.setUint16(10, 0, true); // compression: store
    cv.setUint16(12, 0, true); // mod time
    cv.setUint16(14, 0, true); // mod date
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true); // extra length
    cv.setUint16(32, 0, true); // comment length
    cv.setUint16(34, 0, true); // disk start
    cv.setUint16(36, 0, true); // internal attrs
    cv.setUint32(38, 0, true); // external attrs
    cv.setUint32(42, offset, true); // local header offset
    central.set(nameBytes, 46);
    centralHeaders.push(central);

    offset += local.length;
  }

  const centralDirOffset = offset;
  let centralDirSize = 0;
  for (const h of centralHeaders) centralDirSize += h.length;

  // End of central directory record (22 bytes)
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); // signature
  ev.setUint16(4, 0, true); // disk number
  ev.setUint16(6, 0, true); // central dir disk
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralDirSize, true);
  ev.setUint32(16, centralDirOffset, true);
  ev.setUint16(20, 0, true); // comment length

  const totalSize = offset + centralDirSize + 22;
  const result = new Uint8Array(totalSize);
  let pos = 0;
  for (const h of localHeaders) {
    result.set(h, pos);
    pos += h.length;
  }
  for (const h of centralHeaders) {
    result.set(h, pos);
    pos += h.length;
  }
  result.set(eocd, pos);

  return result;
}

// ---------------------------------------------------------------------------
// TextPack builder
// ---------------------------------------------------------------------------

const INFO_JSON = JSON.stringify(
  {
    version: 2,
    type: "net.daringfireball.markdown",
    transient: false,
  },
  null,
  2,
);

/**
 * Build a .textpack (zipped TextBundle) for a single markdown page.
 *
 * @param collection  Collection name
 * @param filePath    Relative path to the markdown file within the collection's markdown/ dir
 * @returns           { filename, data } where data is the zip buffer, or null if file not found
 */
export function buildTextPack(
  collection: string,
  filePath: string,
): { filename: string; data: Uint8Array } | null {
  const home = getFrozenInkHome();
  const mdFullPath = join(home, "collections", collection, "markdown", filePath);

  if (!existsSync(mdFullPath)) return null;

  let markdown = readFileSync(mdFullPath, "utf-8");
  const attachmentsDir = join(home, "collections", collection, "attachments");

  // Find image embeds referencing attachments in all supported formats.
  const imageRefs: Array<{ match: string; path: string }> = [];
  let m: RegExpExecArray | null;

  // Obsidian-style embeds: ![[path]] (backward compat for vault content)
  const embedRegex = /!\[\[([^\]]+)\]\]/g;
  while ((m = embedRegex.exec(markdown)) !== null) {
    imageRefs.push({ match: m[0], path: m[1] });
  }

  // Standard markdown images: ![alt](../../attachments/path) or ![alt](attachments/path)
  const mdImageRegex = /!\[([^\]]*)\]\((?:\.\.\/\.\.\/)?attachments\/([^)]+)\)/g;
  while ((m = mdImageRegex.exec(markdown)) !== null) {
    imageRefs.push({ match: m[0], path: m[2] });
  }

  // Collect asset files and rewrite markdown
  const assets = new Map<string, Uint8Array>(); // assetFilename -> data

  for (const ref of imageRefs) {
    // The path may be "attachments/foo/bar.png" or just "foo/bar.png"
    const cleanPath = ref.path.replace(/^attachments\//, "");
    const diskPath = join(attachmentsDir, cleanPath);
    const assetName = basename(cleanPath);

    if (existsSync(diskPath)) {
      assets.set(assetName, new Uint8Array(readFileSync(diskPath)));
    }

    // Rewrite the embed to standard markdown pointing at assets/
    const alt = assetName.replace(/\.[^.]+$/, "");
    markdown = markdown.split(ref.match).join(`![${alt}](assets/${assetName})`);
  }

  // Build zip entries
  const entries: ZipEntry[] = [
    { name: "info.json", data: new TextEncoder().encode(INFO_JSON) },
    { name: "text.md", data: new TextEncoder().encode(markdown) },
  ];

  for (const [name, data] of assets) {
    entries.push({ name: `assets/${name}`, data });
  }

  const zipData = buildZip(entries);
  const stem = basename(filePath, ".md");
  return { filename: `${stem}.textpack`, data: zipData };
}
