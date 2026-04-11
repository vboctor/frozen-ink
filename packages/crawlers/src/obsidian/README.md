# Obsidian Vault Crawler

Syncs markdown files and attachments from a local Obsidian vault, preserving the original vault structure and content.

[Back to main README](../../../../README.md) | [All crawlers](../../../../README.md#crawlers)

## Setup

```bash
bunx fink add obsidian \
  --name my-vault \
  --path /path/to/vault
```

**Required flags:**

- `--name` - Collection name
- `--path` - Absolute or relative path to the Obsidian vault directory

Validation checks that the path exists (prefers vaults with a `.obsidian/` directory but accepts any directory).

## What It Extracts

### Notes (`.md` files)

| Field | Source |
|-------|--------|
| Title | First `# Heading` in the file, or filename if no heading |
| Content | Full raw markdown (preserved as-is) |
| Frontmatter | Parsed YAML between `---` fences |
| Tags | From frontmatter `tags` field + inline `#hashtags` in the body |
| File metadata | Relative path, modification time, file size |
| Content hash | SHA-256 of content + mtime |

### Attachments (images and other files)

Images and files referenced via `![[path]]` or `![alt](path)` are:

1. Detected by parsing image references in each markdown file
2. Resolved by filename (Obsidian short links) or full relative path
3. Read from the vault and stored as entity attachments
4. Served via `/api/attachments/` for display in the web UI

Supported formats: PNG, JPG, JPEG, GIF, SVG, WebP, BMP, ICO, PDF, MP3, MP4, WebM, WAV, OGG, ZIP, CSV, XLS/XLSX, DOC/DOCX, PPT/PPTX.

## Generated Markdown

The Obsidian theme is a **passthrough** — it returns the original vault markdown content unchanged. This means:

- Frontmatter is preserved
- Wikilinks (`[[target]]` and `[[target|label]]`) are preserved
- Callout blocks (`> [!type] title`) are preserved
- Image embeds (`![[image.png]]`) are preserved
- The UI's markdown viewer handles rendering all of these

### File paths

Files are stored at their original vault-relative paths:

- `notes/daily/2024-01-15.md` stays at `notes/daily/2024-01-15.md`
- `projects/alpha/readme.md` stays at `projects/alpha/readme.md`

## Sync Behavior

### Initial Sync

1. Recursively walks the vault directory
2. Skips excluded directories: `.obsidian/`, `.trash/`, `.git/`, `node_modules/`
3. Collects all `.md` files with their modification times
4. Collects all attachment files (images, etc.) and indexes them by path and filename
5. For each `.md` file:
   - Reads content and parses frontmatter
   - Extracts title from first `# Heading` or filename
   - Extracts tags from frontmatter + inline `#hashtags`
   - Parses `![[path]]` and `![](path)` image references
   - Reads referenced images and includes them as attachments
   - Computes SHA-256 content hash from content + mtime
6. Stores the max mtime across all files as the sync cursor
7. Stores all current `.md` file paths in the cursor for deletion tracking

### Incremental Sync

1. Walks the vault and compares file mtimes against `lastSyncTime` from the cursor
2. Only processes `.md` files with `mtime > lastSyncTime`
3. If any attachment files changed, re-syncs all markdown files that reference them
4. Compares current file paths against `knownPaths` to detect deleted files
5. Returns `deletedExternalIds` for files that no longer exist

### Sync Cursor

```json
{
  "lastSyncTime": 1705312200000,
  "knownPaths": ["notes/daily.md", "projects/alpha.md", ...]
}
```

The `lastSyncTime` is set to `Math.ceil(maxMtime)` across all files to handle sub-millisecond filesystem precision.

## Configuration

```json
{
  "config": {
    "vaultPath": "/Users/me/Documents/MyVault",
    "excludePatterns": []
  },
  "credentials": {
    "vaultPath": "/Users/me/Documents/MyVault"
  }
}
```

Optional `excludePatterns` allows filtering out files by path substring matching.

## Source Files

- [`crawler.ts`](crawler.ts) - `ObsidianCrawler` class with vault walking, frontmatter parsing, tag extraction, image reference parsing
- [`theme.ts`](theme.ts) - `ObsidianTheme` passthrough generator
- [`types.ts`](types.ts) - `ObsidianConfig`, `ObsidianCredentials`, `VaultFile` interfaces
- [`__tests__/crawler.test.ts`](__tests__/crawler.test.ts) - 21 crawler tests
- [`__tests__/theme.test.ts`](__tests__/theme.test.ts) - 5 theme tests
