# MantisBT Crawler

Crawls a MantisBT instance via its REST API, syncing issues (with attachments), users, and projects.

## Configuration

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `baseUrl` | string | Yes | Base URL of the MantisBT instance (e.g. `https://mantisbt.org/bugs`) |
| `projectName` | string | No | Project name to filter issues. Resolved to a project ID via the MantisBT projects API at collection creation time. Both `projectName` and `projectId` are persisted so subsequent syncs skip the lookup. |
| `projectId` | number | No | Project ID (set automatically when `projectName` is resolved; can also be set directly for backward compatibility). |
| `maxEntities` | number | No | Maximum number of issues to sync (useful for testing). |

## Credentials

| Field | Type | Description |
|-------|------|-------------|
| `token` | string | MantisBT REST API token. Optional for public instances. |

## Sync Behavior

- Fetches issues in pages of 25, sleeping 100ms between pages to avoid overloading the server.
- Issues are sorted by `updated_at` descending. Incremental syncs use the `updatedSince` cursor to only process issues updated since the last completed sync.
- After all issue pages are processed, the crawler enters a "users" phase where it fetches full user profiles and emits user and project entities.

## Attachment Downloads

Attachments (both issue-level and note-level) are downloaded using the core MantisBT REST API:

1. **`download_url`** (if provided in the issue response): Downloaded as binary.
2. **`GET /api/rest/issues/{id}/files/{file_id}`** (operationId: `IssueFileGet`): Returns JSON with base64-encoded file content. This endpoint works for both issue-level files and note-level attachments per the MantisBT OpenAPI spec.

## MantisHub Mode

MantisHub mode is automatically enabled when the `baseUrl` contains `.mantishub.` (e.g. `https://example.mantishub.io`). All core MantisBT APIs work identically on MantisHub, so MantisHub mode only activates as a **fallback** when the core API fails.

### Why MantisHub mode exists

MantisHub instances may store file attachments in cloud storage (S3) rather than locally on the server. In this configuration, the core MantisBT REST API file download endpoint may fail because the file content isn't accessible from the local filesystem. MantisHub mode provides a fallback path to retrieve these files.

### When MantisHub mode activates

The crawler always tries the core MantisBT REST API first for every attachment download. Only if the core API fails to return the file content does MantisHub mode kick in. When it does, it makes one API call per issue (cached across all attachments on that issue) to MantisHub's **ApiX plugin**:

```text
GET /api/rest/plugins/ApiX/issues/{id}/pages/view
```

This is the IssueViewPage endpoint from the ApiX plugin (`IssueViewPageCommandX`). It returns attachment metadata with:

- `url` - Standard download URL (`file_download.php?file_id={id}&type=bug`)
- `signed_url` - Pre-authenticated, time-limited URL for direct cloud storage access (MantisHub only)

The crawler prefers `signed_url` over `url` for the binary download.

### What MantisHub mode does NOT change

- Issue listing uses the standard MantisBT REST API (`GET /api/rest/issues`)
- Project resolution uses the standard MantisBT REST API (`GET /api/rest/projects`)
- User fetching uses the standard MantisBT REST API (`GET /api/rest/users/{id}`)
- Attachment downloads try the standard MantisBT REST API first

The ApiX plugin is only used as a last resort for attachment downloads, covering the specific gap where cloud-stored files can't be served by the core MantisBT API.
