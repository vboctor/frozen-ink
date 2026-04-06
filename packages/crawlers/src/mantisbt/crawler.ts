import type {
  Crawler,
  CrawlerMetadata,
  CrawlerEntityData,
  SyncCursor,
  SyncResult,
} from "@veecontext/core";
import type {
  MantisBTConfig,
  MantisBTCredentials,
  MantisBTIssue,
} from "./types";

interface MantisBTSyncCursor extends SyncCursor {
  /** Page number for next fetch (1-based). */
  page?: number;
  /** Total entities fetched so far (for --max limiting). */
  fetched?: number;
}

const PAGE_SIZE = 50;

function padId(id: number): string {
  return String(id).padStart(5, "0");
}

function attachmentFilename(issueId: number, filename: string): string {
  const hasher = new Bun.CryptoHasher("md5");
  hasher.update(filename);
  const hash = hasher.digest("hex").slice(0, 8);
  const dotIdx = filename.lastIndexOf(".");
  const ext = dotIdx !== -1 ? filename.slice(dotIdx) : "";
  return `${padId(issueId)}-${hash}${ext}`;
}

function noteAttachmentFilename(issueId: number, noteId: number, filename: string): string {
  const hasher = new Bun.CryptoHasher("md5");
  hasher.update(filename);
  const hash = hasher.digest("hex").slice(0, 8);
  const dotIdx = filename.lastIndexOf(".");
  const ext = dotIdx !== -1 ? filename.slice(dotIdx) : "";
  return `${padId(issueId)}-${padId(noteId)}-${hash}${ext}`;
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
      projectId: {
        type: "number",
        required: false,
        description: "Optional project ID to filter issues",
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

  async initialize(
    config: Record<string, unknown>,
    credentials: Record<string, unknown>,
  ): Promise<void> {
    const cfg = config as unknown as MantisBTConfig;
    const creds = credentials as unknown as MantisBTCredentials;
    this.baseUrl = cfg.baseUrl.replace(/\/+$/, "");
    this.token = creds.token ?? "";
    this.projectId = cfg.projectId;
    this.maxEntities = cfg.maxEntities;
  }

  async sync(cursor: SyncCursor | null): Promise<SyncResult> {
    const c = (cursor as MantisBTSyncCursor) ?? {};
    const page = c.page ?? 1;
    const fetched = c.fetched ?? 0;

    // Build URL
    let url = `${this.baseUrl}/api/rest/issues?page_size=${PAGE_SIZE}&page=${page}`;
    if (this.projectId) {
      url += `&project_id=${this.projectId}`;
    }

    const response = await this.apiFetch(url);
    const data = (await response.json()) as { issues: MantisBTIssue[] };
    const issues = data.issues ?? [];

    // Sort by last_updated descending (API doesn't support sorting)
    issues.sort(
      (a, b) =>
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    );

    // Apply max entities limit
    let remaining = issues.length;
    let issuesToProcess = issues;
    if (this.maxEntities) {
      remaining = this.maxEntities - fetched;
      if (remaining <= 0) {
        return {
          entities: [],
          nextCursor: null,
          hasMore: false,
          deletedExternalIds: [],
        };
      }
      issuesToProcess = issues.slice(0, remaining);
    }

    const entities: CrawlerEntityData[] = await Promise.all(
      issuesToProcess.map((issue) => this.buildIssueEntity(issue)),
    );

    const newFetched = fetched + issuesToProcess.length;
    const apiHasMore = issues.length === PAGE_SIZE;
    const reachedMax = this.maxEntities ? newFetched >= this.maxEntities : false;
    const hasMore = apiHasMore && !reachedMax;

    return {
      entities,
      nextCursor: hasMore
        ? { page: page + 1, fetched: newFetched }
        : null,
      hasMore,
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

      const response = await fetch(
        `${baseUrl}/api/rest/issues?page_size=1&page=1`,
        { headers },
      );

      // Accept 200 (valid token) or allow empty token for anonymous instances
      if (response.ok) return true;

      // If token is empty and we get 401, the instance doesn't support
      // anonymous access — still valid config, user just can't fetch yet
      if (!token && response.status === 401) return true;

      return false;
    } catch {
      return false;
    }
  }

  async dispose(): Promise<void> {}

  private async apiFetch(url: string): Promise<Response> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.token) {
      headers["Authorization"] = this.token;
    }

    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(
        `MantisBT API request failed: ${response.status} ${response.statusText}`,
      );
    }
    return response;
  }

  private async buildIssueEntity(issue: MantisBTIssue): Promise<CrawlerEntityData> {
    const hasher = new Bun.CryptoHasher("sha256");
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
    const attachments: CrawlerEntityData["attachments"] = [];
    const savedPaths = new Set<string>();

    for (const file of issue.files ?? []) {
      const storedName = attachmentFilename(issue.id, file.filename);
      const storagePath = `attachments/mantisbt/${storedName}`;
      const content = await this.downloadAttachment(issue.id, file.id, `issue ${issue.id} file "${file.filename}"`);
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
        const content = await this.downloadAttachment(issue.id, att.id, `issue ${issue.id} note ${note.id} file "${att.filename}"`);
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
        // Only include storagePath when the file was actually downloaded.
        files: (issue.files ?? []).map((f) => {
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
   * Download a file using GET /api/rest/issues/:issue_id/files/:file_id.
   * The response is JSON: { files: [{ content: "<base64>" }] }
   */
  private async downloadAttachment(
    issueId: number,
    fileId: number,
    label: string,
  ): Promise<Buffer | null> {
    const headers: Record<string, string> = {};
    if (this.token) {
      headers["Authorization"] = this.token;
    }

    const url = `${this.baseUrl}/api/rest/issues/${issueId}/files/${fileId}`;
    try {
      const res = await fetch(url, { headers });
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
}
