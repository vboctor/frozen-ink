import { describe, it, expect, beforeEach } from "bun:test";
import { GitHubCrawler } from "../crawler";
import type {
  GitHubIssue,
  GitHubPullRequest,
  GitHubComment,
  GitHubReview,
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
      expect(result2.hasMore).toBe(false);
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
      expect(relations).toHaveLength(2);
      expect(relations[0]).toEqual({ targetExternalId: "issue-5", relationType: "references" });
      expect(relations[1]).toEqual({ targetExternalId: "issue-12", relationType: "references" });
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
});
