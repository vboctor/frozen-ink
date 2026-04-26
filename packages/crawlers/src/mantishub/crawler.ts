import type {
  Crawler,
  CrawlerMetadata,
  CrawlerEntityData,
  SyncCursor,
  SyncResult,
  AssetFilter,
  FailedEntity,
} from "@frozenink/core";
import { createCryptoHasher } from "@frozenink/core";
import type {
  MantisHubConfig,
  MantisHubCredentials,
  MantisHubEntityType,
  MantisHubIssue,
  MantisHubPage,
  MantisHubPageFile,
  MantisHubProject,
  MantisHubUser,
} from "./types";

interface MantisHubSyncCursor extends SyncCursor {
  /** Page number for next fetch (1-based). */
  page?: number;
  /** Total entities fetched so far (for --max limiting). */
  fetched?: number;
  /** Most recent issue updated_at seen in previous completed runs. */
  updatedSince?: string;
  /** Most recent issue updated_at seen in the current run. */
  newestSeenUpdatedAt?: string;
  /** Signature of the last fetched page to detect pagination loops. */
  lastPageSignature?: string;
  /** Number of consecutive repeated page signatures. */
  repeatedPageCount?: number;
  /** Current sync phase. Undefined / missing means "issues". */
  phase?: "issues" | "pages" | "users";
  /**
   * Frozen "as-of" timestamp for the in-progress full sync. Pinned at the
   * start of an initial sync so DESC pagination is stable across resumes —
   * new activity after this time doesn't shift pages mid-flight. Cleared
   * when the issues phase finishes; subsequent incremental syncs use
   * `updatedSince` as the watermark instead.
   */
  snapshotCeiling?: string;
  /** User data accumulated across issue pages (serialized in cursor). */
  _users?: Record<number, { id: number; name: string; email?: string }>;
  /** Project data accumulated across issue pages (serialized in cursor). */
  _projects?: Record<number, { id: number; name: string; categories: string[] }>;
  /** Remaining project IDs to browse for pages (MantisHub only). */
  _pagesProjectIds?: number[];
  /** Current browse page within the current project's pages. */
  _pagesBrowsePage?: number;
  /** Issue IDs to fetch during incremental sync (populated by lightweight scan). */
  _incrementalIds?: number[];
  /**
   * Issue IDs from the previous run's failure journal that should be retried
   * before resuming normal pagination. Drained as fetches succeed/fail.
   */
  _retryIds?: number[];
}

/**
 * Page size for both full-sync list calls and the incremental fetch batches.
 * Detail fetches dominate wall time (one HTTP call per issue), so smaller
 * pages give more frequent cursor checkpoints and progress updates without
 * meaningfully changing total work. The scan-only endpoint stays at 100
 * because its payload is tiny (id + updated_at) and not RTT-bound per row.
 */
const PAGE_SIZE = 25;
const SCAN_PAGE_SIZE = 100;
const PAGE_DELAY_MS = 100;
const SCAN_PAGE_DELAY_MS = 20;

/**
 * Number of per-issue detail fetches in flight at once. The list endpoint
 * is throttled by PAGE_DELAY_MS between pages, but the individual issue
 * fetches inside a page are RTT-bound — going from serial to 5-way
 * concurrent cuts a 25-issue batch from ~25 sequential RTTs to ~5 rounds
 * without overloading the server.
 */
const ISSUE_FETCH_CONCURRENCY = 5;

/**
 * Map `items` to results in input order, running at most `concurrency`
 * promises in flight at any time. Results from `fn` are placed at the
 * same index as their input. Errors are caught by `fn`'s try/catch in
 * the call sites — this helper does not handle rejections.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

function parseTimestamp(value: string | undefined): number | null {
  if (!value) return null;
  const ts = new Date(value).getTime();
  return Number.isNaN(ts) ? null : ts;
}

function maxTimestamp(a: string | undefined, b: string | undefined): string | undefined {
  const aTs = parseTimestamp(a);
  const bTs = parseTimestamp(b);
  if (aTs === null) return b;
  if (bTs === null) return a;
  return bTs > aTs ? b : a;
}

function padId(id: number): string {
  return String(id).padStart(5, "0");
}

/** Asset filename: <id>-<original-filename> */
function assetFilename(id: number, filename: string): string {
  return `${id}-${filename}`;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function requiredString(value: unknown, entityType: string, id: string | number, field: string): string {
  if (typeof value === "string" && value.trim()) return value;
  throw new Error(`Invalid ${entityType} entity id=${id}: missing required field "${field}"`);
}

/** Detect MantisHub instances by URL pattern. */
function isMantisHub(baseUrl: string): boolean {
  return baseUrl.includes(".mantishub.");
}

/** Attachment download URL info resolved from the API. */
interface AttachmentUrlInfo {
  url?: string;
  signedUrl?: string;
}

export class MantisHubCrawler implements Crawler {
  metadata: CrawlerMetadata = {
    type: "mantishub",
    displayName: "MantisHub Issue Tracker",
    description:
      "Crawls a MantisHub instance via its REST API, syncing issues from newest to oldest",
    version: "3.2",
    configSchema: {
      url: {
        type: "string",
        required: true,
        description: "Base URL of the MantisHub instance (e.g. https://mantishub.org/bugs)",
      },
      project: {
        type: "object",
        required: false,
        description: "Optional project to filter (object with id and name)",
      },
      maxEntities: {
        type: "number",
        required: false,
        description: "Maximum number of issues to sync (for testing)",
      },
    },
    credentialFields: ["token"],
  };

  private baseUrl = "";
  private token = "";
  private projectId?: number;
  private maxEntities?: number;
  private mantisHubMode = false;
  private syncEntities?: MantisHubEntityType[];
  private fetchFn: typeof fetch = globalThis.fetch;
  private assetFilter: AssetFilter | null = null;
  private progressCallback: ((msg: string) => void) | null = null;

  setAssetFilter(filter: AssetFilter): void {
    this.assetFilter = filter;
  }

  setProgressCallback(callback: (msg: string) => void): void {
    this.progressCallback = callback;
  }

  private retryExternalIds: Set<string> | null = null;
  private retriesInitialized = false;

  setRetryExternalIds(ids: Set<string>): void {
    this.retryExternalIds = ids;
    this.retriesInitialized = false;
  }

  private issueExternalId(id: number): string {
    return `issue:${id}`;
  }

  private reportProgress(msg: string): void {
    this.progressCallback?.(msg);
  }

  /** Returns true if the attachment should be downloaded based on extension and size. */
  private shouldDownloadAttachment(filename: string, sizeBytes: number): boolean {
    if (!this.assetFilter) return true;
    if (sizeBytes > this.assetFilter.maxSizeBytes) return false;
    // Empty extension set means no filter — allow all types.
    if (this.assetFilter.allowedExtensions.size === 0) return true;
    const dot = filename.lastIndexOf(".");
    const ext = dot === -1 ? "" : filename.slice(dot).toLowerCase();
    return this.assetFilter.allowedExtensions.has(ext);
  }

  /** Accept both new field names and legacy field names for backward compat. */
  private static resolveConfig(config: Record<string, unknown>): MantisHubConfig {
    const url = (config.url ?? config.baseUrl) as string;
    const project = config.project as { id?: number; name?: string } | undefined;
    const projectId = project?.id ?? (config.projectId as number | undefined);
    const projectName = project?.name ?? (config.projectName as string | undefined);
    return {
      url,
      project: projectId || projectName ? { id: projectId, name: projectName } : undefined,
      maxEntities: config.maxEntities as number | undefined,
      entities: (config.entities ?? config.syncEntities) as MantisHubEntityType[] | undefined,
    };
  }

  // Accumulated during the issues phase; emitted in the users phase.
  private collectedUsers = new Map<number, { id: number; name: string; email?: string }>();
  private collectedProjects = new Map<number, { id: number; name: string; categories: string[] }>();

  async initialize(
    config: Record<string, unknown>,
    credentials: Record<string, unknown>,
  ): Promise<void> {
    const cfg = MantisHubCrawler.resolveConfig(config);
    const creds = credentials as unknown as MantisHubCredentials;
    this.baseUrl = cfg.url.replace(/\/+$/, "");
    this.token = creds.token ?? "";
    this.maxEntities = cfg.maxEntities;
    this.mantisHubMode = isMantisHub(this.baseUrl);
    this.syncEntities = cfg.entities;

    // Log credential diagnostics (safe — no secret values) so misloaded tokens
    // can be identified by fingerprint in the error message.
    const credKeys = Object.keys(credentials);
    const tokenFingerprint = this.token
      ? `${this.token.slice(0, 4)}…(${this.token.length} chars)`
      : "<none>";
    console.log(
      `[mantishub] initialized baseUrl=${this.baseUrl} credentialKeys=[${credKeys.join(",")}] token=${tokenFingerprint}`,
    );

    // Use stored project.id if available (persisted at creation time);
    // otherwise resolve project.name to project.id via API.
    if (cfg.project?.id) {
      this.projectId = cfg.project.id;
    } else if (cfg.project?.name) {
      this.projectId = await this.resolveProjectId(cfg.project.name);
    }
  }

  /**
   * Resolve a project name to its ID and return both.
   * Public so that callers (CLI, TUI, management API) can persist both
   * values at collection creation time.
   */
  async resolveProjectName(projectName: string): Promise<{ id: number; name: string }> {
    const projects = await this.fetchProjects();
    const allProjects = this.flattenProjects(projects);
    const match = allProjects.find(
      (p) => p.name.toLowerCase() === projectName.toLowerCase(),
    );
    if (!match) {
      const available = allProjects.map((p) => p.name).join(", ");
      throw new Error(
        `Project "${projectName}" not found. Available projects: ${available}`,
      );
    }
    return { id: match.id, name: match.name };
  }

  async sync(cursor: SyncCursor | null): Promise<SyncResult> {
    const c = (cursor as MantisHubSyncCursor) ?? {};

    // Initial-sync snapshot ceiling: when this is the very first sync (no
    // prior cursor at all), pin the dataset to a single point in time. The
    // issue list endpoint is paginated DESC by updated_at — without a
    // ceiling, new updates that arrive mid-sync shift every later page by
    // one slot, so the saved cursor on resume points at the wrong content.
    // The ceiling makes pagination idempotent for the duration of the
    // initial sync. Subsequent incremental syncs don't need it (they use
    // `updatedSince` instead) and won't set it.
    if (cursor === null && !c.updatedSince) {
      c.snapshotCeiling = new Date().toISOString().replace("T", " ").replace(/\..+$/, "");
    }

    // Drain pending retries from the journal before normal pagination, so
    // a flood of new activity doesn't starve previously-failed entities.
    // Done on the first sync() call of the run regardless of whether this is
    // an initial or incremental run.
    if (!this.retriesInitialized) {
      this.retriesInitialized = true;
      if (this.retryExternalIds && this.retryExternalIds.size > 0) {
        const retryIds = Array.from(this.retryExternalIds)
          .map((id) => id.startsWith("issue:") ? id.slice("issue:".length) : id)
          .map((id) => Number(id))
          .filter((n) => Number.isFinite(n));
        if (retryIds.length > 0) {
          c._retryIds = retryIds;
        }
      }
    }
    if (c._retryIds && c._retryIds.length > 0) {
      return this.fetchRetryBatch(c);
    }

    // Restore accumulated user/project data from cursor (survives across pages).
    if (cursor === null) {
      this.collectedUsers.clear();
      this.collectedProjects.clear();
    } else if (c._users || c._projects) {
      this.collectedUsers = new Map(
        Object.entries(c._users ?? {}).map(([k, v]) => [Number(k), v]),
      );
      this.collectedProjects = new Map(
        Object.entries(c._projects ?? {}).map(([k, v]) => [Number(k), v]),
      );
    }

    // Pages phase (MantisHub only): sync wiki pages between issues and users.
    if (c.phase === "pages") {
      return this.syncPages(c);
    }

    // Users + projects phase: emit after all issues (and pages) are processed.
    if (c.phase === "users") {
      return this.syncUsersAndProjects(c);
    }

    // If issues sync is disabled, skip directly to the next applicable phase.
    if (!this.shouldSync("issues") && !c.phase) {
      return { entities: [], ...this.transitionFromIssues(c.updatedSince) };
    }

    // ── Issues phase ─────────────────────────────────────────────

    // Incremental sync: use lightweight scan + targeted fetch approach.
    // 1. Scan all issues with select=id,updated_at (100/page, tiny payloads)
    // 2. Collect IDs where updated_at >= updatedSince
    // 3. Fetch only those issues individually for full data
    if (c.updatedSince && !c._incrementalIds) {
      return this.scanForIncrementalIds(c);
    }
    if (c._incrementalIds) {
      return this.fetchIncrementalBatch(c);
    }

    // Full sync: paginate through all issues.
    const isLegacyPageCursor =
      c.page !== undefined &&
      c.updatedSince === undefined &&
      c.newestSeenUpdatedAt === undefined &&
      c.lastPageSignature === undefined;
    const page = isLegacyPageCursor ? 1 : (c.page ?? 1);
    const fetched = isLegacyPageCursor ? 0 : (c.fetched ?? 0);

    // Throttle requests: sleep between pages to avoid overloading the server
    if (page > 1) {
      await new Promise((resolve) => setTimeout(resolve, PAGE_DELAY_MS));
    }

    this.reportProgress(`Fetching issues page ${page}`);
    // Use select=id,updated_at — the list call only needs IDs to drive the
    // detail fetches and updated_at for pagination/snapshot bookkeeping.
    // Skipping the full payload here saves bandwidth on every page; the per
    // -issue detail fetch returns the full record anyway.
    let url = `${this.baseUrl}/api/rest/issues?select=id,updated_at&page_size=${PAGE_SIZE}&page=${page}`;
    if (this.projectId) {
      url += `&project_id=${this.projectId}`;
    }
    // Pin the dataset to the snapshot ceiling so concurrent updates after
    // sync started don't shift later pages. MantisBT supports `filter_updated_before`.
    if (c.snapshotCeiling) {
      url += `&filter_updated_before=${encodeURIComponent(c.snapshotCeiling)}`;
    }

    const response = await this.apiFetch(url);
    const data = (await response.json()) as { issues: Array<{ id: number; updated_at: string }> };
    let issues = data.issues ?? [];

    // Belt-and-suspenders: if the server doesn't honor filter_updated_before,
    // drop items above the ceiling client-side. With DESC ordering, items
    // newer than the ceiling appear at the front of the page.
    if (c.snapshotCeiling) {
      const ceilingTs = parseTimestamp(c.snapshotCeiling);
      if (ceilingTs !== null) {
        issues = issues.filter((i) => {
          const ts = parseTimestamp(i.updated_at);
          return ts === null || ts <= ceilingTs;
        });
      }
    }

    issues.sort(
      (a, b) =>
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    );

    const pageSignature = issues.map((i) => `${i.id}:${i.updated_at}`).join("|");
    const repeatedPageCount = pageSignature && c.lastPageSignature === pageSignature
      ? (c.repeatedPageCount ?? 0) + 1
      : 0;

    let newestSeenUpdatedAt = c.newestSeenUpdatedAt;
    for (const issue of issues) {
      newestSeenUpdatedAt = maxTimestamp(newestSeenUpdatedAt, issue.updated_at);
    }

    let issuesToProcess = issues;
    let remaining = issuesToProcess.length;
    if (this.maxEntities) {
      remaining = Math.max(0, this.maxEntities - fetched);
      if (remaining <= 0) {
        const finalUpdatedSince = maxTimestamp(c.updatedSince, newestSeenUpdatedAt);
        return {
          entities: [],
          nextCursor: finalUpdatedSince ? { updatedSince: finalUpdatedSince } : null,
          hasMore: false,
          deletedExternalIds: [],
        };
      }
      issuesToProcess = issuesToProcess.slice(0, remaining);
    }

    const apiHasMore = issues.length === PAGE_SIZE;
    const reachedMax = this.maxEntities ? (fetched + issuesToProcess.length) >= this.maxEntities : false;
    const issuesHaveMore = apiHasMore && !reachedMax;
    const finalUpdatedSince = maxTimestamp(c.updatedSince, newestSeenUpdatedAt);

    if (page > 1 && repeatedPageCount > 0) {
      return {
        entities: [],
        ...this.transitionFromIssues(finalUpdatedSince),
      };
    }

    // The list call uses select=id,updated_at, so the slim payload doesn't
    // carry user/project/category/notes data. Collection happens in the
    // detail-fetch loop below where the full issue payload is available.

    // Fetch full issue data individually. The list endpoint is tiny now
    // (id+updated_at only); the per-issue calls return the full record
    // including attachments and notes. Run up to ISSUE_FETCH_CONCURRENCY in
    // parallel to hide RTT. Per-issue failures are reported via
    // failedEntities so one bad issue doesn't abort the run; auth/list
    // failures still surface above.
    type IssueOutcome =
      | { kind: "ok"; entity: CrawlerEntityData }
      | { kind: "fail"; failure: FailedEntity };
    const outcomes = await mapWithConcurrency<typeof issuesToProcess[number], IssueOutcome>(
      issuesToProcess,
      ISSUE_FETCH_CONCURRENCY,
      async (issue) => {
        try {
          const fullIssue = await this.fetchIssue(issue.id);
          this.collectUsersAndProjects(fullIssue);
          return { kind: "ok", entity: await this.buildIssueEntity(fullIssue) };
        } catch (err) {
          return {
            kind: "fail",
            failure: {
              externalId: this.issueExternalId(issue.id),
              entityType: "issue",
              error: err instanceof Error ? err.message : String(err),
            },
          };
        }
      },
    );
    const entities: CrawlerEntityData[] = [];
    const failedEntities: FailedEntity[] = [];
    for (const o of outcomes) {
      if (o.kind === "ok") entities.push(o.entity);
      else failedEntities.push(o.failure);
    }

    const newFetched = fetched + issuesToProcess.length;
    const serializedCollected = {
      _users: Object.fromEntries(this.collectedUsers),
      _projects: Object.fromEntries(this.collectedProjects),
    };

    if (issuesHaveMore) {
      return {
        entities,
        failedEntities,
        nextCursor: {
          page: page + 1,
          fetched: newFetched,
          newestSeenUpdatedAt,
          lastPageSignature: pageSignature,
          repeatedPageCount,
          snapshotCeiling: c.snapshotCeiling,
          ...serializedCollected,
        },
        hasMore: true,
        deletedExternalIds: [],
      };
    }

    // Issues exhausted — transition to pages phase (MantisHub) or users+projects phase.
    const transition = this.transitionFromIssues(finalUpdatedSince);
    return {
      entities,
      failedEntities,
      ...transition,
    };
  }

  /**
   * Lightweight scan: fetch all issues using select=id,updated_at with large
   * page size to quickly identify which issues need syncing. Stores matching
   * IDs in the cursor for the fetch phase. Servers that don't support select=
   * return the full issue payload — still correct, just less efficient.
   */
  private async scanForIncrementalIds(c: MantisHubSyncCursor): Promise<SyncResult> {
    const updatedSinceTs = parseTimestamp(c.updatedSince)!;
    const ids: number[] = [];
    let newestSeenUpdatedAt = c.newestSeenUpdatedAt;
    let page = 1;

    this.reportProgress(`Scanning issues updated since ${c.updatedSince}`);
    while (true) {
      if (page > 1) {
        await new Promise((resolve) => setTimeout(resolve, SCAN_PAGE_DELAY_MS));
      }

      this.reportProgress(`Scanning issues: page ${page}`);
      let url = `${this.baseUrl}/api/rest/issues?select=id,updated_at&page_size=${SCAN_PAGE_SIZE}&page=${page}`;
      if (this.projectId) url += `&project_id=${this.projectId}`;

      const response = await this.apiFetch(url);
      const data = (await response.json()) as { issues: Array<{ id: number; updated_at: string }> };
      const issues = data.issues ?? [];

      let pageMatchCount = 0;
      for (const issue of issues) {
        newestSeenUpdatedAt = maxTimestamp(newestSeenUpdatedAt, issue.updated_at);
        const ts = parseTimestamp(issue.updated_at);
        if (ts !== null && ts >= updatedSinceTs) {
          ids.push(issue.id);
          pageMatchCount++;
        }
      }

      // Partial page → we've reached the end of the dataset
      if (issues.length < SCAN_PAGE_SIZE) break;
      // MantisBT returns issues sorted by last_updated DESC. Once a full page
      // has zero matches, every subsequent page will also be older than
      // updatedSince — safe to stop scanning.
      if (pageMatchCount === 0 && issues.length > 0) break;

      page++;
    }
    this.reportProgress(`Scan complete: ${ids.length} updated issues found across ${page} page(s)`);

    if (ids.length === 0) {
      // No issues need syncing — transition directly
      const finalUpdatedSince = maxTimestamp(c.updatedSince, newestSeenUpdatedAt);
      return {
        entities: [],
        ...this.transitionFromIssues(finalUpdatedSince),
      };
    }

    // Apply maxEntities limit
    let idsToFetch = ids;
    if (this.maxEntities && ids.length > this.maxEntities) {
      idsToFetch = ids.slice(0, this.maxEntities);
    }

    // Store IDs in cursor for the fetch phase
    return {
      entities: [],
      nextCursor: {
        updatedSince: c.updatedSince,
        newestSeenUpdatedAt,
        _incrementalIds: idsToFetch,
        _users: Object.fromEntries(this.collectedUsers),
        _projects: Object.fromEntries(this.collectedProjects),
      },
      hasMore: true,
      deletedExternalIds: [],
    };
  }

  /**
   * Fetch phase of incremental sync: fetch full issue data for IDs
   * identified during the scan phase, in batches of PAGE_SIZE.
   */
  private async fetchIncrementalBatch(c: MantisHubSyncCursor): Promise<SyncResult> {
    const ids = c._incrementalIds ?? [];
    const batch = ids.slice(0, PAGE_SIZE);
    const remaining = ids.slice(PAGE_SIZE);

    this.reportProgress(`Fetching ${batch.length} issue(s), ${remaining.length} more queued`);
    const outcomes = await mapWithConcurrency(batch, ISSUE_FETCH_CONCURRENCY, async (id) => {
      try {
        const fullIssue = await this.fetchIssue(id);
        this.collectUsersAndProjects(fullIssue);
        return { kind: "ok" as const, entity: await this.buildIssueEntity(fullIssue) };
      } catch (err) {
        return {
          kind: "fail" as const,
          failure: {
            externalId: this.issueExternalId(id),
            entityType: "issue",
            error: err instanceof Error ? err.message : String(err),
          },
        };
      }
    });
    const entities: CrawlerEntityData[] = [];
    const failedEntities: FailedEntity[] = [];
    for (const o of outcomes) {
      if (o.kind === "ok") entities.push(o.entity);
      else failedEntities.push(o.failure);
    }

    const serializedCollected = {
      _users: Object.fromEntries(this.collectedUsers),
      _projects: Object.fromEntries(this.collectedProjects),
    };

    if (remaining.length > 0) {
      return {
        entities,
        failedEntities,
        nextCursor: {
          updatedSince: c.updatedSince,
          newestSeenUpdatedAt: c.newestSeenUpdatedAt,
          _incrementalIds: remaining,
          ...serializedCollected,
        },
        hasMore: true,
        deletedExternalIds: [],
      };
    }

    // All IDs fetched — transition to next phase
    const finalUpdatedSince = maxTimestamp(c.updatedSince, c.newestSeenUpdatedAt);
    return {
      entities,
      failedEntities,
      ...this.transitionFromIssues(finalUpdatedSince),
    };
  }

  /**
   * Drain the retry queue passed in via setRetryExternalIds(). Runs first
   * (before normal pagination) so a continuous stream of new activity doesn't
   * starve previously-failed entities. Per-issue failures are journaled
   * again with an incremented attempt counter; successes are removed from
   * the journal by the SyncEngine.
   */
  private async fetchRetryBatch(c: MantisHubSyncCursor): Promise<SyncResult> {
    const ids = c._retryIds ?? [];
    const batch = ids.slice(0, PAGE_SIZE);
    const remaining = ids.slice(PAGE_SIZE);

    this.reportProgress(`Retrying ${batch.length} previously-failed issue(s), ${remaining.length} more queued`);
    const retryOutcomes = await mapWithConcurrency(batch, ISSUE_FETCH_CONCURRENCY, async (id) => {
      try {
        const fullIssue = await this.fetchIssue(id);
        this.collectUsersAndProjects(fullIssue);
        return { kind: "ok" as const, entity: await this.buildIssueEntity(fullIssue) };
      } catch (err) {
        return {
          kind: "fail" as const,
          failure: {
            externalId: this.issueExternalId(id),
            entityType: "issue",
            error: err instanceof Error ? err.message : String(err),
          },
        };
      }
    });
    const entities: CrawlerEntityData[] = [];
    const failedEntities: FailedEntity[] = [];
    for (const o of retryOutcomes) {
      if (o.kind === "ok") entities.push(o.entity);
      else failedEntities.push(o.failure);
    }

    // After the retry queue is drained, fall back to whatever the cursor
    // would otherwise drive (initial-page pagination, incremental scan, etc.)
    // by clearing _retryIds and passing through the rest of the cursor.
    const nextCursor: MantisHubSyncCursor = {
      ...c,
      _retryIds: remaining.length > 0 ? remaining : undefined,
    };
    return {
      entities,
      failedEntities,
      nextCursor,
      hasMore: true,
      deletedExternalIds: [],
    };
  }

  private async syncUsersAndProjects(c: MantisHubSyncCursor): Promise<SyncResult> {
    const entities: CrawlerEntityData[] = [];

    // Fetch full user profiles; fall back to basic data on error.
    if (this.shouldSync("users")) {
      const users = Array.from(this.collectedUsers.values()).filter((u) => u.name);
      if (users.length > 0) {
        this.reportProgress(`Fetching ${users.length} user profile(s)`);
      }
      // MantisHub commonly denies access to other users' profiles (the
      // signed-in account often only has visibility into its own user record).
      // Once we've seen enough failures we stop trying to fetch user profiles
      // entirely and emit shell entities (id + name + email collected from
      // issues) for the rest. User fetch failures are NEVER added to the
      // sync_errors journal — there's no value in retrying a profile the
      // current credentials cannot see.
      const MAX_USER_FETCH_FAILURES = 10;
      let i = 0;
      let userFailureCount = 0;
      let abortUserFetch = false;
      for (const basic of users) {
        i++;
        if (abortUserFetch) {
          entities.push(this.buildUserEntity({ id: basic.id, name: basic.name, email: basic.email }));
          continue;
        }
        this.reportProgress(`Fetching user ${basic.name} (${i}/${users.length})`);
        try {
          const profile = await this.fetchUser(basic.id);
          entities.push(this.buildUserEntity(profile));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          userFailureCount++;
          console.warn(`  Warning: entity type=user id=${basic.id} name=${basic.name}: ${message}`);
          if (userFailureCount >= MAX_USER_FETCH_FAILURES) {
            console.warn(`  Warning: ${MAX_USER_FETCH_FAILURES} user fetch failures — stopping user sync. Creating shell entries for remaining ${users.length - i} user(s) from data collected during issue sync.`);
            abortUserFetch = true;
          }
          // Build a minimal user entity from data collected during issue sync.
          entities.push(this.buildUserEntity({
            id: basic.id,
            name: basic.name,
            email: basic.email,
          }));
        }
      }
    }

    // Emit project entities (data already collected from issues).
    if (this.collectedProjects.size > 0) {
      this.reportProgress(`Building ${this.collectedProjects.size} project entit${this.collectedProjects.size === 1 ? "y" : "ies"}`);
    }
    for (const project of this.collectedProjects.values()) {
      entities.push(this.buildProjectEntity(project));
    }

    const finalCursor = c.updatedSince ? { updatedSince: c.updatedSince } : null;
    return {
      entities,
      nextCursor: finalCursor,
      hasMore: false,
      deletedExternalIds: [],
    };
  }

  async validateCredentials(
    credentials: Record<string, unknown>,
  ): Promise<boolean> {
    try {
      const token = (credentials.token as string) ?? "";
      const baseUrl = ((credentials.url as string) ?? (credentials.baseUrl as string) ?? this.baseUrl).replace(/\/+$/, "");
      if (!baseUrl) return false;

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (token) {
        headers["Authorization"] = token;
      }

      const response = await this.fetchFn(
        `${baseUrl}/api/rest/issues?page_size=1&page=1`,
        { headers },
      );

      if (response.ok) return true;
      if (!token && response.status === 401) return true;

      return false;
    } catch {
      return false;
    }
  }

  async dispose(): Promise<void> {}

  /** Whether a given entity type should be synced based on the syncEntities config. */
  private shouldSync(type: MantisHubEntityType): boolean {
    if (!this.syncEntities) return true; // default: sync everything applicable
    return this.syncEntities.includes(type);
  }

  setFetch(fn: typeof fetch): void {
    this.fetchFn = fn;
  }

  private async apiFetch(url: string): Promise<Response> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.token) {
      headers["Authorization"] = this.token;
    }

    const MAX_RETRIES = 3;
    let lastNetworkErr: unknown;
    let response: Response | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** (attempt - 1), 8000)));
      }
      try {
        response = await this.fetchFn(url, { headers });
      } catch (err) {
        lastNetworkErr = err;
        continue;
      }
      // Retry transient server errors, but not auth/client errors
      if (response.status >= 500 && response.status < 600 && attempt < MAX_RETRIES) {
        try { await response.body?.cancel(); } catch { /* ignore */ }
        lastNetworkErr = new Error(`HTTP ${response.status}`);
        response = undefined;
        continue;
      }
      break;
    }

    if (!response) {
      const message = lastNetworkErr instanceof Error ? lastNetworkErr.message : String(lastNetworkErr);
      throw new Error(`MantisHub API error: GET ${url} → network failure after ${MAX_RETRIES} retries: ${message}`);
    }

    if (!response.ok) {
      let bodySnippet = "";
      try {
        const text = await response.text();
        if (text.trim()) bodySnippet = ` — ${text.trim().slice(0, 300)}`;
      } catch { /* ignore body read errors */ }
      // Include a safe token fingerprint (length + first 4 chars) to help diagnose
      // credential misloading without leaking the full token.
      const tokenFingerprint = this.token
        ? `${this.token.slice(0, 4)}…(${this.token.length} chars)`
        : "<none>";
      let hint = "";
      if (response.status === 403) {
        hint = " (MantisBT 403: token is in the DB, but the user account is likely disabled or lacks view access. Check the user account status and project access level.)";
      } else if (response.status === 401) {
        hint = " (MantisBT 401: token is invalid/unknown, or missing. Verify the token in credentials.yml matches a valid API token.)";
      }
      throw new Error(
        `MantisHub API error: GET ${url} → ${response.status} ${response.statusText}${bodySnippet} [token=${tokenFingerprint}]${hint}`,
      );
    }
    return response;
  }

  private async fetchIssue(issueId: number): Promise<MantisHubIssue> {
    const url = `${this.baseUrl}/api/rest/issues/${issueId}`;
    const response = await this.apiFetch(url);
    const data = (await response.json()) as { issues: MantisHubIssue[] };
    return data.issues[0];
  }

  private async fetchUser(userId: number): Promise<MantisHubUser> {
    const url = `${this.baseUrl}/api/rest/users/${userId}`;
    const response = await this.apiFetch(url);
    return (await response.json()) as MantisHubUser;
  }

  private async fetchProjects(): Promise<MantisHubProject[]> {
    const url = `${this.baseUrl}/api/rest/projects`;
    const response = await this.apiFetch(url);
    const data = (await response.json()) as { projects: MantisHubProject[] };
    return data.projects ?? [];
  }

  private async resolveProjectId(projectName: string): Promise<number> {
    const resolved = await this.resolveProjectName(projectName);
    return resolved.id;
  }

  private flattenProjects(projects: MantisHubProject[]): MantisHubProject[] {
    const result: MantisHubProject[] = [];
    for (const p of projects) {
      result.push(p);
      if ((p as any).subProjects?.length) {
        result.push(...this.flattenProjects((p as any).subProjects));
      }
    }
    return result;
  }

  private buildUserEntity(user: MantisHubUser): CrawlerEntityData {
    const username = requiredString(user.name, "user", user.id, "name");
    const avatarUrl = user.avatar?.attr?.src ?? null;
    const displayName = user.real_name ? `${user.real_name} (@${username})` : username;
    return {
      externalId: `user:${username}`,
      entityType: "user",
      title: displayName,
      url: `${this.baseUrl}/user_summary_page.php?username=${encodeURIComponent(username)}`,
      tags: ["user"],
      data: {
        id: user.id,
        name: username,
        realName: user.real_name ?? null,
        email: user.email ?? null,
        avatarUrl,
      },
    };
  }

  private buildProjectEntity(project: { id: number; name: string; categories: string[] }): CrawlerEntityData {
    const name = requiredString(project.name, "project", project.id, "name");
    return {
      externalId: `project:${project.id}`,
      entityType: "project",
      title: name,
      url: `${this.baseUrl}/set_project.php?project_id=${project.id}`,
      tags: ["project"],
      data: {
        id: project.id,
        name,
        categories: project.categories,
      },
    };
  }

  /**
   * Build the cursor/result for transitioning out of the issues phase.
   * Goes to pages (if MantisHub + pages enabled) or users, or finishes.
   */
  private transitionFromIssues(updatedSince: string | undefined): Pick<SyncResult, "nextCursor" | "hasMore" | "deletedExternalIds"> {
    const serialized = {
      _users: Object.fromEntries(this.collectedUsers),
      _projects: Object.fromEntries(this.collectedProjects),
    };

    if (this.mantisHubMode && this.shouldSync("pages")) {
      return {
        nextCursor: {
          phase: "pages" as const,
          updatedSince,
          ...serialized,
          _pagesProjectIds: this.getPageProjectIds(),
        },
        hasMore: true,
        deletedExternalIds: [],
      };
    }

    if (this.shouldSync("users")) {
      return {
        nextCursor: { phase: "users" as const, updatedSince, ...serialized },
        hasMore: true,
        deletedExternalIds: [],
      };
    }

    // Neither pages nor users selected — we're done.
    return {
      nextCursor: updatedSince ? { updatedSince } : null,
      hasMore: false,
      deletedExternalIds: [],
    };
  }

  /**
   * Build the cursor/result for transitioning out of the pages phase.
   * Goes to users if enabled, otherwise finishes.
   */
  private transitionFromPages(c: MantisHubSyncCursor): Pick<SyncResult, "nextCursor" | "hasMore" | "deletedExternalIds"> {
    const serialized = {
      _users: Object.fromEntries(this.collectedUsers),
      _projects: c._projects ?? Object.fromEntries(this.collectedProjects),
    };

    if (this.shouldSync("users")) {
      return {
        nextCursor: { phase: "users" as const, updatedSince: c.updatedSince, ...serialized },
        hasMore: true,
        deletedExternalIds: [],
      };
    }

    return {
      nextCursor: c.updatedSince ? { updatedSince: c.updatedSince } : null,
      hasMore: false,
      deletedExternalIds: [],
    };
  }

  /** Compute the assets directory prefix for an entity type and project. */
  private assetDir(entityType: string, projectName?: string): string {
    // Always nest under the project so assets sit alongside the markdown that
    // references them via `assets/<filename>` (e.g. content/<project-slug>/issues/assets/).
    const projectSlug = slugify(projectName ?? "unknown") || "unknown";
    return `content/${projectSlug}/${entityType}/assets`;
  }

  /** Get project IDs to browse for pages. Uses configured project or all collected projects. */
  private getPageProjectIds(): number[] {
    if (this.projectId) return [this.projectId];
    return [...this.collectedProjects.keys()];
  }

  /**
   * Pages phase: browse and fetch wiki pages from MantisHub instances.
   * Processes one project per sync call to avoid timeouts.
   */
  private async syncPages(c: MantisHubSyncCursor): Promise<SyncResult> {
    const projectIds = c._pagesProjectIds ?? [];
    if (projectIds.length === 0) {
      // No projects left — transition to users phase or finish.
      return { entities: [], ...this.transitionFromPages(c) };
    }

    const currentProjectId = projectIds[0];
    const remainingProjectIds = projectIds.slice(1);
    const entities: CrawlerEntityData[] = [];

    try {
      // Browse all pages for this project (with pagination).
      const browsePage = c._pagesBrowsePage ?? 1;
      this.reportProgress(`Fetching wiki pages for project ${currentProjectId} (page ${browsePage})`);
      const browseResult = await this.browsePages(currentProjectId, browsePage);

      // Fetch full details for each page and build entities.
      for (const pageSummary of browseResult.pages) {
        try {
          const { page, files } = await this.fetchPage(currentProjectId, pageSummary.name);
          entities.push(await this.buildPageEntity(page, files));

          // Collect users from page metadata.
          this.collectUsersFromPage(page);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.warn(`  Warning: entity type=page id=${pageSummary.name} project_id=${currentProjectId}: ${message}`);
        }
      }

      // If there are more browse pages, continue with this project.
      if (browseResult.hasMore) {
        return {
          entities,
          nextCursor: {
            phase: "pages",
            updatedSince: c.updatedSince,
            _users: Object.fromEntries(this.collectedUsers),
            _projects: c._projects,
            _pagesProjectIds: projectIds,
            _pagesBrowsePage: browsePage + 1,
          },
          hasMore: true,
          deletedExternalIds: [],
        };
      }
    } catch (err) {
      // Pages plugin not available or project has no pages — skip gracefully.
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`  Warning: entity type=page project_id=${currentProjectId} (browse): ${message}`);
    }

    // Move to the next project (or users phase if no more projects).
    const serialized = {
      _users: Object.fromEntries(this.collectedUsers),
      _projects: c._projects,
    };

    if (remainingProjectIds.length > 0) {
      return {
        entities,
        nextCursor: {
          phase: "pages",
          updatedSince: c.updatedSince,
          ...serialized,
          _pagesProjectIds: remainingProjectIds,
        },
        hasMore: true,
        deletedExternalIds: [],
      };
    }

    // All projects processed — transition to users phase or finish.
    return { entities, ...this.transitionFromPages(c) };
  }

  /** Browse pages for a project via the ApiX browse endpoint. */
  private async browsePages(
    projectId: number,
    page: number,
  ): Promise<{ pages: Array<{ id: number; name: string; title: string }>; hasMore: boolean }> {
    const limit = 50;
    const url = `${this.baseUrl}/api/rest/plugins/ApiX/projects/${projectId}/pages/pages/browse?limit=${limit}&page=${page}`;
    const response = await this.apiFetch(url);
    const data = (await response.json()) as {
      pages: Array<{ id: number; name: string; title: string }>;
      total_count: number;
    };
    const pages = data.pages ?? [];
    const totalCount = data.total_count ?? pages.length;
    const hasMore = page * limit < totalCount;
    return { pages, hasMore };
  }

  /** Fetch a single page's full content and files via the ApiX update endpoint (raw markdown). */
  private async fetchPage(
    projectId: number,
    pageName: string,
  ): Promise<{ page: MantisHubPage; files: MantisHubPageFile[] }> {
    const url = `${this.baseUrl}/api/rest/plugins/ApiX/projects/${projectId}/pages/update/${encodeURIComponent(pageName)}`;
    const response = await this.apiFetch(url);
    const data = (await response.json()) as {
      page_view: {
        page: MantisHubPage;
        files: MantisHubPageFile[];
      };
    };
    return {
      page: data.page_view.page,
      files: data.page_view.files ?? [],
    };
  }

  /** Collect users from a page's created_by and updated_by fields. */
  private collectUsersFromPage(page: MantisHubPage): void {
    if (page.created_by?.name) {
      this.collectedUsers.set(page.created_by.id, {
        id: page.created_by.id,
        name: page.created_by.name,
        email: page.created_by.email,
      });
    }
    if (page.updated_by?.name) {
      this.collectedUsers.set(page.updated_by.id, {
        id: page.updated_by.id,
        name: page.updated_by.name,
        email: page.updated_by.email,
      });
    }
  }

  private async buildPageEntity(
    page: MantisHubPage,
    files: MantisHubPageFile[],
  ): Promise<CrawlerEntityData> {
    const pageName = requiredString(page.name, "page", page.id, "name");
    const hasher = createCryptoHasher("sha256");
    hasher.update(JSON.stringify({ page, files }));
    const contentHash = hasher.digest("hex");

    const tags: string[] = ["page"];
    if (page.project?.name) {
      tags.push(`project:${page.project.name}`);
    }

    // Download page file attachments.
    const entityAttachments: CrawlerEntityData["attachments"] = [];
    const savedPaths = new Set<string>();
    const assetPrefix = this.assetDir("pages", page.project?.name);

    for (const file of files) {
      const storedName = assetFilename(file.id, file.name);
      const storagePath = `${assetPrefix}/${storedName}`;

      if (!this.shouldDownloadAttachment(file.name, file.size)) continue;

      // The download_url from Pages is relative; make it absolute.
      let downloadUrl = file.download_url;
      if (downloadUrl && !downloadUrl.startsWith("http")) {
        downloadUrl = `${this.baseUrl}/${downloadUrl.replace(/^\//, "")}`;
      }

      const content = await this.downloadBinary(
        downloadUrl,
        `page "${page.name}" file "${file.name}"`,
      );

      if (content) {
        entityAttachments.push({
          filename: storedName,
          mimeType: file.content_type || "application/octet-stream",
          content,
          storagePath,
        });
        savedPaths.add(storagePath);
      }
    }

    const projectId = page.project?.id;
    const pageUrl = `${this.baseUrl}/plugin.php?page=Pages/view&project_id=${projectId}&name=${encodeURIComponent(pageName)}`;

    return {
      externalId: `page:${projectId}:${pageName}`,
      entityType: "page",
      title: page.title || pageName,
      contentHash,
      url: pageUrl,
      data: {
        id: page.id,
        name: pageName,
        title: page.title,
        content: page.content ?? "",
        project: page.project,
        issueId: page.issue_id,
        createdBy: page.created_by,
        updatedBy: page.updated_by,
        createdAt: page.created_at?.timestamp,
        updatedAt: page.updated_at?.timestamp,
        files: files.map((f) => {
          const sp = `${assetPrefix}/${assetFilename(f.id, f.name)}`;
          return {
            name: f.name,
            content_type: f.content_type,
            size: f.size,
            storagePath: savedPaths.has(sp) ? sp : undefined,
          };
        }),
      },
      tags,
      attachments: entityAttachments.length > 0 ? entityAttachments : undefined,
    };
  }

  /** Collect users and projects from an issue into the accumulation maps. */
  private collectUsersAndProjects(issue: MantisHubIssue): void {
    if (issue.reporter?.name) {
      this.collectedUsers.set(issue.reporter.id, {
        id: issue.reporter.id,
        name: issue.reporter.name,
        email: issue.reporter.email,
      });
    }
    if (issue.handler?.name) {
      this.collectedUsers.set(issue.handler.id, {
        id: issue.handler.id,
        name: issue.handler.name,
        email: issue.handler.email,
      });
    }
    for (const note of issue.notes ?? []) {
      if (note.reporter?.name) {
        this.collectedUsers.set(note.reporter.id, {
          id: note.reporter.id,
          name: note.reporter.name,
          email: note.reporter.email,
        });
      }
    }
    if (issue.project) {
      const existing = this.collectedProjects.get(issue.project.id);
      const categories = existing?.categories ?? [];
      if (issue.category?.name && !categories.includes(issue.category.name)) {
        categories.push(issue.category.name);
      }
      this.collectedProjects.set(issue.project.id, {
        id: issue.project.id,
        name: issue.project.name,
        categories,
      });
    }
  }

  // ── MantisHub ApiX fallback ──────────────────────────────────────
  //
  // MantisHub instances (detected by `.mantishub.` in the URL) expose the
  // ApiX plugin at /api/rest/plugins/ApiX/. When the core MantisHub REST
  // API fails to download an attachment (e.g. cloud-stored files that
  // require session auth), we fall back to the ApiX IssueViewPage endpoint
  // which provides pre-signed download URLs. The ApiX call is only made
  // if a core API download fails, and only once per issue (cached across
  // all attachments on that issue).

  /**
   * For MantisHub: fetch the IssueViewPage via the ApiX plugin to get
   * signed download URLs for all attachments (issue-level and note-level).
   * Returns a map of attachment_id → { url, signedUrl }.
   */
  private async fetchMantisHubAttachmentUrls(
    issueId: number,
  ): Promise<Map<number, AttachmentUrlInfo>> {
    const urlMap = new Map<number, AttachmentUrlInfo>();
    const url = `${this.baseUrl}/api/rest/plugins/ApiX/issues/${issueId}/pages/view`;
    try {
      const res = await this.apiFetch(url);
      const data = (await res.json()) as {
        issue?: {
          attachments?: Array<{ id: number; url?: string; signed_url?: string }>;
          notes?: Array<{
            attachments?: Array<{ id: number; url?: string; signed_url?: string }>;
          }>;
        };
      };

      // Issue-level attachments
      for (const att of data.issue?.attachments ?? []) {
        urlMap.set(att.id, { url: att.url, signedUrl: att.signed_url });
      }

      // Note-level attachments
      for (const note of data.issue?.notes ?? []) {
        for (const att of note.attachments ?? []) {
          urlMap.set(att.id, { url: att.url, signedUrl: att.signed_url });
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`  Warning: entity type=issue id=${issueId} (MantisHub attachment URLs): ${message}`);
    }
    return urlMap;
  }

  private async buildIssueEntity(issue: MantisHubIssue): Promise<CrawlerEntityData> {
    const summary = requiredString(issue.summary, "issue", issue.id, "summary");
    const hasher = createCryptoHasher("sha256");
    hasher.update(JSON.stringify(issue));
    const contentHash = hasher.digest("hex");

    const tags: string[] = [];
    tags.push(`status:${issue.status.name}`);
    tags.push(`priority:${issue.priority.name}`);
    tags.push(`severity:${issue.severity.name}`);
    if (issue.resolution?.name && issue.resolution.name !== "open") {
      tags.push(`resolution:${issue.resolution.name}`);
    }
    if (issue.category?.name) {
      tags.push(`category:${issue.category.name}`);
    }
    if (issue.tags) {
      for (const tag of issue.tags) {
        tags.push(tag.name);
      }
    }

    const relations: CrawlerEntityData["relations"] = [];
    if (issue.relationships) {
      for (const rel of issue.relationships) {
        relations.push({
          targetExternalId: `issue:${rel.issue.id}`,
          relationType: rel.type.name,
        });
      }
    }

    // Download attachments; track storage paths that were successfully saved.
    // On MantisHub instances, signed URLs (via ApiX IssueViewPage) are fetched
    // upfront and used as the primary download method — more efficient than the
    // MantisHub REST API which may not serve cloud-stored files. On plain MantisHub
    // the REST API is used directly.
    const entityAttachments: CrawlerEntityData["attachments"] = [];
    const savedPaths = new Set<string>();
    const assetPrefix = this.assetDir("issues", issue.project?.name);

    // For MantisHub: eagerly fetch all signed URLs once for this issue.
    const mantisHubUrls: Map<number, AttachmentUrlInfo> = this.mantisHubMode
      ? await this.fetchMantisHubAttachmentUrls(issue.id)
      : new Map();

    for (const file of issue.attachments ?? []) {
      const storedName = assetFilename(file.id, file.filename);
      const storagePath = `${assetPrefix}/${storedName}`;

      if (!this.shouldDownloadAttachment(file.filename, file.size)) continue;

      let content: Buffer | null = null;
      const label = `issue ${issue.id} file "${file.filename}"`;

      if (this.mantisHubMode) {
        // MantisHub: use signed URL first, fall back to REST API
        const urlInfo = mantisHubUrls.get(file.id);
        const signedUrl = urlInfo?.signedUrl ?? urlInfo?.url;
        if (signedUrl) {
          content = await this.downloadBinary(signedUrl, `${label} (MantisHub)`);
        }
        if (!content) {
          content = await this.downloadAttachment(issue.id, file.id, file.download_url, label);
        }
      } else {
        // Plain MantisBT: use download_url if provided, otherwise construct the
        // standard file_download.php URL (works on public trackers without auth).
        const effectiveUrl = file.download_url
          ?? `${this.baseUrl}/file_download.php?file_id=${file.id}&type=bug`;
        content = await this.downloadAttachment(issue.id, file.id, effectiveUrl, label);
      }

      if (content) {
        entityAttachments.push({
          filename: storedName,
          mimeType: file.content_type || "application/octet-stream",
          content,
          storagePath,
        });
        savedPaths.add(storagePath);
      }
    }

    for (const note of issue.notes ?? []) {
      for (const att of note.attachments ?? []) {
        const storedName = assetFilename(att.id, att.filename);
        const storagePath = `${assetPrefix}/${storedName}`;

        if (!this.shouldDownloadAttachment(att.filename, att.size)) continue;

        let content: Buffer | null = null;
        const label = `issue ${issue.id} note ${note.id} file "${att.filename}"`;

        if (this.mantisHubMode) {
          // MantisHub: use signed URL first, fall back to REST API
          const urlInfo = mantisHubUrls.get(att.id);
          const signedUrl = urlInfo?.signedUrl ?? urlInfo?.url;
          if (signedUrl) {
            content = await this.downloadBinary(signedUrl, `${label} (MantisHub)`);
          }
          if (!content) {
            content = await this.downloadAttachment(issue.id, att.id, att.download_url, label);
          }
        } else {
          // Plain MantisBT: use download_url if provided, otherwise construct the
          // standard file_download.php URL (works on public trackers without auth).
          const effectiveUrl = att.download_url
            ?? `${this.baseUrl}/file_download.php?file_id=${att.id}&type=bugnote`;
          content = await this.downloadAttachment(issue.id, att.id, effectiveUrl, label);
        }

        if (content) {
          entityAttachments.push({
            filename: storedName,
            mimeType: att.content_type || "application/octet-stream",
            content,
            storagePath,
          });
          savedPaths.add(storagePath);
        }
      }
    }

    return {
      externalId: `issue:${issue.id}`,
      entityType: "issue",
      title: `${padId(issue.id)}: ${summary}`,
      contentHash,
      url: `${this.baseUrl}/view.php?id=${issue.id}`,
      data: {
        id: issue.id,
        summary,
        description: issue.description ?? "",
        stepsToReproduce: issue.steps_to_reproduce ?? "",
        additionalInformation: issue.additional_information ?? "",
        project: issue.project,
        category: issue.category ?? null,
        reporter: issue.reporter ?? null,
        handler: issue.handler ?? null,
        status: issue.status,
        resolution: issue.resolution,
        priority: issue.priority,
        severity: issue.severity,
        reproducibility: issue.reproducibility ?? null,
        createdAt: issue.created_at,
        updatedAt: issue.updated_at,
        sticky: issue.sticky,
        attachments: (issue.attachments ?? []).map((f) => {
          const sp = `${assetPrefix}/${assetFilename(f.id, f.filename)}`;
          return {
            id: f.id,
            filename: f.filename,
            content_type: f.content_type,
            size: f.size,
            storagePath: savedPaths.has(sp) ? sp : undefined,
          };
        }),
        notes: (issue.notes ?? []).map((note) => ({
          ...note,
          attachments: (note.attachments ?? []).map((att) => {
            const sp = `${assetPrefix}/${assetFilename(att.id, att.filename)}`;
            return {
              ...att,
              storagePath: savedPaths.has(sp) ? sp : undefined,
            };
          }),
        })),
        relationships: issue.relationships ?? [],
        customFields: (issue.custom_fields ?? []).map((cf) => ({
          id: cf.field.id,
          name: cf.field.name,
          value: cf.value,
        })),
      },
      tags,
      attachments: entityAttachments.length > 0 ? entityAttachments : undefined,
      relations: relations.length > 0 ? relations : undefined,
    };
  }

  /**
   * Download an attachment via the core MantisHub REST API.
   *
   * Uses GET /api/rest/issues/{id}/files/{file_id} (operationId: IssueFileGet)
   * which returns JSON with base64-encoded content. Works for both issue-level
   * and note-level attachments per the MantisHub OpenAPI spec.
   *
   * If a download_url is available (e.g. from the issue response), tries that
   * first as a binary download, then falls back to the REST API endpoint.
   */
  private async downloadAttachment(
    issueId: number,
    fileId: number,
    downloadUrl: string | undefined,
    label: string,
  ): Promise<Buffer | null> {
    const headers: Record<string, string> = {};
    if (this.token) {
      headers["Authorization"] = this.token;
    }

    // Try download_url first if provided (binary response)
    if (downloadUrl) {
      try {
        const res = await this.fetchFn(downloadUrl, { headers });
        if (res.ok) {
          const arrayBuffer = await res.arrayBuffer();
          if (arrayBuffer.byteLength > 0) {
            return Buffer.from(arrayBuffer);
          }
        }
      } catch {
        // Fall through to REST API
      }
    }

    // Core MantisHub REST API (IssueFileGet - returns base64 JSON)
    const apiUrl = `${this.baseUrl}/api/rest/issues/${issueId}/files/${fileId}`;
    try {
      const res = await this.fetchFn(apiUrl, { headers });
      if (!res.ok) {
        console.warn(`  Warning: could not download attachment ${label} (${res.status} ${res.statusText})`);
        return null;
      }
      const json = (await res.json()) as { files?: Array<{ content?: string }> };
      const content = json.files?.[0]?.content;
      if (!content) {
        console.warn(`  Warning: no content in response for attachment ${label}`);
        return null;
      }
      return Buffer.from(content, "base64");
    } catch (err) {
      console.warn(`  Warning: could not download attachment ${label}: ${err}`);
      return null;
    }
  }

  /** Download a file as binary from a URL (used for MantisHub signed URLs). */
  private async downloadBinary(url: string, label: string): Promise<Buffer | null> {
    const headers: Record<string, string> = {};
    if (this.token) {
      headers["Authorization"] = this.token;
    }
    try {
      const res = await this.fetchFn(url, { headers });
      if (!res.ok) {
        console.warn(`  Warning: binary download failed for ${label} (${res.status} ${res.statusText})`);
        return null;
      }
      const arrayBuffer = await res.arrayBuffer();
      return arrayBuffer.byteLength > 0 ? Buffer.from(arrayBuffer) : null;
    } catch (err) {
      console.warn(`  Warning: binary download failed for ${label}: ${err}`);
      return null;
    }
  }
}
