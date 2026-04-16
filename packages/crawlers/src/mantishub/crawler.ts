import type {
  Crawler,
  CrawlerMetadata,
  CrawlerEntityData,
  SyncCursor,
  SyncResult,
  AssetFilter,
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
  /** User data accumulated across issue pages (serialized in cursor). */
  _users?: Record<number, { id: number; name: string; email?: string }>;
  /** Project data accumulated across issue pages (serialized in cursor). */
  _projects?: Record<number, { id: number; name: string; categories: string[] }>;
  /** Remaining project IDs to browse for pages (MantisHub only). */
  _pagesProjectIds?: number[];
  /** Current browse page within the current project's pages. */
  _pagesBrowsePage?: number;
}

const PAGE_SIZE = 25;
const PAGE_DELAY_MS = 100;

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

  setAssetFilter(filter: AssetFilter): void {
    this.assetFilter = filter;
  }

  /** Returns true if the attachment should be downloaded based on extension and size. */
  private shouldDownloadAttachment(filename: string, sizeBytes: number): boolean {
    if (!this.assetFilter) return true;
    const dot = filename.lastIndexOf(".");
    const ext = dot === -1 ? "" : filename.slice(dot).toLowerCase();
    return this.assetFilter.allowedExtensions.has(ext) && sizeBytes <= this.assetFilter.maxSizeBytes;
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
    const isLegacyPageCursor =
      c.page !== undefined &&
      c.updatedSince === undefined &&
      c.newestSeenUpdatedAt === undefined &&
      c.lastPageSignature === undefined;
    const page = isLegacyPageCursor ? 1 : (c.page ?? 1);
    const fetched = isLegacyPageCursor ? 0 : (c.fetched ?? 0);
    const updatedSinceTs = parseTimestamp(c.updatedSince);

    // Throttle requests: sleep between pages to avoid overloading the server
    if (page > 1) {
      await new Promise((resolve) => setTimeout(resolve, PAGE_DELAY_MS));
    }

    let url = `${this.baseUrl}/api/rest/issues?page_size=${PAGE_SIZE}&page=${page}`;
    if (this.projectId) {
      url += `&project_id=${this.projectId}`;
    }

    const response = await this.apiFetch(url);
    const data = (await response.json()) as { issues: MantisHubIssue[] };
    const issues = data.issues ?? [];

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
    if (updatedSinceTs !== null) {
      issuesToProcess = issues.filter((issue) => {
        const issueUpdatedAtTs = parseTimestamp(issue.updated_at);
        return issueUpdatedAtTs !== null && issueUpdatedAtTs >= updatedSinceTs;
      });
    }

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

    // Collect users + projects from ALL fetched issues (not just processed ones)
    // so we capture every user/project even in incremental syncs.
    for (const issue of issues) {
      this.collectUsersAndProjects(issue);
    }

    // Fetch full issue data individually — the list endpoint omits attachments
    // and note attachments. Sequential to avoid overwhelming the server.
    const entities: CrawlerEntityData[] = [];
    for (const issue of issuesToProcess) {
      let fullIssue: MantisHubIssue;
      try {
        fullIssue = await this.fetchIssue(issue.id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to sync entity type=issue id=${issue.id}: ${message}`);
      }
      entities.push(await this.buildIssueEntity(fullIssue));
    }

    const newFetched = fetched + issuesToProcess.length;
    const serializedCollected = {
      _users: Object.fromEntries(this.collectedUsers),
      _projects: Object.fromEntries(this.collectedProjects),
    };

    if (issuesHaveMore) {
      return {
        entities,
        nextCursor: {
          page: page + 1,
          fetched: newFetched,
          updatedSince: c.updatedSince,
          newestSeenUpdatedAt,
          lastPageSignature: pageSignature,
          repeatedPageCount,
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
      ...transition,
    };
  }

  private async syncUsersAndProjects(c: MantisHubSyncCursor): Promise<SyncResult> {
    const entities: CrawlerEntityData[] = [];

    // Fetch full user profiles; fall back to basic data on error.
    if (this.shouldSync("users")) {
      for (const basic of this.collectedUsers.values()) {
        if (!basic.name) continue; // Skip users without a name
        try {
          const profile = await this.fetchUser(basic.id);
          entities.push(this.buildUserEntity(profile));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.warn(`  Warning: entity type=user id=${basic.id} name=${basic.name}: ${message}`);
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

    const response = await this.fetchFn(url, { headers });
    if (!response.ok) {
      let bodySnippet = "";
      try {
        const text = await response.text();
        if (text.trim()) bodySnippet = ` — ${text.trim().slice(0, 300)}`;
      } catch { /* ignore body read errors */ }
      throw new Error(
        `MantisHub API error: GET ${url} → ${response.status} ${response.statusText}${bodySnippet}`,
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
    const avatarUrl = user.avatar?.attr?.src ?? null;
    const displayName = user.real_name ? `${user.real_name} (@${user.name})` : user.name;
    return {
      externalId: `user:${user.name}`,
      entityType: "user",
      title: displayName,
      url: `${this.baseUrl}/user_summary_page.php?username=${encodeURIComponent(user.name)}`,
      tags: ["user"],
      data: {
        id: user.id,
        name: user.name,
        realName: user.real_name ?? null,
        email: user.email ?? null,
        avatarUrl,
      },
    };
  }

  private buildProjectEntity(project: { id: number; name: string; categories: string[] }): CrawlerEntityData {
    return {
      externalId: `project:${project.id}`,
      entityType: "project",
      title: project.name,
      url: `${this.baseUrl}/set_project.php?project_id=${project.id}`,
      tags: ["project"],
      data: {
        id: project.id,
        name: project.name,
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
    if (this.projectId) {
      // Single project: content/<entity-type>/assets/
      return `content/${entityType}/assets`;
    }
    // Multi-project: content/<project-slug>/<entity-type>/assets/
    return `content/${slugify(projectName ?? "unknown")}/${entityType}/assets`;
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
    const pageName = page.name;
    const pageUrl = `${this.baseUrl}/plugin.php?page=Pages/view&project_id=${projectId}&name=${encodeURIComponent(pageName)}`;

    return {
      externalId: `page:${projectId}:${pageName}`,
      entityType: "page",
      title: page.title || page.name,
      contentHash,
      url: pageUrl,
      data: {
        id: page.id,
        name: page.name,
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
        content = await this.downloadAttachment(issue.id, file.id, file.download_url, label);
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
          content = await this.downloadAttachment(issue.id, att.id, att.download_url, label);
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
      title: `${padId(issue.id)}: ${issue.summary}`,
      contentHash,
      url: `${this.baseUrl}/view.php?id=${issue.id}`,
      data: {
        id: issue.id,
        summary: issue.summary,
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
