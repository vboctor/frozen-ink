# GitHub Crawler

Syncs issues, pull requests, and user profiles from a GitHub repository via the REST API, including comments, reviews, check statuses, and user avatars. Renders as navigable Obsidian-compatible markdown with an optional GitHub-inspired HTML view.

[Back to main README](../../../../README.md) | [All crawlers](../../../../README.md#crawlers)

## Setup

### 1. Create a GitHub Personal Access Token

1. Go to [GitHub Settings > Developer settings > Personal access tokens](https://github.com/settings/tokens)
2. Generate a new token (classic) with the **`repo`** scope (for private repos) or **`public_repo`** (for public repos only)
3. Copy the token — you'll need it in the next step

### 2. Add the Collection

```bash
fink add github \
  --name my-repo \
  --token ghp_xxxxxxxxxxxx \
  --repo my-org/my-repo
```

**Required flags:**

| Flag | Description |
|------|-------------|
| `--name <key>` | Collection name used in the UI and API (alphanumeric, dashes, underscores) |
| `--token <token>` | GitHub personal access token |
| `--repo <owner/repo>` | Repository in `owner/repo` format (e.g. `microsoft/typescript`) |

**Optional flags:**

| Flag | Description |
|------|-------------|
| `--title <title>` | Display title for the collection (defaults to the name) |
| `--open-only` | Only sync open issues/PRs; previously synced closed ones are deleted |
| `--max <count>` | Maximum entities per type (e.g. `--max 20` = at most 20 issues + 20 PRs) |
| `--max-issues <count>` | Maximum number of issues to sync |
| `--max-prs <count>` | Maximum number of pull requests to sync |

The token is validated against the GitHub API before the collection is created.

### 3. Sync

```bash
fink sync my-repo                      # Incremental sync (only changed items)
fink sync my-repo --full               # Full re-sync (wipes and re-fetches everything)
fink sync my-repo --max 10             # At most 10 issues + 10 PRs
fink sync my-repo --max-issues 5       # Limit issues only (no PR limit)
fink sync my-repo --max-prs 3          # Limit PRs only (no issue limit)
```

The `--max` flag sets both `maxIssues` and `maxPullRequests` to the same value. The `--max-issues` and `--max-prs` flags override individually. All flags on `fink sync` override the collection's config for that run and work with both incremental and full syncs.

### Updating Collection Config

```bash
fink update my-repo --open-only        # Switch to open-only mode
fink update my-repo --max 50           # Change max to 50 per type
fink update my-repo --open-only false  # Disable open-only mode
```

After updating, re-sync with `fink sync my-repo --full` to apply the new settings.

### Example: Sync Only Open Issues

```bash
fink add github \
  --name my-repo-open \
  --token $GITHUB_TOKEN \
  --repo my-org/my-repo \
  --open-only
```

This keeps only currently open issues and PRs. When an issue is closed, the next sync deletes it from the local database and filesystem.

## What It Extracts

### Issues

| Field | Source |
|-------|--------|
| Title | `issue.title` |
| State | open / closed |
| State reason | completed / not_planned / reopened (for closed issues) |
| Author | login, avatar URL, profile URL |
| Assignees | login, avatar URL, profile URL (each) |
| Labels | name + hex color (also stored as entity tags) |
| Milestone | `issue.milestone.title` |
| Body | Issue description (markdown) |
| Comments | Full comment thread with author, body, date, reactions |
| Reactions | Counts for each reaction type on the issue and each comment |
| Cross-references | `#123` patterns parsed from body |
| Dates | created, updated, closed |

### Pull Requests

All issue fields plus:

| Field | Source |
|-------|--------|
| Review status | pending / merged / draft / closed |
| Head branch | ref name + SHA |
| Base branch | ref name + SHA |
| Merged status | boolean + merged date |
| Draft status | boolean |
| Reviews | Reviewer, state (approved/changes requested/commented), body, date |
| Check runs | CI name, status, conclusion (success/failure/etc.), URLs |
| Review comments count | `pr.review_comments` |

### Users

Users referenced by issues and PRs (authors, assignees, reviewers, commenters) are automatically synced as separate entities:

| Field | Source |
|-------|--------|
| Name | `user.name` (display name) |
| Login | `user.login` (username) |
| Avatar | `user.avatar_url` |
| Bio | `user.bio` |
| Company | `user.company` |
| Location | `user.location` |
| Blog | `user.blog` |
| Stats | public repos, followers, following |
| Dates | account created, last updated |

Users are deduplicated across all issues and PRs — each user is fetched once regardless of how many times they appear.

Issues and PRs have relations to user entities: `authored_by`, `assigned_to`, and `reviewed_by` (PRs only).

## Generated Markdown

Each entity is rendered as Obsidian-compatible markdown with:

- **YAML frontmatter** — title, type, number, state, state_reason, source URL, dates, labels as tags, author, assignees
- **Metadata callout** — author with avatar, state (with reason), assignees, milestone, labels, reactions
- **Body content** — the issue/PR description
- **Related issues callout** — wikilinks to referenced issues (`[[issues/123|#123]]`)
- **Branch info callout** (PRs only) — head/base refs with SHAs, merge info
- **Check runs callout** (PRs only) — status table with conclusion icons
- **Reviews section** (PRs only) — reviewer avatar, state badge, body
- **Comments section** — full comment thread with author avatars, dates, reactions
- **User profile** — login, bio, company, location, stats

### HTML View

The GitHub crawler also supports a styled HTML view in the web UI, inspired by GitHub's own issue/PR/user layout. Toggle between Markdown and HTML views using the buttons in the toolbar. The HTML automatically adapts to the selected UI theme (Default Light, Nord Dark, Dracula, etc.).

### File Paths

- Issues: `issues/<number>-<slug>.md`
- Pull requests: `pull-requests/<number>-<slug>.md`
- Users: `users/<login>.md`

## Sync Behavior

### Incremental Sync (default)

1. Loads the stored `updatedSince` timestamp from the sync cursor
2. Fetches issues updated after that timestamp (`?since=...&state=all&sort=updated&direction=asc`)
3. Filters out PRs returned on the issues endpoint (GitHub returns both)
4. Fetches pull requests updated after the cursor
5. For each issue/PR: fetches comments, reviews (PRs), and check runs (PRs) if enabled
6. Collects all unique user logins from authors, assignees, reviewers, and commenters
7. Fetches full profiles for each unique user via `GET /users/:login`
8. Entities are upserted — the sync engine compares SHA-256 content hashes and only re-renders changed entities
9. Stores the latest `updated_at` as the new cursor

This means only recently changed items are fetched. A repo with 10,000 issues but only 5 updated since the last sync will make ~5 API calls for the list pages plus a few per item for comments/checks.

### Open-Only Mode (`openOnly: true`)

1. Fetches all open issues (`?state=open`) ��� no `since` filter, always gets the complete set
2. Fetches all open pull requests
3. Compares against the set of IDs from the previous sync
4. Items no longer in the open set are returned as deletions — the sync engine removes them from the DB and filesystem
5. Stores the current open ID set in the cursor for the next comparison

This is efficient for repos where you only care about active work. Open items are typically a small fraction of total items.

### Phase State Machine

The crawler uses a phase-based approach to handle pagination across multiple endpoints:

```
issues (page 1, 2, ...) → pulls (page 1, 2, ...) → users → done
```

Each `sync()` call processes one page and returns `hasMore: true` until all pages in all phases are complete. This allows the sync engine to persist progress between pages.

### Per-Type Limits

The `maxIssues` and `maxPullRequests` options limit how many of each type are fetched. They are tracked independently in the sync cursor via `issuesFetched` and `pullsFetched` counters. The global `maxEntities` acts as a cap across all types combined. When a per-type limit is reached, the crawler skips to the next phase. When the global limit is reached, the crawler finalizes immediately.

### Sync Cursor

```json
{
  "phase": "done",
  "updatedSince": "2024-01-15T10:30:00Z",
  "issuesPage": 1,
  "pullsPage": 1,
  "issuesFetched": 50,
  "pullsFetched": 20,
  "knownOpenIds": ["issue-1", "issue-5", "pr-10"]
}
```

The `knownOpenIds` field is only present in open-only mode and stores the IDs from the last completed sync for deletion detection.

### Skipping Unchanged Entities

The sync engine computes a SHA-256 hash of each entity's data. If the hash matches the stored hash, the entity is skipped entirely — no markdown re-render, no file write, no search index update. This makes incremental syncs fast even for large batches.

## Configuration

Stored in `~/.frozenink/context.yml`:

```yaml
collections:
  my-repo:
    crawler: github
    config:
      owner: my-org
      repo: my-repo
      syncIssues: true          # default: true
      syncPullRequests: true    # default: true
      syncComments: true        # default: true
      syncCheckStatuses: true   # default: true
      openOnly: false           # default: false
      maxEntities: 50           # optional, no default (sync all)
      maxIssues: 20             # optional, no default (sync all)
      maxPullRequests: 10       # optional, no default (sync all)
    credentials:
      token: ghp_...
      owner: my-org
      repo: my-repo
```

| Option | Default | Description |
|--------|---------|-------------|
| `syncIssues` | `true` | Sync issues |
| `syncPullRequests` | `true` | Sync pull requests |
| `syncComments` | `true` | Fetch comments for issues and PRs, reviews for PRs |
| `syncCheckStatuses` | `true` | Fetch CI check runs for PRs |
| `openOnly` | `false` | Only sync open items; delete closed ones |
| `maxEntities` | none | Maximum total entities across all types |
| `maxIssues` | none | Maximum issues to sync |
| `maxPullRequests` | none | Maximum pull requests to sync |

To change options after creation, edit `~/.frozenink/context.yml` directly and re-sync.

## API Rate Limits

The crawler uses the GitHub REST API with token authentication (5,000 requests/hour). For each page of 100 issues/PRs, additional API calls are made per item:

- 1 call per item with comments (skipped if comment count is 0)
- 1 call per PR for reviews
- 1 call per PR for check runs
- 1 call per unique user for profile data

For a repo with 50 open issues (10 with comments, 15 unique users) and 20 open PRs, a full sync uses approximately: 1 (issues page) + 10 (comments) + 1 (PRs page) + 20 (reviews) + 20 (checks) + 15 (user profiles) = **67 API calls**.

Set `syncComments: false` and/or `syncCheckStatuses: false` to reduce API usage if you don't need that data.

## Source Files

- [`crawler.ts`](crawler.ts) — `GitHubCrawler` class implementing the `Crawler` interface
- [`theme.ts`](theme.ts) — `GitHubTheme` markdown + HTML generator for issues, PRs, and users
- [`types.ts`](types.ts) — TypeScript interfaces for GitHub API responses
- [`__tests__/crawler.test.ts`](__tests__/crawler.test.ts) — Crawler tests (sync, pagination, comments, reviews, checks, openOnly, per-type limits, users)
- [`__tests__/theme.test.ts`](__tests__/theme.test.ts) — Theme tests (markdown rendering, HTML rendering, user rendering)
