# Evernote Crawler

Imports notes, notebooks, tags, and attachments from a local **Evernote v10**
install. No tokens, no network — the crawler reads Evernote's local SQLite
database (`conduit-storage`) plus the on-disk attachment cache.

Auto-detected paths by platform:

- **macOS**, sandboxed (App Store / direct download):
  `~/Library/Containers/com.evernote.Evernote/Data/Library/Application Support/Evernote/conduit-storage/`
- **macOS**, Setapp build: same container path with the Setapp bundle id.
- **Windows**: `%LOCALAPPDATA%\Evernote\Evernote\conduit-storage\` for the
  default installer; `%LOCALAPPDATA%\Packages\Evernote*\LocalCache\…` for MSIX
  / Microsoft Store builds.
- **Linux**: `~/.config/Evernote/conduit-storage/` or
  `~/snap/evernote/current/.config/Evernote/conduit-storage/`.

Within `conduit-storage/` the actual DB is one level deeper, under a
URL-encoded host directory (`https%3A%2F%2Fwww.evernote.com/UDB-User<id>+RemoteGraph.sql`),
which the crawler discovers automatically.

## Note body resolution

v10 does **not** store note bodies as ENML in the SQLite DB. The rich-text
content lives in a custom Yjs/CRDT binary blob under
`<app-support>/conduit-fs/.../rte/Note/internal_rteDoc/<aaa>/<bbb>/<noteGuid>.dat`.
The crawler decodes that blob with a best-effort extractor (`rte.ts`) that
walks printable ASCII runs and filters out structural metadata, hashes,
style declarations, and CRDT identifiers. Body text comes through; layout
and inline attachment placement do not. Resolution order, first non-empty
wins:

1. **`conduit-fs/.../<noteGuid>.dat`** — extracted via `rte.ts`. Most
   complete source for normally-edited notes.
2. **`Offline_Search_Note_Content.content`** — Evernote's own pre-stripped
   plain text, populated for notes the user has marked for offline access.
3. **`Nodes_Note.snippet`** — short preview, useful for very small notes.
4. **Legacy `content.enml`** on disk — for very old installs.

Attachments (images, PDFs) always render in their own `## Attachments`
section at the bottom of the markdown, regardless of where they appear in
the original note.

## Configuration

```yaml
crawler: evernote
config:
  conduitStoragePath: ~/Library/Containers/com.evernote.Evernote/Data/Library/Application\ Support/Evernote/conduit-storage
  notebooks: ["Personal", "Work"]   # optional allowlist; default = all
  snapshot: true                     # default; copies DB+WAL+SHM before reading
```

The default `conduitStoragePath` is auto-detected, so the field can be left
blank in most setups. `snapshot` is on by default and lets the crawler read
safely even while Evernote is running.

## OCR cascade

Each image / PDF attachment runs through a three-tier OCR cascade. The first
tier that returns non-empty text wins:

1. **Evernote-provided** `recognition` XML (free, exact, no work).
2. **Apple Vision** (macOS only) via a small Swift one-shot helper.
3. **Tesseract.js + pdfjs-dist** WASM fallback (lazy-loaded; tier is silently
   skipped when those modules aren't installed).

OCR text is written to `EntityData.assets[i].text` and indexed by FTS5 in the
`attachment_text` column with a 0.5× weight, so a body match still ranks above
an OCR-only match.

## Sync model

- USN-driven incremental sync per notebook: only notes whose
  `updateSequenceNum` exceeds the last high-water mark are re-emitted.
- Deletions are detected by diffing the previous run's known node ids against
  the current snapshot, plus any node whose `active` flag flipped to false.
- A single `sync()` call covers all notebooks; pagination isn't needed because
  reads are local.
