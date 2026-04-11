import type {
  Crawler,
  CrawlerMetadata,
  CrawlerEntityData,
  SyncCursor,
  SyncResult,
} from "@frozenink/core";
import { createCryptoHasher } from "@frozenink/core";
import type {
  MantisBTConfig,
  MantisBTCredentials,
  MantisBTIssue,
  MantisBTProject,
  MantisBTUser,
} from "./types";

interface MantisBTSyncCursor extends SyncCursor {
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
  phase?: "issues" | "users";
  /** User data accumulated across issue pages (serialized in cursor). */
  _users?: Record<number, { id: number; name: string; email?: string }>;
  /** Project data accumulated across issue pages (serialized in cursor). */
  _projects?: Record<number, { id: number; name: string; categories: string[] }>;
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

function attachmentFilename(issueId: number, filename: string): string {
  const hasher = createCryptoHasher("md5");
  hasher.update(filename);
  const hash = hasher.digest("hex").slice(0, 8);
  const dotIdx = filename.lastIndexOf(".");
  const ext = dotIdx !== -1 ? filename.slice(dotIdx) : "";
  return `${padId(issueId)}-${hash}${ext}`;
}

function noteAttachmentFilename(issueId: number, noteId: number, filename: string): string {
  const hasher = createCryptoHasher("md5");
  hasher.update(filename);
  const hash = hasher.digest("hex").slice(0, 8);
  const dotIdx = filename.lastIndexOf(".");
  const ext = dotIdx !== -1 ? filename.slice(dotIdx) : "";
  return `${padId(issueId)}-${padId(noteId)}-${hash}${ext}`;
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

export class MantisBTCrawler implements Crawler {
  metadata: CrawlerMetadata = {
    type: "mantisbt",
    displayName: "MantisBT Issue Tracker",
    description:
      "Crawls a MantisBT instance via its REST API, syncing issues from newest to oldest",
    configSchema: {
      baseUrl: {
        type: "string",
        required: true,
        description: "Base URL of the MantisBT instance (e.g. https://mantisbt.org/bugs)",
      },
      projectName: {
        type: "string",
        required: false,
        description: "Optional project name to filter issues (resolved to ID via API)",
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
  private fetchFn: typeof fetch = globalThis.fetch;

  // Accumulated during the issues phase; emitted in the users phase.
  private collectedUsers = new Map<number, { id: number; name: string; email?: string }>();
  private collectedProjects = new Map<number, { id: number; name: string; categories: string[] }>();

  async initialize(
    config: Record<string, unknown>,
    credentials: Record<string, unknown>,
  ): Promise<void> {
    const cfg = config as unknown as MantisBTConfig;
    const creds = credentials as unknown as MantisBTCredentials;
    this.baseUrl = cfg.baseUrl.replace(/\/+$/, "");
    this.token = creds.token ?? "";
    this.maxEntities = cfg.maxEntities;
    this.mantisHubMode = isMantisHub(this.baseUrl);

    // Use stored projectId if available (persisted at creation time);
    // otherwise resolve projectName to projectId via API.
    if (cfg.projectId) {
      this.projectId = cfg.projectId;
    } else if (cfg.projectName) {
      this.projectId = await this.resolveProjectId(cfg.projectName);
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
    const c = (cursor as MantisBTSyncCursor) ?? {};

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

    // Users + projects phase: emit after all issues are processed.
    if (c.phase === "users") {
      return this.syncUsersAndProjects(c);
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
    const data = (await response.json()) as { issues: MantisBTIssue[] };
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
        nextCursor: {
          phase: "users",
          updatedSince: finalUpdatedSince,
          _users: Object.fromEntries(this.collectedUsers),
          _projects: Object.fromEntries(this.collectedProjects),
        },
        hasMore: true,
        deletedExternalIds: [],
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
      const fullIssue = await this.fetchIssue(issue.id);
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

    // Issues exhausted — transition to users+projects phase.
    return {
      entities,
      nextCursor: { phase: "users", updatedSince: finalUpdatedSince, ...serializedCollected },
      hasMore: true,
      deletedExternalIds: [],
    };
  }

  private async syncUsersAndProjects(c: MantisBTSyncCursor): Promise<SyncResult> {
    const entities: CrawlerEntityData[] = [];

    // Fetch full user profiles; fall back to basic data on error.
    for (const basic of this.collectedUsers.values()) {
      if (!basic.name) continue; // Skip users without a name
      try {
        const profile = await this.fetchUser(basic.id);
        entities.push(this.buildUserEntity(profile));
      } catch {
        // Build a minimal user entity from data collected during issue sync.
        entities.push(this.buildUserEntity({
          id: basic.id,
          name: basic.name,
          email: basic.email,
        }));
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
      const baseUrl = ((credentials.baseUrl as string) ?? this.baseUrl).replace(/\/+$/, "");
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
      throw new Error(
        `MantisBT API request failed: ${response.status} ${response.statusText}`,
      );
    }
    return response;
  }

  private async fetchIssue(issueId: number): Promise<MantisBTIssue> {
    const url = `${this.baseUrl}/api/rest/issues/${issueId}`;
    const response = await this.apiFetch(url);
    const data = (await response.json()) as { issues: MantisBTIssue[] };
    return data.issues[0];
  }

  private async fetchUser(userId: number): Promise<MantisBTUser> {
    const url = `${this.baseUrl}/api/rest/users/${userId}`;
    const response = await this.apiFetch(url);
    return (await response.json()) as MantisBTUser;
  }

  private async fetchProjects(): Promise<MantisBTProject[]> {
    const url = `${this.baseUrl}/api/rest/projects`;
    const response = await this.apiFetch(url);
    const data = (await response.json()) as { projects: MantisBTProject[] };
    return data.projects ?? [];
  }

  private async resolveProjectId(projectName: string): Promise<number> {
    const resolved = await this.resolveProjectName(projectName);
    return resolved.id;
  }

  private flattenProjects(projects: MantisBTProject[]): MantisBTProject[] {
    const result: MantisBTProject[] = [];
    for (const p of projects) {
      result.push(p);
      if ((p as any).subProjects?.length) {
        result.push(...this.flattenProjects((p as any).subProjects));
      }
    }
    return result;
  }

  private buildUserEntity(user: MantisBTUser): CrawlerEntityData {
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

  /** Collect users and projects from an issue into the accumulation maps. */
  private collectUsersAndProjects(issue: MantisBTIssue): void {
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
  // ApiX plugin at /api/rest/plugins/ApiX/. When the core MantisBT REST
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
      console.warn(`  Warning: MantisHub IssueViewPage failed for issue ${issueId}: ${err}`);
    }
    return urlMap;
  }

  private async buildIssueEntity(issue: MantisBTIssue): Promise<CrawlerEntityData> {
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
    // Uses core MantisBT REST API first. On MantisHub instances, if the core
    // API fails, falls back to the ApiX IssueViewPage for signed download URLs.
    const attachments: CrawlerEntityData["attachments"] = [];
    const savedPaths = new Set<string>();
    let mantisHubUrls: Map<number, AttachmentUrlInfo> | null = null;

    for (const file of issue.attachments ?? []) {
      const storedName = attachmentFilename(issue.id, file.filename);
      const storagePath = `attachments/mantisbt/${storedName}`;
      let content = await this.downloadAttachment(
        issue.id, file.id, file.download_url,
        `issue ${issue.id} file "${file.filename}"`,
      );

      // MantisHub fallback: fetch signed URLs if core API failed
      if (!content && this.mantisHubMode) {
        if (!mantisHubUrls) {
          mantisHubUrls = await this.fetchMantisHubAttachmentUrls(issue.id);
        }
        const urlInfo = mantisHubUrls.get(file.id);
        const signedUrl = urlInfo?.signedUrl ?? urlInfo?.url;
        if (signedUrl) {
          content = await this.downloadBinary(signedUrl, `issue ${issue.id} file "${file.filename}" (MantisHub)`);
        }
      }

      if (content) {
        attachments.push({
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
        const storedName = noteAttachmentFilename(issue.id, note.id, att.filename);
        const storagePath = `attachments/mantisbt/${storedName}`;
        let content = await this.downloadAttachment(
          issue.id, att.id, att.download_url,
          `issue ${issue.id} note ${note.id} file "${att.filename}"`,
        );

        // MantisHub fallback: fetch signed URLs if core API failed
        if (!content && this.mantisHubMode) {
          if (!mantisHubUrls) {
            mantisHubUrls = await this.fetchMantisHubAttachmentUrls(issue.id);
          }
          const urlInfo = mantisHubUrls.get(att.id);
          const signedUrl = urlInfo?.signedUrl ?? urlInfo?.url;
          if (signedUrl) {
            content = await this.downloadBinary(signedUrl, `issue ${issue.id} note ${note.id} file "${att.filename}" (MantisHub)`);
          }
        }

        if (content) {
          attachments.push({
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
      title: issue.summary,
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
          const storagePath = `attachments/mantisbt/${attachmentFilename(issue.id, f.filename)}`;
          return {
            filename: f.filename,
            content_type: f.content_type,
            size: f.size,
            storagePath: savedPaths.has(storagePath) ? storagePath : undefined,
          };
        }),
        notes: (issue.notes ?? []).map((note) => ({
          ...note,
          attachments: (note.attachments ?? []).map((att) => {
            const storagePath = `attachments/mantisbt/${noteAttachmentFilename(issue.id, note.id, att.filename)}`;
            return {
              ...att,
              storagePath: savedPaths.has(storagePath) ? storagePath : undefined,
            };
          }),
        })),
        relationships: issue.relationships ?? [],
      },
      tags,
      attachments: attachments.length > 0 ? attachments : undefined,
      relations: relations.length > 0 ? relations : undefined,
    };
  }

  /**
   * Download an attachment via the core MantisBT REST API.
   *
   * Uses GET /api/rest/issues/{id}/files/{file_id} (operationId: IssueFileGet)
   * which returns JSON with base64-encoded content. Works for both issue-level
   * and note-level attachments per the MantisBT OpenAPI spec.
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

    // Core MantisBT REST API (IssueFileGet - returns base64 JSON)
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
