import { describe, it, expect } from "bun:test";
import { GitHubTheme } from "../theme";
import type { ThemeRenderContext } from "@veecontext/core";

const theme = new GitHubTheme();

function makeIssueContext(overrides: Partial<ThemeRenderContext["entity"]> = {}): ThemeRenderContext {
  return {
    entity: {
      externalId: "issue-427",
      entityType: "issue",
      title: "Fix login bug",
      url: "https://github.com/acme/app/issues/427",
      tags: ["bug", "critical"],
      data: {
        number: 427,
        body: "Login fails when password contains special chars.\n\nRelated to #100 and #200.",
        state: "open",
        user: "octocat",
        userUrl: "https://github.com/octocat",
        assignees: ["alice", "bob"],
        labels: [
          { name: "bug", color: "d73a4a" },
          { name: "critical", color: "b60205" },
        ],
        milestone: "v2.0",
        milestoneNumber: 3,
        createdAt: "2024-01-15T10:00:00Z",
        updatedAt: "2024-01-16T14:30:00Z",
        closedAt: null,
      },
      ...overrides,
    },
    collectionName: "acme-app",
    crawlerType: "github",
  };
}

function makePRContext(overrides: Partial<ThemeRenderContext["entity"]> = {}): ThemeRenderContext {
  return {
    entity: {
      externalId: "pr-89",
      entityType: "pull_request",
      title: "feat: Add OAuth support",
      url: "https://github.com/acme/app/pull/89",
      tags: ["enhancement", "ready"],
      data: {
        number: 89,
        body: "Implements OAuth2 flow.\n\nCloses #50 and #51.",
        state: "open",
        user: "octocat",
        userUrl: "https://github.com/octocat",
        assignees: ["alice"],
        labels: [{ name: "enhancement", color: "a2eeef" }],
        milestone: "v2.0",
        head: "feat/oauth",
        headSha: "abc1234567890",
        base: "main",
        baseSha: "def0987654321",
        merged: false,
        mergedAt: null,
        draft: false,
        reviewComments: 3,
        createdAt: "2024-01-10T08:00:00Z",
        updatedAt: "2024-01-12T16:00:00Z",
        closedAt: null,
      },
      ...overrides,
    },
    collectionName: "acme-app",
    crawlerType: "github",
  };
}

describe("GitHubTheme", () => {
  describe("getFilePath", () => {
    it("returns issues path like issues/427-fix-login-bug.md", () => {
      const ctx = makeIssueContext();
      const path = theme.getFilePath(ctx);
      expect(path).toBe("issues/427-fix-login-bug.md");
    });

    it("returns pull-requests path like pull-requests/89-feat-add-oauth-support.md", () => {
      const ctx = makePRContext();
      const path = theme.getFilePath(ctx);
      expect(path).toBe("pull-requests/89-feat-add-oauth-support.md");
    });
  });

  describe("issue rendering", () => {
    it("renders frontmatter with title, state, labels as tags, assignees", () => {
      const ctx = makeIssueContext();
      const md = theme.render(ctx);

      expect(md).toContain("---");
      expect(md).toContain("title: Fix login bug");
      expect(md).toContain("type: issue");
      expect(md).toContain("number: 427");
      expect(md).toContain("state: open");
      expect(md).toContain('source: "https://github.com/acme/app/issues/427"');
      expect(md).toContain("- bug");
      expect(md).toContain("- critical");
      expect(md).toContain("- alice");
      expect(md).toContain("- bob");
    });

    it("renders issue title as H1", () => {
      const md = theme.render(makeIssueContext());
      expect(md).toContain("# Fix login bug");
    });

    it("renders metadata callout with author, assignees, milestone, labels", () => {
      const md = theme.render(makeIssueContext());
      expect(md).toContain("> [!info] Metadata");
      expect(md).toContain("**Author:** octocat");
      expect(md).toContain("**Assignees:** alice, bob");
      expect(md).toContain("**Milestone:** v2.0");
      expect(md).toContain("**Labels:** bug, critical");
    });

    it("renders body content", () => {
      const md = theme.render(makeIssueContext());
      expect(md).toContain("Login fails when password contains special chars.");
    });

    it("renders wikilinks for related issues", () => {
      const md = theme.render(makeIssueContext());
      expect(md).toContain("> [!link] Related Issues");
      expect(md).toContain("[[issues/100|#100]]");
      expect(md).toContain("[[issues/200|#200]]");
    });

    it("omits related issues section when no refs in body", () => {
      const ctx = makeIssueContext({
        data: {
          ...makeIssueContext().entity.data,
          body: "No references here.",
        },
      });
      const md = theme.render(ctx);
      expect(md).not.toContain("Related Issues");
    });

    it("includes milestone and closed date in frontmatter when present", () => {
      const ctx = makeIssueContext({
        data: {
          ...makeIssueContext().entity.data,
          state: "closed",
          closedAt: "2024-01-20T10:00:00Z",
        },
      });
      const md = theme.render(ctx);
      expect(md).toContain("milestone: v2.0");
      expect(md).toContain('closed: "2024-01-20T10:00:00Z"');
    });
  });

  describe("pull request rendering", () => {
    it("renders PR frontmatter with review status, branch info, draft/merged flags", () => {
      const md = theme.render(makePRContext());
      expect(md).toContain("type: pull_request");
      expect(md).toContain("number: 89");
      expect(md).toContain("review_status: pending");
      expect(md).toContain("head: feat/oauth");
      expect(md).toContain("base: main");
      expect(md).toContain("draft: false");
      expect(md).toContain("merged: false");
    });

    it("renders branch info callout with head/base refs and SHAs", () => {
      const md = theme.render(makePRContext());
      expect(md).toContain("> [!git] Branch Info");
      expect(md).toContain("**Head:** `feat/oauth` (abc1234)");
      expect(md).toContain("**Base:** `main` (def0987)");
      expect(md).toContain("**Review comments:** 3");
    });

    it("renders linked issues as wikilinks", () => {
      const md = theme.render(makePRContext());
      expect(md).toContain("> [!link] Linked Issues");
      expect(md).toContain("[[issues/50|#50]]");
      expect(md).toContain("[[issues/51|#51]]");
    });

    it("shows merged review status when PR is merged", () => {
      const ctx = makePRContext({
        data: {
          ...makePRContext().entity.data,
          state: "closed",
          merged: true,
          mergedAt: "2024-01-15T12:00:00Z",
        },
      });
      const md = theme.render(ctx);
      expect(md).toContain("review_status: merged");
      expect(md).toContain("**Merged at:** 2024-01-15T12:00:00Z");
    });

    it("shows draft review status for draft PRs", () => {
      const ctx = makePRContext({
        data: {
          ...makePRContext().entity.data,
          draft: true,
        },
      });
      const md = theme.render(ctx);
      expect(md).toContain("review_status: draft");
    });
  });
});
