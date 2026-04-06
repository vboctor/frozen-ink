import { describe, it, expect, beforeEach } from "bun:test";
import { GitHubCrawler } from "../crawler";
import type {
  GitHubIssue,
  GitHubPullRequest,
  GitHubComment,
  GitHubReview,
  GitHubUserProfile,
} from "../types";

function mockFetch(responses: Record<string, unknown>) {
  return async (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();

    for (const [pattern, data] of Object.entries(responses)) {
      if (url.includes(pattern)) {
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    }
    return new Response("Not found", { status: 404 });
  };
}

function sampleIssue(overrides: Partial<GitHubIssue> = {}): GitHubIssue {
  return {
    number: 10,
    title: "Bug report",
    body: "Something is broken. See #5.",
    state: "open",
    state_reason: null,
    html_url: "https://github.com/owner/repo/issues/10",
    user: { login: "testuser", avatar_url: "https://avatars.githubusercontent.com/u/1?v=4", html_url: "https://github.com/testuser" },
    labels: [{ name: "bug", color: "d73a4a", description: null }],
    assignees: [{ login: "dev1", avatar_url: "https://avatars.githubusercontent.com/u/2?v=4", html_url: "https://github.com/dev1" }],
    milestone: { title: "v1.0", number: 1, state: "open" },
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-02T00:00:00Z",
    closed_at: null,
    comments: 0,
    ...overrides,
  };
}

function samplePR(overrides: Partial<GitHubPullRequest> = {}): GitHubPullRequest {
  return {
    number: 20,
    title: "Add feature X",
    body: "Implements feature X.\n\nCloses #10.",
    state: "open",
    html_url: "https://github.com/owner/repo/pull/20",
    user: { login: "testuser", avatar_url: "https://avatars.githubusercontent.com/u/1?v=4", html_url: "https://github.com/testuser" },
    labels: [{ name: "enhancement", color: "a2eeef", description: null }],
    assignees: [],
    milestone: null,
    head: { ref: "feat/x", sha: "aaa1111" },
    base: { ref: "main", sha: "bbb2222" },
    merged: false,
    merged_at: null,
    draft: false,
    review_comments: 2,
    created_at: "2024-01-03T00:00:00Z",
    updated_at: "2024-01-04T00:00:00Z",
    closed_at: null,
    comments: 0,
    ...overrides,
  };
}

function sampleComment(overrides: Partial<GitHubComment> = {}): GitHubComment {
  return {
    id: 100,
    body: "This looks great!",
    user: { login: "reviewer", avatar_url: "https://avatars.githubusercontent.com/u/3?v=4", html_url: "https://github.com/reviewer" },
    created_at: "2024-01-02T12:00:00Z",
    updated_at: "2024-01-02T12:00:00Z",
    html_url: "https://github.com/owner/repo/issues/10#issuecomment-100",
    reactions: {
      total_count: 2,
      "+1": 2,
      "-1": 0,
      laugh: 0,
      hooray: 0,
      confused: 0,
      heart: 0,
      rocket: 0,
      eyes: 0,
    },
    ...overrides,
  };
}

function sampleReview(overrides: Partial<GitHubReview> = {}): GitHubReview {
  return {
    id: 200,
    user: { login: "reviewer", avatar_url: "https://avatars.githubusercontent.com/u/3?v=4", html_url: "https://github.com/reviewer" },
    state: "APPROVED",
    body: "LGTM",
    submitted_at: "2024-01-04T10:00:00Z",
    html_url: "https://github.com/owner/repo/pull/20#pullrequestreview-200",
    ...overrides,
  };
}

function sampleUserProfile(overrides: Partial<GitHubUserProfile> = {}): GitHubUserProfile {
  return {
    login: "testuser",
    id: 1,
    avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
    html_url: "https://github.com/testuser",
    name: "Test User",
    company: "Acme Corp",
    blog: "https://testuser.dev",
    location: "San Francisco",
    bio: "Full-stack developer",
    public_repos: 42,
    public_gists: 5,
    followers: 100,
    following: 50,
    created_at: "2020-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

let crawler: GitHubCrawler;

beforeEach(async () => {
  crawler = new GitHubCrawler();
  await crawler.initialize(
    { owner: "owner", repo: "repo" },
    { token: "ghp_test", owner: "owner", repo: "repo" },
  );
});

describe("GitHubCrawler", () => {
  describe("metadata", () => {
    it("has correct type and credential fields", () => {
      expect(crawler.metadata.type).toBe("github");
      expect(crawler.metadata.credentialFields).toContain("token");
      expect(crawler.metadata.credentialFields).toContain("owner");
      expect(crawler.metadata.credentialFields).toContain("repo");
    });
  });

  describe("sync", () => {
    it("fetches issues and maps to CrawlerEntityData with user objects", async () => {
      const issue = sampleIssue();
      crawler.setFetch(
        mockFetch({
          "/issues?": [issue],
          "/pulls?": [],
        }),
      );

      const result = await crawler.sync(null);
      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].externalId).toBe("issue-10");
      expect(result.entities[0].entityType).toBe("issue");
      expect(result.entities[0].title).toBe("Bug report");
      expect(result.entities[0].url).toBe("https://github.com/owner/repo/issues/10");
      expect(result.entities[0].tags).toContain("bug");
      expect(result.entities[0].data.state).toBe("open");

      // User is now an object with avatar
      const user = result.entities[0].data.user as { login: string; avatarUrl: string; url: string };
      expect(user.login).toBe("testuser");
      expect(user.avatarUrl).toBe("https://avatars.githubusercontent.com/u/1?v=4");
      expect(user.url).toBe("https://github.com/testuser");

      // Assignees are now user objects
      const assignees = result.entities[0].data.assignees as Array<{ login: string; avatarUrl: string }>;
      expect(assignees).toHaveLength(1);
      expect(assignees[0].login).toBe("dev1");
      expect(assignees[0].avatarUrl).toBe("https://avatars.githubusercontent.com/u/2?v=4");

      expect(result.entities[0].data.milestone).toBe("v1.0");
    });

    it("fetches PRs after issues are done", async () => {
      const pr = samplePR();
      crawler.setFetch(
        mockFetch({
          "/issues?": [],
          "/pulls?": [pr],
          "/reviews?": [],
          "/check-runs?": { total_count: 0, check_runs: [] },
        }),
      );

      // First call: issues phase returns empty, transitions to pulls
      const result1 = await crawler.sync(null);
      expect(result1.hasMore).toBe(true);
      expect(result1.nextCursor).toHaveProperty("phase", "pulls");

      // Second call: pulls phase
      const result2 = await crawler.sync(result1.nextCursor);
      expect(result2.entities).toHaveLength(1);
      expect(result2.entities[0].externalId).toBe("pr-20");
      expect(result2.entities[0].entityType).toBe("pull_request");
      expect(result2.entities[0].title).toBe("Add feature X");
      expect(result2.entities[0].data.head).toBe("feat/x");
      expect(result2.entities[0].data.base).toBe("main");
      expect(result2.entities[0].data.merged).toBe(false);
      // hasMore=true because users phase follows
      expect(result2.hasMore).toBe(true);
      expect(result2.nextCursor).toHaveProperty("phase", "users");
    });

    it("skips pull requests returned in the issues endpoint", async () => {
      const issue = sampleIssue();
      const prAsIssue = sampleIssue({
        number: 30,
        title: "PR in issues",
        pull_request: { url: "https://api.github.com/repos/owner/repo/pulls/30" },
      });

      crawler.setFetch(
        mockFetch({
          "/issues?": [issue, prAsIssue],
          "/pulls?": [],
        }),
      );

      const result = await crawler.sync(null);
      const issueEntities = result.entities.filter((e) => e.entityType === "issue");
      expect(issueEntities).toHaveLength(1);
      expect(issueEntities[0].externalId).toBe("issue-10");
    });

    it("extracts cross-reference relations from issue body", async () => {
      const issue = sampleIssue({
        body: "Related to #5 and #12. Also see #5 again.",
      });

      crawler.setFetch(
        mockFetch({
          "/issues?": [issue],
          "/pulls?": [],
        }),
      );

      const result = await crawler.sync(null);
      const relations = result.entities[0].relations ?? [];
      // 2 cross-references + 2 user relations (authored_by + assigned_to)
      const crossRefs = relations.filter((r) => r.relationType === "references");
      expect(crossRefs).toHaveLength(2);
      expect(crossRefs[0]).toEqual({ targetExternalId: "issue-5", relationType: "references" });
      expect(crossRefs[1]).toEqual({ targetExternalId: "issue-12", relationType: "references" });
    });

    it("uses updatedSince cursor for incremental sync", async () => {
      let capturedUrl = "";
      crawler.setFetch(async (input: string | URL | Request) => {
        const url = typeof input === "string" ? input : input.toString();
        capturedUrl = url;
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      await crawler.sync({
        phase: "issues",
        issuesPage: 1,
        updatedSince: "2024-06-01T00:00:00Z",
      });

      expect(capturedUrl).toContain("since=2024-06-01T00%3A00%3A00Z");
    });

    it("adds draft/ready and merged tags to PRs", async () => {
      const draftPR = samplePR({ draft: true });
      const mergedPR = samplePR({
        number: 21,
        title: "Merged PR",
        merged: true,
        merged_at: "2024-01-05T00:00:00Z",
      });

      crawler.setFetch(
        mockFetch({
          "/issues?": [],
          "/pulls?": [draftPR, mergedPR],
          "/reviews?": [],
          "/check-runs?": { total_count: 0, check_runs: [] },
        }),
      );

      // Skip to pulls phase
      const result = await crawler.sync({ phase: "pulls", pullsPage: 1 });
      const draft = result.entities.find((e) => e.externalId === "pr-20");
      const merged = result.entities.find((e) => e.externalId === "pr-21");

      expect(draft?.tags).toContain("draft");
      expect(draft?.tags).not.toContain("ready");
      expect(merged?.tags).toContain("merged");
      expect(merged?.tags).toContain("ready");
    });

    it("stores state_reason for closed issues", async () => {
      const issue = sampleIssue({
        state: "closed",
        state_reason: "not_planned",
        closed_at: "2024-01-03T00:00:00Z",
      });

      crawler.setFetch(
        mockFetch({
          "/issues?": [issue],
          "/pulls?": [],
        }),
      );

      const result = await crawler.sync(null);
      expect(result.entities[0].data.stateReason).toBe("not_planned");
    });
  });

  describe("comments", () => {
    it("fetches comments for issues with comment count > 0", async () => {
      const issue = sampleIssue({ comments: 1 });
      const comment = sampleComment();

      crawler.setFetch(
        mockFetch({
          "/issues?": [issue],
          "/issues/10/comments?": [comment],
          "/pulls?": [],
        }),
      );

      const result = await crawler.sync(null);
      const comments = result.entities[0].data.comments as Array<{ id: number; body: string; user: { login: string } }>;
      expect(comments).toHaveLength(1);
      expect(comments[0].id).toBe(100);
      expect(comments[0].body).toBe("This looks great!");
      expect(comments[0].user.login).toBe("reviewer");
    });

    it("skips comment fetching when issue has 0 comments", async () => {
      const issue = sampleIssue({ comments: 0 });
      const urls: string[] = [];

      crawler.setFetch(async (input: string | URL | Request) => {
        const url = typeof input === "string" ? input : input.toString();
        urls.push(url);
        if (url.includes("/issues?")) {
          return new Response(JSON.stringify([issue]), { status: 200 });
        }
        if (url.includes("/pulls?")) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        return new Response("Not found", { status: 404 });
      });

      const result = await crawler.sync(null);
      expect(result.entities[0].data.comments).toEqual([]);
      // Should not have made a comments API call
      expect(urls.some((u) => u.includes("/comments"))).toBe(false);
    });

    it("includes comment reactions", async () => {
      const issue = sampleIssue({ comments: 1 });
      const comment = sampleComment({
        reactions: {
          total_count: 3,
          "+1": 2,
          "-1": 0,
          laugh: 1,
          hooray: 0,
          confused: 0,
          heart: 0,
          rocket: 0,
          eyes: 0,
        },
      });

      crawler.setFetch(
        mockFetch({
          "/issues?": [issue],
          "/issues/10/comments?": [comment],
          "/pulls?": [],
        }),
      );

      const result = await crawler.sync(null);
      const comments = result.entities[0].data.comments as Array<{ reactions: { total: number; "+1": number } | null }>;
      expect(comments[0].reactions).toBeTruthy();
      expect(comments[0].reactions!.total).toBe(3);
      expect(comments[0].reactions!["+1"]).toBe(2);
    });

    it("does not fetch comments when syncComments is disabled", async () => {
      const noCommentsCrawler = new GitHubCrawler();
      await noCommentsCrawler.initialize(
        { owner: "owner", repo: "repo", syncComments: false },
        { token: "ghp_test", owner: "owner", repo: "repo" },
      );

      const issue = sampleIssue({ comments: 5 });
      const urls: string[] = [];

      noCommentsCrawler.setFetch(async (input: string | URL | Request) => {
        const url = typeof input === "string" ? input : input.toString();
        urls.push(url);
        if (url.includes("/issues?")) {
          return new Response(JSON.stringify([issue]), { status: 200 });
        }
        if (url.includes("/pulls?")) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        return new Response("Not found", { status: 404 });
      });

      const result = await noCommentsCrawler.sync(null);
      expect(result.entities[0].data.comments).toEqual([]);
      expect(urls.some((u) => u.includes("/comments"))).toBe(false);
    });
  });

  describe("PR reviews and check runs", () => {
    it("fetches reviews for pull requests", async () => {
      const pr = samplePR();
      const review = sampleReview();

      crawler.setFetch(
        mockFetch({
          "/issues?": [],
          "/pulls?": [pr],
          "/pulls/20/reviews?": [review],
          "/check-runs?": { total_count: 0, check_runs: [] },
        }),
      );

      const result1 = await crawler.sync(null);
      const result2 = await crawler.sync(result1.nextCursor);

      const reviews = result2.entities[0].data.reviews as Array<{ id: number; state: string; user: { login: string } }>;
      expect(reviews).toHaveLength(1);
      expect(reviews[0].id).toBe(200);
      expect(reviews[0].state).toBe("APPROVED");
      expect(reviews[0].user.login).toBe("reviewer");
    });

    it("fetches check runs for pull requests", async () => {
      const pr = samplePR();

      crawler.setFetch(
        mockFetch({
          "/issues?": [],
          "/pulls?": [pr],
          "/reviews?": [],
          "/check-runs?": {
            total_count: 2,
            check_runs: [
              {
                id: 1,
                name: "CI Build",
                status: "completed",
                conclusion: "success",
                html_url: "https://github.com/owner/repo/runs/1",
                started_at: "2024-01-04T00:00:00Z",
                completed_at: "2024-01-04T00:05:00Z",
              },
              {
                id: 2,
                name: "Tests",
                status: "completed",
                conclusion: "failure",
                html_url: "https://github.com/owner/repo/runs/2",
                started_at: "2024-01-04T00:00:00Z",
                completed_at: "2024-01-04T00:10:00Z",
              },
            ],
          },
        }),
      );

      const result1 = await crawler.sync(null);
      const result2 = await crawler.sync(result1.nextCursor);

      const checks = result2.entities[0].data.checkRuns as Array<{ name: string; conclusion: string }>;
      expect(checks).toHaveLength(2);
      expect(checks[0].name).toBe("CI Build");
      expect(checks[0].conclusion).toBe("success");
      expect(checks[1].name).toBe("Tests");
      expect(checks[1].conclusion).toBe("failure");
    });

    it("does not fetch check runs when syncCheckStatuses is disabled", async () => {
      const noChecksCrawler = new GitHubCrawler();
      await noChecksCrawler.initialize(
        { owner: "owner", repo: "repo", syncCheckStatuses: false },
        { token: "ghp_test", owner: "owner", repo: "repo" },
      );

      const pr = samplePR();
      const urls: string[] = [];

      noChecksCrawler.setFetch(async (input: string | URL | Request) => {
        const url = typeof input === "string" ? input : input.toString();
        urls.push(url);
        if (url.includes("/issues?")) return new Response(JSON.stringify([]), { status: 200 });
        if (url.includes("/pulls?") && !url.includes("/pulls/")) return new Response(JSON.stringify([pr]), { status: 200 });
        if (url.includes("/reviews")) return new Response(JSON.stringify([]), { status: 200 });
        return new Response("Not found", { status: 404 });
      });

      const result1 = await noChecksCrawler.sync(null);
      const result2 = await noChecksCrawler.sync(result1.nextCursor);

      expect(result2.entities[0].data.checkRuns).toEqual([]);
      expect(urls.some((u) => u.includes("/check-runs"))).toBe(false);
    });
  });

  describe("validateCredentials", () => {
    it("returns true when API responds with 200", async () => {
      crawler.setFetch(async () => new Response("{}", { status: 200 }));
      const valid = await crawler.validateCredentials({
        token: "ghp_valid",
        owner: "owner",
        repo: "repo",
      });
      expect(valid).toBe(true);
    });

    it("returns false when API responds with 401", async () => {
      crawler.setFetch(async () => new Response("Unauthorized", { status: 401 }));
      const valid = await crawler.validateCredentials({
        token: "ghp_bad",
        owner: "owner",
        repo: "repo",
      });
      expect(valid).toBe(false);
    });

    it("returns false when fetch throws", async () => {
      crawler.setFetch(async () => {
        throw new Error("Network error");
      });
      const valid = await crawler.validateCredentials({
        token: "ghp_bad",
        owner: "owner",
        repo: "repo",
      });
      expect(valid).toBe(false);
    });
  });

  describe("pagination", () => {
    it("paginates when response has PER_PAGE items", async () => {
      // Create 100 issues to simulate a full page
      const fullPage = Array.from({ length: 100 }, (_, i) =>
        sampleIssue({ number: i + 1, title: `Issue ${i + 1}` }),
      );

      crawler.setFetch(
        mockFetch({
          "/issues?": fullPage,
          "/pulls?": [],
        }),
      );

      const result = await crawler.sync(null);
      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).toHaveProperty("issuesPage", 2);
      expect(result.nextCursor).toHaveProperty("phase", "issues");
    });
  });

  describe("openOnly mode", () => {
    let openOnlyCrawler: GitHubCrawler;

    beforeEach(async () => {
      openOnlyCrawler = new GitHubCrawler();
      await openOnlyCrawler.initialize(
        { owner: "owner", repo: "repo", openOnly: true },
        { token: "ghp_test", owner: "owner", repo: "repo" },
      );
    });

    it("fetches state=open instead of state=all", async () => {
      const urls: string[] = [];
      openOnlyCrawler.setFetch(async (input: string | URL | Request) => {
        const url = typeof input === "string" ? input : input.toString();
        urls.push(url);
        return new Response(JSON.stringify([]), { status: 200 });
      });

      await openOnlyCrawler.sync(null);

      const issuesUrl = urls.find((u) => u.includes("/issues?"));
      expect(issuesUrl).toContain("state=open");
      expect(issuesUrl).not.toContain("state=all");
    });

    it("does not use since parameter in openOnly mode", async () => {
      const urls: string[] = [];
      openOnlyCrawler.setFetch(async (input: string | URL | Request) => {
        const url = typeof input === "string" ? input : input.toString();
        urls.push(url);
        return new Response(JSON.stringify([]), { status: 200 });
      });

      // Even with updatedSince in cursor, openOnly should not use since
      await openOnlyCrawler.sync({
        phase: "issues",
        issuesPage: 1,
        updatedSince: "2024-06-01T00:00:00Z",
      });

      const issuesUrl = urls.find((u) => u.includes("/issues?"));
      expect(issuesUrl).not.toContain("since=");
    });

    it("stores knownOpenIds in cursor after sync completes", async () => {
      const issue = sampleIssue({ number: 10 });
      openOnlyCrawler.setFetch(
        mockFetch({
          "/issues?": [issue],
          "/pulls?": [],
          "/users/testuser": sampleUserProfile(),
          "/users/dev1": sampleUserProfile({ login: "dev1" }),
        }),
      );

      // Issues phase
      let r = await openOnlyCrawler.sync(null);
      expect(r.hasMore).toBe(true);
      // Pulls phase (empty), then users
      r = await openOnlyCrawler.sync(r.nextCursor);
      expect(r.hasMore).toBe(true);
      // Users phase
      r = await openOnlyCrawler.sync(r.nextCursor);
      expect(r.hasMore).toBe(false);

      const cursor = r.nextCursor as { knownOpenIds?: string[] };
      expect(cursor.knownOpenIds).toContain("issue-10");
    });

    it("returns deletedExternalIds for items no longer open", async () => {
      // First sync: issues 10 and 20 are open
      openOnlyCrawler.setFetch(
        mockFetch({
          "/issues?": [sampleIssue({ number: 10 }), sampleIssue({ number: 20 })],
          "/pulls?": [],
          "/users/testuser": sampleUserProfile(),
          "/users/dev1": sampleUserProfile({ login: "dev1" }),
        }),
      );

      let r = await openOnlyCrawler.sync(null);
      r = await openOnlyCrawler.sync(r.nextCursor); // pulls phase
      r = await openOnlyCrawler.sync(r.nextCursor); // users phase
      const firstCursor = r.nextCursor as { knownOpenIds: string[] };
      expect(firstCursor.knownOpenIds).toEqual(["issue-10", "issue-20"]);
      expect(r.deletedExternalIds).toEqual([]); // No previous known IDs to compare against

      // Second sync: only issue 10 is still open (20 was closed)
      openOnlyCrawler.setFetch(
        mockFetch({
          "/issues?": [sampleIssue({ number: 10 })],
          "/pulls?": [],
          "/users/testuser": sampleUserProfile(),
          "/users/dev1": sampleUserProfile({ login: "dev1" }),
        }),
      );

      let r2 = await openOnlyCrawler.sync({
        ...firstCursor,
        phase: "issues",
        issuesPage: 1,
      });
      r2 = await openOnlyCrawler.sync(r2.nextCursor); // pulls phase
      r2 = await openOnlyCrawler.sync(r2.nextCursor); // users phase

      expect(r2.deletedExternalIds).toEqual(["issue-20"]);
      const secondCursor = r2.nextCursor as { knownOpenIds: string[] };
      expect(secondCursor.knownOpenIds).toEqual(["issue-10"]);
    });

    it("tracks PR IDs in knownOpenIds too", async () => {
      openOnlyCrawler.setFetch(
        mockFetch({
          "/issues?": [sampleIssue({ number: 5 })],
          "/pulls?": [samplePR({ number: 15 })],
          "/reviews?": [],
          "/check-runs?": { total_count: 0, check_runs: [] },
          "/users/testuser": sampleUserProfile(),
          "/users/dev1": sampleUserProfile({ login: "dev1" }),
        }),
      );

      let r = await openOnlyCrawler.sync(null);
      r = await openOnlyCrawler.sync(r.nextCursor); // pulls phase
      r = await openOnlyCrawler.sync(r.nextCursor); // users phase

      const cursor = r.nextCursor as { knownOpenIds: string[] };
      expect(cursor.knownOpenIds).toContain("issue-5");
      expect(cursor.knownOpenIds).toContain("pr-15");
    });

    it("does not set updatedSince in openOnly cursor", async () => {
      openOnlyCrawler.setFetch(
        mockFetch({
          "/issues?": [sampleIssue()],
          "/pulls?": [],
          "/users/testuser": sampleUserProfile(),
          "/users/dev1": sampleUserProfile({ login: "dev1" }),
        }),
      );

      let r = await openOnlyCrawler.sync(null);
      r = await openOnlyCrawler.sync(r.nextCursor); // pulls
      r = await openOnlyCrawler.sync(r.nextCursor); // users

      const cursor = r.nextCursor as { updatedSince?: string };
      expect(cursor.updatedSince).toBeUndefined();
    });
  });

  describe("maxEntities", () => {
    it("stops after reaching the limit within a single page", async () => {
      const maxCrawler = new GitHubCrawler();
      await maxCrawler.initialize(
        { owner: "owner", repo: "repo", maxEntities: 2 },
        { token: "ghp_test", owner: "owner", repo: "repo" },
      );

      const issues = [
        sampleIssue({ number: 1, title: "Issue 1" }),
        sampleIssue({ number: 2, title: "Issue 2" }),
        sampleIssue({ number: 3, title: "Issue 3" }),
        sampleIssue({ number: 4, title: "Issue 4" }),
      ];

      maxCrawler.setFetch(
        mockFetch({
          "/issues?": issues,
          "/pulls?": [],
        }),
      );

      const result = await maxCrawler.sync(null);
      expect(result.entities).toHaveLength(2);
      expect(result.hasMore).toBe(false);
    });

    it("stops across multiple phases (issues + pulls + users)", async () => {
      const maxCrawler = new GitHubCrawler();
      await maxCrawler.initialize(
        { owner: "owner", repo: "repo", maxEntities: 3 },
        { token: "ghp_test", owner: "owner", repo: "repo" },
      );

      maxCrawler.setFetch(
        mockFetch({
          "/issues?": [
            sampleIssue({ number: 1, title: "Issue 1" }),
            sampleIssue({ number: 2, title: "Issue 2" }),
          ],
          "/pulls?": [],
          "/users/testuser": sampleUserProfile(),
          "/users/dev1": sampleUserProfile({ login: "dev1" }),
        }),
      );

      // Issues: 2 entities
      const r1 = await maxCrawler.sync(null);
      expect(r1.entities).toHaveLength(2);
      expect(r1.hasMore).toBe(true);

      // Pulls: empty, transitions to users
      const r2 = await maxCrawler.sync(r1.nextCursor);
      expect(r2.hasMore).toBe(true);

      // Users: limit 3, already 2 fetched, so at most 1 user
      const r3 = await maxCrawler.sync(r2.nextCursor);
      expect(r3.entities.length).toBeLessThanOrEqual(1);
      expect(r3.hasMore).toBe(false);
    });

    it("stops mid-phase when limit is reached across issues and pulls", async () => {
      const maxCrawler = new GitHubCrawler();
      await maxCrawler.initialize(
        { owner: "owner", repo: "repo", maxEntities: 3 },
        { token: "ghp_test", owner: "owner", repo: "repo" },
      );

      maxCrawler.setFetch(
        mockFetch({
          "/issues?": [
            sampleIssue({ number: 1, title: "Issue 1" }),
            sampleIssue({ number: 2, title: "Issue 2" }),
          ],
          "/pulls?": [
            samplePR({ number: 10, title: "PR 10" }),
            samplePR({ number: 11, title: "PR 11" }),
          ],
          "/reviews?": [],
          "/check-runs?": { total_count: 0, check_runs: [] },
        }),
      );

      // Issues phase: 2 entities (under limit of 3)
      const r1 = await maxCrawler.sync(null);
      expect(r1.entities).toHaveLength(2);
      expect(r1.hasMore).toBe(true);

      // Pulls phase: has 2 PRs but only 1 more allowed (limit=3, fetched=2)
      const r2 = await maxCrawler.sync(r1.nextCursor);
      expect(r2.entities).toHaveLength(1);
      expect(r2.hasMore).toBe(false);
    });

    it("works with --max flag passed via sync command (maxEntities in config)", async () => {
      const maxCrawler = new GitHubCrawler();
      // Simulates what happens when sync --max 1 is used
      await maxCrawler.initialize(
        { owner: "owner", repo: "repo", maxEntities: 1 },
        { token: "ghp_test", owner: "owner", repo: "repo" },
      );

      maxCrawler.setFetch(
        mockFetch({
          "/issues?": [
            sampleIssue({ number: 1, title: "Issue 1" }),
            sampleIssue({ number: 2, title: "Issue 2" }),
          ],
          "/pulls?": [],
        }),
      );

      const result = await maxCrawler.sync(null);
      expect(result.entities).toHaveLength(1);
      expect(result.entities[0].externalId).toBe("issue-1");
      expect(result.hasMore).toBe(false);
    });
  });

  describe("per-type limits (maxIssues / maxPullRequests)", () => {
    it("limits issues independently with maxIssues", async () => {
      const limitCrawler = new GitHubCrawler();
      await limitCrawler.initialize(
        { owner: "owner", repo: "repo", maxIssues: 1 },
        { token: "ghp_test", owner: "owner", repo: "repo" },
      );

      limitCrawler.setFetch(
        mockFetch({
          "/issues?": [
            sampleIssue({ number: 1, title: "Issue 1" }),
            sampleIssue({ number: 2, title: "Issue 2" }),
            sampleIssue({ number: 3, title: "Issue 3" }),
          ],
          "/pulls?": [samplePR({ number: 10 })],
          "/reviews?": [],
          "/check-runs?": { total_count: 0, check_runs: [] },
          "/users/testuser": sampleUserProfile(),
          "/users/dev1": sampleUserProfile({ login: "dev1" }),
        }),
      );

      // Issues phase: 3 available but maxIssues=1
      const r1 = await limitCrawler.sync(null);
      const issueEntities = r1.entities.filter((e) => e.entityType === "issue");
      expect(issueEntities).toHaveLength(1);

      // Pulls phase: should still fetch PR since maxPullRequests is not set
      const r2 = await limitCrawler.sync(r1.nextCursor);
      const prEntities = r2.entities.filter((e) => e.entityType === "pull_request");
      expect(prEntities).toHaveLength(1);
    });

    it("limits PRs independently with maxPullRequests", async () => {
      const limitCrawler = new GitHubCrawler();
      await limitCrawler.initialize(
        { owner: "owner", repo: "repo", maxPullRequests: 1 },
        { token: "ghp_test", owner: "owner", repo: "repo" },
      );

      limitCrawler.setFetch(
        mockFetch({
          "/issues?": [sampleIssue({ number: 1 })],
          "/pulls?": [
            samplePR({ number: 10, title: "PR 10" }),
            samplePR({ number: 11, title: "PR 11" }),
          ],
          "/reviews?": [],
          "/check-runs?": { total_count: 0, check_runs: [] },
          "/users/testuser": sampleUserProfile(),
          "/users/dev1": sampleUserProfile({ login: "dev1" }),
        }),
      );

      // Issues phase: 1 issue (no limit)
      const r1 = await limitCrawler.sync(null);
      expect(r1.entities.filter((e) => e.entityType === "issue")).toHaveLength(1);

      // Pulls phase: 2 available but maxPullRequests=1
      const r2 = await limitCrawler.sync(r1.nextCursor);
      expect(r2.entities.filter((e) => e.entityType === "pull_request")).toHaveLength(1);
    });

    it("applies both per-type and global limits", async () => {
      const limitCrawler = new GitHubCrawler();
      await limitCrawler.initialize(
        { owner: "owner", repo: "repo", maxIssues: 2, maxPullRequests: 2, maxEntities: 3 },
        { token: "ghp_test", owner: "owner", repo: "repo" },
      );

      limitCrawler.setFetch(
        mockFetch({
          "/issues?": [
            sampleIssue({ number: 1 }),
            sampleIssue({ number: 2 }),
            sampleIssue({ number: 3 }),
          ],
          "/pulls?": [
            samplePR({ number: 10 }),
            samplePR({ number: 11 }),
          ],
          "/reviews?": [],
          "/check-runs?": { total_count: 0, check_runs: [] },
        }),
      );

      // Issues: maxIssues=2, so gets 2
      const r1 = await limitCrawler.sync(null);
      expect(r1.entities).toHaveLength(2);

      // Pulls: maxPullRequests=2 but global limit=3 and already fetched 2, so only 1 PR
      const r2 = await limitCrawler.sync(r1.nextCursor);
      expect(r2.entities).toHaveLength(1);
      expect(r2.hasMore).toBe(false);
    });
  });

  describe("user entities", () => {
    it("collects and syncs user profiles from issues", async () => {
      crawler.setFetch(
        mockFetch({
          "/issues?": [sampleIssue({ number: 1 })],
          "/pulls?": [],
          "/users/testuser": sampleUserProfile(),
          "/users/dev1": sampleUserProfile({ login: "dev1", name: "Dev One" }),
        }),
      );

      // Issues
      let r = await crawler.sync(null);
      expect(r.hasMore).toBe(true);
      // Pulls (empty)
      r = await crawler.sync(r.nextCursor);
      expect(r.hasMore).toBe(true);
      expect(r.nextCursor).toHaveProperty("phase", "users");

      // Users phase
      r = await crawler.sync(r.nextCursor);
      expect(r.hasMore).toBe(false);

      const users = r.entities.filter((e) => e.entityType === "user");
      expect(users.length).toBeGreaterThanOrEqual(1);

      const testuser = users.find((u) => u.externalId === "user-testuser");
      expect(testuser).toBeTruthy();
      expect(testuser!.title).toBe("Test User");
      expect(testuser!.data.login).toBe("testuser");
      expect(testuser!.data.bio).toBe("Full-stack developer");
      expect(testuser!.data.avatarUrl).toBe("https://avatars.githubusercontent.com/u/1?v=4");
    });

    it("creates user relations on issues", async () => {
      crawler.setFetch(
        mockFetch({
          "/issues?": [sampleIssue({ number: 1 })],
          "/pulls?": [],
          "/users/testuser": sampleUserProfile(),
          "/users/dev1": sampleUserProfile({ login: "dev1" }),
        }),
      );

      const r = await crawler.sync(null);
      const issue = r.entities.find((e) => e.entityType === "issue");
      const relations = issue?.relations ?? [];
      expect(relations.some((r) => r.targetExternalId === "user-testuser" && r.relationType === "authored_by")).toBe(true);
      expect(relations.some((r) => r.targetExternalId === "user-dev1" && r.relationType === "assigned_to")).toBe(true);
    });

    it("deduplicates users across issues and PRs", async () => {
      // Both the issue and PR have the same author (testuser)
      crawler.setFetch(
        mockFetch({
          "/issues?": [sampleIssue({ number: 1 })],
          "/pulls?": [samplePR({ number: 10 })],
          "/reviews?": [],
          "/check-runs?": { total_count: 0, check_runs: [] },
          "/users/testuser": sampleUserProfile(),
          "/users/dev1": sampleUserProfile({ login: "dev1" }),
        }),
      );

      let r = await crawler.sync(null); // issues
      r = await crawler.sync(r.nextCursor); // pulls
      r = await crawler.sync(r.nextCursor); // users

      const users = r.entities.filter((e) => e.entityType === "user");
      const logins = users.map((u) => u.data.login);
      // testuser appears in both issue and PR but should only be fetched once
      expect(logins.filter((l) => l === "testuser")).toHaveLength(1);
    });
  });
});
