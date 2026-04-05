# Git Repository Crawler

Crawls a local Git repository, capturing metadata for all commits, branches, and tags. Renders navigable markdown with wikilinks between related entities. Optionally includes syntax-highlighted diffs with binary image support.

[Back to main README](../../../../README.md) | [All crawlers](../../../../README.md#crawlers)

## Setup

```bash
# Without diffs (metadata only)
bunx vctx add git \
  --name my-repo \
  --path /path/to/repo

# With diffs included
bunx vctx add git \
  --name my-repo \
  --path /path/to/repo \
  --include-diffs
```

**Required flags:**
- `--name` - Collection name
- `--path` - Path to a local Git repository (must contain a `.git` directory)

**Optional flags:**
- `--include-diffs` - Include patch diffs in commit markdown (default: off)

Validation checks that the path exists and is a valid Git repository via `git rev-parse --git-dir`.

## What It Extracts

### Commits

| Field | Source |
|-------|--------|
| Hash | Full + short (7-char) SHA |
| Author | Name + email from `git log` |
| Date | ISO 8601 author date |
| Subject | First line of commit message |
| Body | Remaining commit message lines |
| Parents | Parent commit hashes (supports merge commits) |
| Files changed | Status (A/M/D/R/C), path, additions, deletions, binary flag |
| Diff | Full unified diff (optional, truncated at 200KB) |
| Image attachments | Binary images extracted at the commit (when diffs enabled) |

### Branches

| Field | Source |
|-------|--------|
| Name | Branch ref name |
| Tip commit | Short hash of HEAD commit |
| Type | Local or remote |
| Recent commits | Last 20 commits with hashes and subjects |

### Tags

| Field | Source |
|-------|--------|
| Name | Tag ref name |
| Target commit | The commit the tag points to |
| Type | Annotated or lightweight |
| Tagger | Name (annotated tags only) |
| Date | Creation date |
| Subject | Tag message first line (annotated tags only) |

## Generated Markdown

### Commit pages

Each commit renders as rich markdown with:

- **YAML frontmatter** - hash, author, date, parent short hashes, file change tags
- **Commit Info callout** - author, date, hash, parent wikilinks (e.g., `[[commits/def5678-add-auth-module|def5678]]`)
- **Body** - extended commit message (if present)
- **Files Changed callout** - status, path, line counts (`+10, -5`), binary indicators
- **Image embeds** - for binary image changes: `![[git/abc1234/logo.png]]`
- **Diff section** - fenced `diff` code block with syntax highlighting (if `includeDiffs` is enabled)

### Branch pages

- **Branch Info callout** - tip commit wikilink, local/remote type
- **Recent Commits list** - last 20 commits as wikilinks with subjects

### Tag pages

- **Tag Info callout** - target commit wikilink, annotated/lightweight type, tagger, date
- **Message** - tag message content

### File paths

- Commits: `commits/<short-hash>-<slugified-subject>.md`
- Branches: `branches/<name>.md` (slashes replaced with dashes)
- Tags: `tags/<name>.md`

### Navigation

All entities are cross-linked via Obsidian wikilinks:
- Commits link to parent commits
- Branches link to their tip commit and list recent commits
- Tags link to their target commit

## Sync Behavior

### Initial Sync

1. Runs `git rev-list --all` to get all commit hashes
2. Parses commit metadata via `git log --all --format=...` (NUL-separated fields)
3. Parses file statuses via `git log --all --format=COMMIT_SEP%H --name-status`
4. Parses line counts via `git log --all --format=COMMIT_SEP%H --numstat`
5. Merges file status and numstat data per commit
6. Parses branches via `git for-each-ref refs/heads/ refs/remotes/`
7. Parses tags via `git for-each-ref refs/tags/`
8. If `includeDiffs`: fetches diffs via `git diff-tree -p --root` per new commit
9. For binary image changes: extracts file content via `git show <hash>:<path>`
10. Builds entities for all commits, branches, and tags

### Incremental Sync

1. Gets current commit hashes and compares against `knownCommitHashes` in cursor
2. **Only new commits are processed** - commit entities are immutable (hash = contentHash)
3. Branches are always refreshed (tip may have moved with new commits)
4. Tags are always refreshed (new tags may have been created)
5. Detects deletions:
   - Force-pushed commits no longer reachable
   - Deleted branches
   - Deleted tags

### Sync Cursor

```json
{
  "knownCommitHashes": ["abc123...", "def456...", ...],
  "knownBranches": ["main", "feature/xyz", ...],
  "knownTags": ["v1.0.0", "v1.1.0", ...]
}
```

### Performance Notes

- Commit hashes are used as `contentHash` — the sync engine skips re-rendering for existing commits since they never change
- Branch/tag entities use computed hashes and are only re-rendered when their data changes
- Diffs are truncated at 200KB per commit to prevent memory issues
- Binary file extraction is limited to 10MB per file
- All git parsing uses efficient batch commands (`git log --all`) rather than per-commit queries

## Configuration

```json
{
  "config": {
    "repoPath": "/Users/me/projects/my-repo",
    "includeDiffs": true
  },
  "credentials": {
    "repoPath": "/Users/me/projects/my-repo"
  }
}
```

## Source Files

- [`crawler.ts`](crawler.ts) - `GitCrawler` class with git command parsing, entity building, diff extraction
- [`theme.ts`](theme.ts) - `GitTheme` markdown generator for commits, branches, and tags
- [`types.ts`](types.ts) - `GitConfig`, `GitCredentials`, `GitCommitInfo`, `GitFileChange`, `GitBranchInfo`, `GitTagInfo`
- [`__tests__/crawler.test.ts`](__tests__/crawler.test.ts) - 23 crawler tests (using real temp git repos)
- [`__tests__/theme.test.ts`](__tests__/theme.test.ts) - 22 theme tests
