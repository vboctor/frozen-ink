# GitHub Crawler

Syncs issues and pull requests from a GitHub repository via the REST API, rendering them as navigable Obsidian-compatible markdown.

[Back to main README](../../../../README.md) | [All crawlers](../../../../README.md#crawlers)

## Setup

```bash
bunx vctx add github \
  --name my-repo \
  --token $GITHUB_TOKEN \
  --owner <owner> \
  --repo <repo>
```

**Required flags:**
- `--name` - Collection name (used in the UI and API)
- `--token` - GitHub personal access token (requires `repo` scope)
- `--owner` - Repository owner (user or organization)
- `--repo` - Repository name

The token is validated against the GitHub API before the collection is created.

## What It Extracts

### Issues

| Field | Source |
|-------|--------|
| Title | `issue.title` |
| State | open / closed |
| Author | `issue.user.login` |
| Assignees | `issue.assignees[].login` |
| Labels | `issue.labels[].name` (also stored as tags) |
| Milestone | `issue.milestone.title` |
| Body | Issue description (markdown) |
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
| Review comments count | `pr.review_comments` |

## Generated Markdown

Each entity is rendered as Obsidian-compatible markdown with:

- **YAML frontmatter** - title, type, number, state, source URL, dates, labels as tags
- **Metadata callout** - author, state, assignees, milestone, labels
- **Body content** - the issue/PR description
- **Related issues callout** - wikilinks to referenced issues (`[[issues/123|#123]]`)
- **Branch info callout** (PRs only) - head/base refs with SHAs

### File paths

- Issues: `issues/<number>-<slug>.md`
- Pull requests: `pull-requests/<number>-<slug>.md`

### Navigation

- Issues cross-reference each other via wikilinks parsed from `#123` patterns in the body
- PRs link to related issues via the same mechanism

## Sync Behavior

### Initial Sync

1. Fetches all issues (state=all, sorted by updated date ascending) via `/repos/:owner/:repo/issues`
2. Filters out PRs returned on the issues endpoint (GitHub returns both)
3. Fetches all pull requests via `/repos/:owner/:repo/pulls`
4. Paginates at 100 items per page
5. Stores the latest `updated_at` timestamp as the sync cursor

### Incremental Sync

1. Uses the stored `updated_at` cursor with the `since` query parameter
2. Only fetches issues/PRs modified after the cursor
3. Phase-based state machine: `issues` -> `pulls` -> `done`
4. Entities are upserted — the sync engine compares content hashes and only re-renders changed entities

### Sync Cursor

```json
{
  "phase": "done",
  "updatedSince": "2024-01-15T10:30:00Z",
  "issuesPage": 1,
  "pullsPage": 1
}
```

## Configuration

Stored in the master database when the collection is created:

```json
{
  "config": {
    "owner": "my-org",
    "repo": "my-repo",
    "syncIssues": true,
    "syncPullRequests": true
  },
  "credentials": {
    "token": "ghp_...",
    "owner": "my-org",
    "repo": "my-repo"
  }
}
```

## Source Files

- [`crawler.ts`](crawler.ts) - `GitHubCrawler` class implementing the `Crawler` interface
- [`theme.ts`](theme.ts) - `GitHubTheme` markdown generator for issues and PRs
- [`types.ts`](types.ts) - TypeScript interfaces for GitHub API responses
- [`__tests__/crawler.test.ts`](__tests__/crawler.test.ts) - 12 crawler tests
- [`__tests__/theme.test.ts`](__tests__/theme.test.ts) - 13 theme tests
