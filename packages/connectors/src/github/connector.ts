import type {
  Connector,
  ConnectorMetadata,
  ConnectorEntityData,
  SyncCursor,
  SyncResult,
} from "@veecontext/core";
import type {
  GitHubConfig,
  GitHubCredentials,
  GitHubIssue,
  GitHubPullRequest,
} from "./types";

const PER_PAGE = 100;
const API_BASE = "https://api.github.com";

interface GitHubSyncCursor extends SyncCursor {
  updatedSince?: string;
  issuesPage?: number;
  pullsPage?: number;
  phase?: "issues" | "pulls" | "done";
}

export class GitHubConnector implements Connector {
  metadata: ConnectorMetadata = {
    type: "github",
    displayName: "GitHub",
    description: "Syncs GitHub issues and pull requests",
    configSchema: {
      owner: { type: "string", required: true },
      repo: { type: "string", required: true },
      syncIssues: { type: "boolean", default: true },
      syncPullRequests: { type: "boolean", default: true },
    },
    credentialFields: ["token", "owner", "repo"],
  };

  private token = "";
  private owner = "";
  private repo = "";
  private syncIssues = true;
  private syncPullRequests = true;
  private fetchFn: typeof fetch = globalThis.fetch;

  async initialize(
    config: Record<string, unknown>,
    credentials: Record<string, unknown>,
  ): Promise<void> {
    const creds = credentials as unknown as GitHubCredentials;
    const cfg = config as unknown as GitHubConfig;
    this.token = creds.token;
    this.owner = creds.owner || cfg.owner;
    this.repo = creds.repo || cfg.repo;
    this.syncIssues = cfg.syncIssues !== false;
    this.syncPullRequests = cfg.syncPullRequests !== false;
  }

  setFetch(fn: typeof fetch): void {
    this.fetchFn = fn;
  }

  async sync(cursor: SyncCursor | null): Promise<SyncResult> {
    const c = (cursor as GitHubSyncCursor) ?? {
      phase: "issues",
      issuesPage: 1,
      pullsPage: 1,
    };

    const phase = c.phase ?? "issues";
    const entities: ConnectorEntityData[] = [];

    if (phase === "issues" && this.syncIssues) {
      const page = c.issuesPage ?? 1;
      const items = await this.fetchIssues(page, c.updatedSince);

      for (const issue of items) {
        // Skip pull requests returned in /issues endpoint
        if (issue.pull_request) continue;
        entities.push(this.mapIssue(issue));
      }

      if (items.length === PER_PAGE) {
        return {
          entities,
          nextCursor: { ...c, phase: "issues", issuesPage: page + 1 },
          hasMore: true,
          deletedExternalIds: [],
        };
      }

      // Issues done, move to pulls
      if (this.syncPullRequests) {
        return {
          entities,
          nextCursor: { ...c, phase: "pulls", pullsPage: 1 },
          hasMore: true,
          deletedExternalIds: [],
        };
      }

      // No PRs to sync — done
      const latestUpdated = this.findLatestUpdated(entities);
      return {
        entities,
        nextCursor: {
          phase: "done",
          updatedSince: latestUpdated ?? c.updatedSince,
        },
        hasMore: false,
        deletedExternalIds: [],
      };
    }

    if (phase === "pulls" && this.syncPullRequests) {
      const page = c.pullsPage ?? 1;
      const items = await this.fetchPullRequests(page, c.updatedSince);

      for (const pr of items) {
        entities.push(this.mapPullRequest(pr));
      }

      if (items.length === PER_PAGE) {
        return {
          entities,
          nextCursor: { ...c, phase: "pulls", pullsPage: page + 1 },
          hasMore: true,
          deletedExternalIds: [],
        };
      }

      // All done
      const latestUpdated = this.findLatestUpdated(entities);
      return {
        entities,
        nextCursor: {
          phase: "done",
          updatedSince: latestUpdated ?? c.updatedSince,
        },
        hasMore: false,
        deletedExternalIds: [],
      };
    }

    // If issues are disabled, start with pulls
    if (phase === "issues" && !this.syncIssues && this.syncPullRequests) {
      return {
        entities: [],
        nextCursor: { ...c, phase: "pulls", pullsPage: 1 },
        hasMore: true,
        deletedExternalIds: [],
      };
    }

    // Nothing to sync
    return {
      entities: [],
      nextCursor: c,
      hasMore: false,
      deletedExternalIds: [],
    };
  }

  async validateCredentials(
    credentials: Record<string, unknown>,
  ): Promise<boolean> {
    const creds = credentials as unknown as GitHubCredentials;
    try {
      const res = await this.fetchFn(
        `${API_BASE}/repos/${creds.owner}/${creds.repo}`,
        {
          headers: this.buildHeaders(creds.token),
        },
      );
      return res.ok;
    } catch {
      return false;
    }
  }

  async dispose(): Promise<void> {
    // No resources to clean up
  }

  private async fetchIssues(
    page: number,
    since?: string,
  ): Promise<GitHubIssue[]> {
    const params = new URLSearchParams({
      state: "all",
      sort: "updated",
      direction: "asc",
      per_page: String(PER_PAGE),
      page: String(page),
    });
    if (since) params.set("since", since);

    const res = await this.fetchFn(
      `${API_BASE}/repos/${this.owner}/${this.repo}/issues?${params}`,
      { headers: this.buildHeaders(this.token) },
    );
    if (!res.ok) {
      throw new Error(`GitHub API error ${res.status}: ${await res.text()}`);
    }
    return (await res.json()) as GitHubIssue[];
  }

  private async fetchPullRequests(
    page: number,
    since?: string,
  ): Promise<GitHubPullRequest[]> {
    const params = new URLSearchParams({
      state: "all",
      sort: "updated",
      direction: "asc",
      per_page: String(PER_PAGE),
      page: String(page),
    });
    if (since) params.set("since", since);

    const res = await this.fetchFn(
      `${API_BASE}/repos/${this.owner}/${this.repo}/pulls?${params}`,
      { headers: this.buildHeaders(this.token) },
    );
    if (!res.ok) {
      throw new Error(`GitHub API error ${res.status}: ${await res.text()}`);
    }
    return (await res.json()) as GitHubPullRequest[];
  }

  private buildHeaders(token: string): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }

  private mapIssue(issue: GitHubIssue): ConnectorEntityData {
    const tags = issue.labels.map((l) => l.name);

    const relations: ConnectorEntityData["relations"] = [];
    // Parse cross-references from body (e.g., #123)
    if (issue.body) {
      const refs = issue.body.match(/#(\d+)/g);
      if (refs) {
        const seen = new Set<string>();
        for (const ref of refs) {
          const num = ref.slice(1);
          const targetId = `issue-${num}`;
          if (!seen.has(targetId) && num !== String(issue.number)) {
            seen.add(targetId);
            relations.push({
              targetExternalId: targetId,
              relationType: "references",
            });
          }
        }
      }
    }

    return {
      externalId: `issue-${issue.number}`,
      entityType: "issue",
      title: issue.title,
      url: issue.html_url,
      tags,
      data: {
        number: issue.number,
        body: issue.body,
        state: issue.state,
        user: issue.user?.login ?? null,
        userUrl: issue.user?.html_url ?? null,
        assignees: issue.assignees.map((a) => a.login),
        labels: issue.labels.map((l) => ({ name: l.name, color: l.color })),
        milestone: issue.milestone?.title ?? null,
        milestoneNumber: issue.milestone?.number ?? null,
        createdAt: issue.created_at,
        updatedAt: issue.updated_at,
        closedAt: issue.closed_at,
      },
      relations,
    };
  }

  private mapPullRequest(pr: GitHubPullRequest): ConnectorEntityData {
    const tags = pr.labels.map((l) => l.name);
    tags.push(pr.draft ? "draft" : "ready");
    if (pr.merged) tags.push("merged");

    const relations: ConnectorEntityData["relations"] = [];
    // Parse cross-references from body
    if (pr.body) {
      const refs = pr.body.match(/#(\d+)/g);
      if (refs) {
        const seen = new Set<string>();
        for (const ref of refs) {
          const num = ref.slice(1);
          const targetId = `issue-${num}`;
          if (!seen.has(targetId) && num !== String(pr.number)) {
            seen.add(targetId);
            relations.push({
              targetExternalId: targetId,
              relationType: "closes",
            });
          }
        }
      }
    }

    return {
      externalId: `pr-${pr.number}`,
      entityType: "pull_request",
      title: pr.title,
      url: pr.html_url,
      tags,
      data: {
        number: pr.number,
        body: pr.body,
        state: pr.state,
        user: pr.user?.login ?? null,
        userUrl: pr.user?.html_url ?? null,
        assignees: pr.assignees.map((a) => a.login),
        labels: pr.labels.map((l) => ({ name: l.name, color: l.color })),
        milestone: pr.milestone?.title ?? null,
        head: pr.head.ref,
        headSha: pr.head.sha,
        base: pr.base.ref,
        baseSha: pr.base.sha,
        merged: pr.merged,
        mergedAt: pr.merged_at,
        draft: pr.draft,
        reviewComments: pr.review_comments,
        createdAt: pr.created_at,
        updatedAt: pr.updated_at,
        closedAt: pr.closed_at,
      },
      relations,
    };
  }

  private findLatestUpdated(entities: ConnectorEntityData[]): string | undefined {
    let latest: string | undefined;
    for (const e of entities) {
      const updatedAt = e.data.updatedAt as string | undefined;
      if (updatedAt && (!latest || updatedAt > latest)) {
        latest = updatedAt;
      }
    }
    return latest;
  }
}
