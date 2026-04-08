import type {
  Crawler,
  CrawlerMetadata,
  CrawlerEntityData,
  SyncCursor,
  SyncResult,
} from "@frozenink/core";
import type {
  GitHubConfig,
  GitHubCredentials,
  GitHubIssue,
  GitHubPullRequest,
  GitHubComment,
  GitHubReview,
  GitHubReviewComment,
  GitHubCheckRun,
  GitHubUserProfile,
} from "./types";

const PER_PAGE = 100;
const API_BASE = "https://api.github.com";

interface GitHubSyncCursor extends SyncCursor {
  updatedSince?: string;
  issuesPage?: number;
  pullsPage?: number;
  phase?: "issues" | "pulls" | "users" | "done";
  /** External IDs collected during the current sync run (openOnly mode). */
  seenIds?: string[];
  /** Open IDs from the previous completed sync (openOnly mode). */
  knownOpenIds?: string[];
  /** Running count of entities fetched per type in this sync run. */
  issuesFetched?: number;
  pullsFetched?: number;
  totalFetched?: number;
  /** User logins collected from issues/PRs to fetch in the users phase. */
  collectedUsers?: string[];
}

export class GitHubCrawler implements Crawler {
  metadata: CrawlerMetadata = {
    type: "github",
    displayName: "GitHub",
    description: "Syncs GitHub issues and pull requests",
    configSchema: {
      owner: { type: "string", required: true },
      repo: { type: "string", required: true },
      syncIssues: { type: "boolean", default: true },
      syncPullRequests: { type: "boolean", default: true },
      syncComments: { type: "boolean", default: true },
      syncCheckStatuses: { type: "boolean", default: true },
      openOnly: { type: "boolean", default: false },
      maxEntities: { type: "number" },
      maxIssues: { type: "number" },
      maxPullRequests: { type: "number" },
    },
    credentialFields: ["token", "owner", "repo"],
  };

  private token = "";
  private owner = "";
  private repo = "";
  private syncIssues = true;
  private syncPullRequests = true;
  private syncComments = true;
  private syncCheckStatuses = true;
  private openOnly = false;
  private maxEntities?: number;
  private maxIssues?: number;
  private maxPullRequests?: number;
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
    this.syncComments = cfg.syncComments !== false;
    this.syncCheckStatuses = cfg.syncCheckStatuses !== false;
    this.openOnly = cfg.openOnly === true;
    this.maxEntities = typeof cfg.maxEntities === "number" ? cfg.maxEntities : undefined;
    this.maxIssues = typeof cfg.maxIssues === "number" ? cfg.maxIssues : undefined;
    this.maxPullRequests = typeof cfg.maxPullRequests === "number" ? cfg.maxPullRequests : undefined;
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
    const entities: CrawlerEntityData[] = [];
    const seenIds = [...(c.seenIds ?? [])];
    let issuesFetched = c.issuesFetched ?? 0;
    let pullsFetched = c.pullsFetched ?? 0;
    let totalFetched = c.totalFetched ?? 0;
    const collectedUsers = new Set<string>(c.collectedUsers ?? []);

    // Check if global limit already reached from previous pages
    if (this.maxEntities && totalFetched >= this.maxEntities) {
      return this.finalize(c, [], seenIds, collectedUsers);
    }

    // ── Issues phase ───────────────────────────────────────────────
    if (phase === "issues" && this.syncIssues) {
      // Check per-type limit
      if (this.maxIssues !== undefined && issuesFetched >= this.maxIssues) {
        return this.advanceFromIssues(c, [], seenIds, issuesFetched, pullsFetched, totalFetched, collectedUsers);
      }

      const page = c.issuesPage ?? 1;
      const since = this.openOnly ? undefined : c.updatedSince;
      const state = this.openOnly ? "open" : "all";
      const items = await this.fetchIssues(page, since, state);

      for (const issue of items) {
        if (issue.pull_request) continue;
        const entity = await this.mapIssue(issue);
        entities.push(entity);
        seenIds.push(entity.externalId);
        this.collectUsers(issue.user, issue.assignees, null, null, collectedUsers);
      }

      issuesFetched += entities.length;
      totalFetched += entities.length;

      // Apply per-type limit
      if (this.maxIssues !== undefined && issuesFetched > this.maxIssues) {
        const excess = issuesFetched - this.maxIssues;
        entities.splice(entities.length - excess);
        seenIds.splice(seenIds.length - excess);
        issuesFetched = this.maxIssues;
        totalFetched -= excess;
      }

      // Apply global limit
      if (this.maxEntities && totalFetched > this.maxEntities) {
        const excess = totalFetched - this.maxEntities;
        entities.splice(entities.length - excess);
        seenIds.splice(seenIds.length - excess);
        totalFetched = this.maxEntities;
        return this.finalize(c, entities, seenIds, collectedUsers);
      }

      if (this.maxEntities && totalFetched >= this.maxEntities) {
        return this.finalize(c, entities, seenIds, collectedUsers);
      }

      const reachedTypeMax = this.maxIssues !== undefined && issuesFetched >= this.maxIssues;

      if (!reachedTypeMax && items.length === PER_PAGE) {
        return {
          entities,
          nextCursor: { ...c, phase: "issues", issuesPage: page + 1, seenIds, issuesFetched, pullsFetched, totalFetched, collectedUsers: [...collectedUsers] },
          hasMore: true,
          deletedExternalIds: [],
        };
      }

      return this.advanceFromIssues(c, entities, seenIds, issuesFetched, pullsFetched, totalFetched, collectedUsers);
    }

    // ── Pulls phase ────────────────────────────────────────────────
    if (phase === "pulls" && this.syncPullRequests) {
      if (this.maxPullRequests !== undefined && pullsFetched >= this.maxPullRequests) {
        return this.advanceFromPulls(c, [], seenIds, issuesFetched, pullsFetched, totalFetched, collectedUsers);
      }

      const page = c.pullsPage ?? 1;
      const since = this.openOnly ? undefined : c.updatedSince;
      const state = this.openOnly ? "open" : "all";
      const items = await this.fetchPullRequests(page, since, state);

      for (const pr of items) {
        const entity = await this.mapPullRequest(pr);
        entities.push(entity);
        seenIds.push(entity.externalId);
        this.collectUsers(pr.user, pr.assignees, entity.data.reviews as unknown[] | undefined, entity.data.comments as unknown[] | undefined, collectedUsers);
      }

      pullsFetched += entities.length;
      totalFetched += entities.length;

      if (this.maxPullRequests !== undefined && pullsFetched > this.maxPullRequests) {
        const excess = pullsFetched - this.maxPullRequests;
        entities.splice(entities.length - excess);
        seenIds.splice(seenIds.length - excess);
        pullsFetched = this.maxPullRequests;
        totalFetched -= excess;
      }

      if (this.maxEntities && totalFetched > this.maxEntities) {
        const excess = totalFetched - this.maxEntities;
        entities.splice(entities.length - excess);
        seenIds.splice(seenIds.length - excess);
        totalFetched = this.maxEntities;
        return this.finalize(c, entities, seenIds, collectedUsers);
      }

      if (this.maxEntities && totalFetched >= this.maxEntities) {
        return this.finalize(c, entities, seenIds, collectedUsers);
      }

      const reachedTypeMax = this.maxPullRequests !== undefined && pullsFetched >= this.maxPullRequests;

      if (!reachedTypeMax && items.length === PER_PAGE) {
        return {
          entities,
          nextCursor: { ...c, phase: "pulls", pullsPage: page + 1, seenIds, issuesFetched, pullsFetched, totalFetched, collectedUsers: [...collectedUsers] },
          hasMore: true,
          deletedExternalIds: [],
        };
      }

      return this.advanceFromPulls(c, entities, seenIds, issuesFetched, pullsFetched, totalFetched, collectedUsers);
    }

    // ── Users phase ────────────────────────────────────────────────
    if (phase === "users") {
      const userLogins = c.collectedUsers ?? [];
      for (const login of userLogins) {
        if (this.maxEntities && totalFetched >= this.maxEntities) break;
        const profile = await this.fetchUserProfile(login);
        if (profile) {
          entities.push(this.mapUserProfile(profile));
          totalFetched++;
        }
      }

      return this.finalize(c, entities, seenIds, collectedUsers);
    }

    // If issues are disabled, start with pulls
    if (phase === "issues" && !this.syncIssues && this.syncPullRequests) {
      return {
        entities: [],
        nextCursor: { ...c, phase: "pulls", pullsPage: 1, seenIds, issuesFetched, pullsFetched, totalFetched, collectedUsers: [...collectedUsers] },
        hasMore: true,
        deletedExternalIds: [],
      };
    }

    // If issues disabled and pulls disabled, go to users
    if (phase === "issues" && !this.syncIssues && !this.syncPullRequests) {
      if (collectedUsers.size > 0) {
        return {
          entities: [],
          nextCursor: { ...c, phase: "users", seenIds, issuesFetched, pullsFetched, totalFetched, collectedUsers: [...collectedUsers] },
          hasMore: true,
          deletedExternalIds: [],
        };
      }
      return this.finalize(c, [], seenIds, collectedUsers);
    }

    // Nothing to sync
    return {
      entities: [],
      nextCursor: c,
      hasMore: false,
      deletedExternalIds: [],
    };
  }

  /** Transition from issues phase to pulls or users or finalize. */
  private advanceFromIssues(
    c: GitHubSyncCursor,
    entities: CrawlerEntityData[],
    seenIds: string[],
    issuesFetched: number,
    pullsFetched: number,
    totalFetched: number,
    collectedUsers: Set<string>,
  ): SyncResult {
    if (this.syncPullRequests) {
      return {
        entities,
        nextCursor: { ...c, phase: "pulls", pullsPage: 1, seenIds, issuesFetched, pullsFetched, totalFetched, collectedUsers: [...collectedUsers] },
        hasMore: true,
        deletedExternalIds: [],
      };
    }
    if (collectedUsers.size > 0) {
      return {
        entities,
        nextCursor: { ...c, phase: "users", seenIds, issuesFetched, pullsFetched, totalFetched, collectedUsers: [...collectedUsers] },
        hasMore: true,
        deletedExternalIds: [],
      };
    }
    return this.finalize(c, entities, seenIds, collectedUsers);
  }

  /** Transition from pulls phase to users or finalize. */
  private advanceFromPulls(
    c: GitHubSyncCursor,
    entities: CrawlerEntityData[],
    seenIds: string[],
    issuesFetched: number,
    pullsFetched: number,
    totalFetched: number,
    collectedUsers: Set<string>,
  ): SyncResult {
    if (collectedUsers.size > 0) {
      return {
        entities,
        nextCursor: { ...c, phase: "users", seenIds, issuesFetched, pullsFetched, totalFetched, collectedUsers: [...collectedUsers] },
        hasMore: true,
        deletedExternalIds: [],
      };
    }
    return this.finalize(c, entities, seenIds, collectedUsers);
  }

  /**
   * Build the final SyncResult after all phases have completed.
   * In openOnly mode, computes deletedExternalIds by comparing the current
   * seen set against the previously known open set.
   */
  private finalize(
    cursor: GitHubSyncCursor,
    entities: CrawlerEntityData[],
    seenIds: string[],
    _collectedUsers: Set<string>,
  ): SyncResult {
    const latestUpdated = this.findLatestUpdated(entities);
    let deletedExternalIds: string[] = [];

    if (this.openOnly) {
      const seenSet = new Set(seenIds);
      const previousKnown = cursor.knownOpenIds ?? [];
      deletedExternalIds = previousKnown.filter((id) => !seenSet.has(id));
    }

    return {
      entities,
      nextCursor: {
        phase: "done",
        updatedSince: this.openOnly ? undefined : (latestUpdated ?? cursor.updatedSince),
        knownOpenIds: this.openOnly ? seenIds : undefined,
      },
      hasMore: false,
      deletedExternalIds,
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

  // ── API fetch methods ──────────────────────────────────────────────

  private async fetchIssues(
    page: number,
    since?: string,
    state: string = "all",
  ): Promise<GitHubIssue[]> {
    const params = new URLSearchParams({
      state,
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
    state: string = "all",
  ): Promise<GitHubPullRequest[]> {
    const params = new URLSearchParams({
      state,
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

  private async fetchComments(issueNumber: number): Promise<GitHubComment[]> {
    const allComments: GitHubComment[] = [];
    let page = 1;
    while (true) {
      const params = new URLSearchParams({
        per_page: String(PER_PAGE),
        page: String(page),
      });
      const res = await this.fetchFn(
        `${API_BASE}/repos/${this.owner}/${this.repo}/issues/${issueNumber}/comments?${params}`,
        { headers: this.buildHeaders(this.token) },
      );
      if (!res.ok) break;
      const batch = (await res.json()) as GitHubComment[];
      allComments.push(...batch);
      if (batch.length < PER_PAGE) break;
      page++;
    }
    return allComments;
  }

  private async fetchReviews(prNumber: number): Promise<GitHubReview[]> {
    const allReviews: GitHubReview[] = [];
    let page = 1;
    while (true) {
      const params = new URLSearchParams({
        per_page: String(PER_PAGE),
        page: String(page),
      });
      const res = await this.fetchFn(
        `${API_BASE}/repos/${this.owner}/${this.repo}/pulls/${prNumber}/reviews?${params}`,
        { headers: this.buildHeaders(this.token) },
      );
      if (!res.ok) break;
      const batch = (await res.json()) as GitHubReview[];
      allReviews.push(...batch);
      if (batch.length < PER_PAGE) break;
      page++;
    }
    return allReviews;
  }

  private async fetchReviewComments(prNumber: number): Promise<GitHubReviewComment[]> {
    const allComments: GitHubReviewComment[] = [];
    let page = 1;
    while (true) {
      const params = new URLSearchParams({
        per_page: String(PER_PAGE),
        page: String(page),
      });
      const res = await this.fetchFn(
        `${API_BASE}/repos/${this.owner}/${this.repo}/pulls/${prNumber}/comments?${params}`,
        { headers: this.buildHeaders(this.token) },
      );
      if (!res.ok) break;
      const batch = (await res.json()) as GitHubReviewComment[];
      allComments.push(...batch);
      if (batch.length < PER_PAGE) break;
      page++;
    }
    return allComments;
  }

  private async fetchCheckRuns(sha: string): Promise<GitHubCheckRun[]> {
    const allRuns: GitHubCheckRun[] = [];
    let page = 1;
    while (true) {
      const params = new URLSearchParams({
        per_page: String(PER_PAGE),
        page: String(page),
      });
      const res = await this.fetchFn(
        `${API_BASE}/repos/${this.owner}/${this.repo}/commits/${sha}/check-runs?${params}`,
        { headers: this.buildHeaders(this.token) },
      );
      if (!res.ok) break;
      const json = (await res.json()) as {
        total_count: number;
        check_runs: GitHubCheckRun[];
      };
      allRuns.push(...json.check_runs);
      if (allRuns.length >= json.total_count) break;
      page++;
    }
    return allRuns;
  }

  private async fetchUserProfile(login: string): Promise<GitHubUserProfile | null> {
    const res = await this.fetchFn(
      `${API_BASE}/users/${login}`,
      { headers: this.buildHeaders(this.token) },
    );
    if (!res.ok) return null;
    return (await res.json()) as GitHubUserProfile;
  }

  // ── Helpers ────────────────────────────────────────────────────────

  private buildHeaders(token: string): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }

  /** Collect unique user logins from issue/PR fields into the set. */
  private collectUsers(
    author: { login: string } | null,
    assignees: { login: string }[],
    reviews: unknown[] | null | undefined,
    comments: unknown[] | null | undefined,
    out: Set<string>,
  ): void {
    if (author) out.add(author.login);
    for (const a of assignees) out.add(a.login);
    if (reviews) {
      for (const r of reviews) {
        const review = r as { user?: { login?: string }; reviewComments?: Array<{ user?: { login?: string } }> };
        if (review.user?.login) out.add(review.user.login);
        if (review.reviewComments) {
          for (const rc of review.reviewComments) {
            if (rc.user?.login) out.add(rc.user.login);
          }
        }
      }
    }
    if (comments) {
      for (const c of comments) {
        const login = (c as { user?: { login?: string } })?.user?.login;
        if (login) out.add(login);
      }
    }
  }

  private mapUser(user: { login: string; avatar_url: string; html_url: string } | null) {
    if (!user) return null;
    return {
      login: user.login,
      avatarUrl: user.avatar_url,
      url: user.html_url,
    };
  }

  private mapReactions(reactions?: {
    total_count: number;
    "+1": number;
    "-1": number;
    laugh: number;
    hooray: number;
    confused: number;
    heart: number;
    rocket: number;
    eyes: number;
  }) {
    if (!reactions || reactions.total_count === 0) return null;
    return {
      total: reactions.total_count,
      "+1": reactions["+1"],
      "-1": reactions["-1"],
      laugh: reactions.laugh,
      hooray: reactions.hooray,
      confused: reactions.confused,
      heart: reactions.heart,
      rocket: reactions.rocket,
      eyes: reactions.eyes,
    };
  }

  private async mapIssue(issue: GitHubIssue): Promise<CrawlerEntityData> {
    const tags = issue.labels.map((l) => l.name);

    const relations: CrawlerEntityData["relations"] = [];
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

    // Add user relations
    if (issue.user) {
      relations.push({ targetExternalId: `user-${issue.user.login}`, relationType: "authored_by" });
    }
    for (const a of issue.assignees) {
      relations.push({ targetExternalId: `user-${a.login}`, relationType: "assigned_to" });
    }

    let comments: unknown[] = [];
    if (this.syncComments && issue.comments > 0) {
      const rawComments = await this.fetchComments(issue.number);
      comments = rawComments.map((c) => ({
        id: c.id,
        user: this.mapUser(c.user),
        body: c.body,
        createdAt: c.created_at,
        updatedAt: c.updated_at,
        url: c.html_url,
        reactions: this.mapReactions(c.reactions),
      }));
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
        stateReason: issue.state_reason ?? null,
        user: this.mapUser(issue.user),
        assignees: issue.assignees.map((a) => this.mapUser(a)),
        labels: issue.labels.map((l) => ({ name: l.name, color: l.color })),
        milestone: issue.milestone?.title ?? null,
        milestoneNumber: issue.milestone?.number ?? null,
        reactions: this.mapReactions(issue.reactions),
        comments,
        commentCount: issue.comments,
        createdAt: issue.created_at,
        updatedAt: issue.updated_at,
        closedAt: issue.closed_at,
      },
      relations,
    };
  }

  private async mapPullRequest(pr: GitHubPullRequest): Promise<CrawlerEntityData> {
    const tags = pr.labels.map((l) => l.name);
    tags.push(pr.draft ? "draft" : "ready");
    if (pr.merged) tags.push("merged");

    const relations: CrawlerEntityData["relations"] = [];
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

    // Add user relations
    if (pr.user) {
      relations.push({ targetExternalId: `user-${pr.user.login}`, relationType: "authored_by" });
    }
    for (const a of pr.assignees) {
      relations.push({ targetExternalId: `user-${a.login}`, relationType: "assigned_to" });
    }

    let comments: unknown[] = [];
    if (this.syncComments && pr.comments > 0) {
      const rawComments = await this.fetchComments(pr.number);
      comments = rawComments.map((c) => ({
        id: c.id,
        user: this.mapUser(c.user),
        body: c.body,
        createdAt: c.created_at,
        updatedAt: c.updated_at,
        url: c.html_url,
        reactions: this.mapReactions(c.reactions),
      }));
    }

    let reviews: unknown[] = [];
    if (this.syncComments) {
      const rawReviews = await this.fetchReviews(pr.number);
      const rawReviewComments = await this.fetchReviewComments(pr.number);

      // Group review comments by their parent review ID
      const commentsByReview = new Map<number, typeof rawReviewComments>();
      for (const rc of rawReviewComments) {
        const list = commentsByReview.get(rc.pull_request_review_id) ?? [];
        list.push(rc);
        commentsByReview.set(rc.pull_request_review_id, list);
      }

      reviews = rawReviews.map((r) => ({
        id: r.id,
        user: this.mapUser(r.user),
        state: r.state,
        body: r.body,
        submittedAt: r.submitted_at,
        url: r.html_url,
        // Attach diff-level comments to this review
        reviewComments: (commentsByReview.get(r.id) ?? []).map((rc) => ({
          id: rc.id,
          user: this.mapUser(rc.user),
          body: rc.body,
          path: rc.path,
          diffHunk: rc.diff_hunk,
          createdAt: rc.created_at,
          url: rc.html_url,
          inReplyToId: rc.in_reply_to_id ?? null,
          reactions: this.mapReactions(rc.reactions),
        })),
      }));
      // Add reviewer relations
      for (const r of rawReviews) {
        if (r.user) {
          relations.push({ targetExternalId: `user-${r.user.login}`, relationType: "reviewed_by" });
        }
      }
    }

    let checkRuns: unknown[] = [];
    if (this.syncCheckStatuses) {
      const rawChecks = await this.fetchCheckRuns(pr.head.sha);
      checkRuns = rawChecks.map((cr) => ({
        id: cr.id,
        name: cr.name,
        status: cr.status,
        conclusion: cr.conclusion,
        url: cr.html_url,
        startedAt: cr.started_at,
        completedAt: cr.completed_at,
      }));
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
        user: this.mapUser(pr.user),
        assignees: pr.assignees.map((a) => this.mapUser(a)),
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
        reactions: this.mapReactions(pr.reactions),
        comments,
        commentCount: pr.comments,
        reviews,
        checkRuns,
        createdAt: pr.created_at,
        updatedAt: pr.updated_at,
        closedAt: pr.closed_at,
      },
      relations,
    };
  }

  private mapUserProfile(profile: GitHubUserProfile): CrawlerEntityData {
    return {
      externalId: `user-${profile.login}`,
      entityType: "user",
      title: profile.name ?? profile.login,
      url: profile.html_url,
      tags: ["user"],
      data: {
        login: profile.login,
        name: profile.name,
        avatarUrl: profile.avatar_url,
        url: profile.html_url,
        company: profile.company,
        location: profile.location,
        bio: profile.bio,
        blog: profile.blog,
        publicRepos: profile.public_repos,
        followers: profile.followers,
        following: profile.following,
        createdAt: profile.created_at,
        updatedAt: profile.updated_at,
      },
    };
  }

  private findLatestUpdated(entities: CrawlerEntityData[]): string | undefined {
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
