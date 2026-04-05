import { describe, it, expect } from "bun:test";
import { GitTheme } from "../theme";
import type { ThemeRenderContext } from "@veecontext/core";

const theme = new GitTheme();

function commitContext(overrides: Record<string, unknown> = {}): ThemeRenderContext {
  return {
    entity: {
      externalId: "commit:abc1234567890",
      entityType: "commit",
      title: overrides.subject as string ?? "Fix login bug",
      data: {
        hash: "abc1234567890abcdef1234567890abcdef123456",
        shortHash: "abc1234",
        author: "John Doe",
        authorEmail: "john@example.com",
        date: "2024-01-15T10:30:00+00:00",
        subject: "Fix login bug",
        body: "",
        parents: ["def5678901234567890abcdef1234567890abcdef"],
        parentDetails: [
          { hash: "def5678901234", shortHash: "def5678", subject: "Add auth module" },
        ],
        files: [
          { status: "M", path: "src/login.ts", additions: 10, deletions: 5, binary: false },
          { status: "A", path: "src/validate.ts", additions: 30, deletions: 0, binary: false },
        ],
        ...overrides,
      },
      tags: ["1 modified", "1 added"],
    },
    collectionName: "my-repo",
    crawlerType: "git",
  };
}

function branchContext(overrides: Record<string, unknown> = {}): ThemeRenderContext {
  return {
    entity: {
      externalId: "branch:main",
      entityType: "branch",
      title: "main",
      data: {
        name: "main",
        hash: "abc1234",
        isRemote: false,
        recentCommits: [
          { hash: "abc1234567890", shortHash: "abc1234", subject: "Fix login bug" },
          { hash: "def5678901234", shortHash: "def5678", subject: "Add auth module" },
        ],
        ...overrides,
      },
      tags: ["local"],
    },
    collectionName: "my-repo",
    crawlerType: "git",
  };
}

function tagContext(overrides: Record<string, unknown> = {}): ThemeRenderContext {
  return {
    entity: {
      externalId: "tag:v1.0.0",
      entityType: "tag",
      title: "v1.0.0",
      data: {
        name: "v1.0.0",
        objectHash: "aaa1234",
        targetHash: "abc1234",
        targetShortHash: "abc1234",
        targetSubject: "Fix login bug",
        tagger: "John Doe",
        date: "2024-01-15T10:30:00+00:00",
        subject: "Release 1.0.0",
        annotated: true,
        ...overrides,
      },
      tags: ["annotated"],
    },
    collectionName: "my-repo",
    crawlerType: "git",
  };
}

describe("GitTheme", () => {
  it("has correct crawlerType", () => {
    expect(theme.crawlerType).toBe("git");
  });

  // --- File paths ---

  it("generates commit file path with hash and slug", () => {
    const path = theme.getFilePath(commitContext());
    expect(path).toBe("commits/abc1234-fix-login-bug.md");
  });

  it("generates branch file path", () => {
    const path = theme.getFilePath(branchContext());
    expect(path).toBe("branches/main.md");
  });

  it("generates branch file path with safe name for remotes", () => {
    const ctx = branchContext({ name: "origin/feature/xyz" });
    ctx.entity.externalId = "branch:origin/feature/xyz";
    ctx.entity.title = "origin/feature/xyz";
    const path = theme.getFilePath(ctx);
    expect(path).toBe("branches/origin-feature-xyz.md");
  });

  it("generates tag file path", () => {
    const path = theme.getFilePath(tagContext());
    expect(path).toBe("tags/v1.0.0.md");
  });

  // --- Commit rendering ---

  it("renders commit with frontmatter", () => {
    const md = theme.render(commitContext());
    expect(md).toContain("---");
    expect(md).toContain("type: commit");
    expect(md).toContain("author: John Doe");
  });

  it("renders commit title as H1", () => {
    const md = theme.render(commitContext());
    expect(md).toContain("# Fix login bug");
  });

  it("renders commit info callout with author and date", () => {
    const md = theme.render(commitContext());
    expect(md).toContain("**Author:** John Doe <john@example.com>");
    expect(md).toContain("**Date:** 2024-01-15T10:30:00+00:00");
    expect(md).toContain("**Hash:** `abc1234`");
  });

  it("renders parent wikilinks", () => {
    const md = theme.render(commitContext());
    expect(md).toContain("[[commits/def5678-add-auth-module|def5678]]");
  });

  it("renders file changes callout", () => {
    const md = theme.render(commitContext());
    expect(md).toContain("Files Changed (2)");
    expect(md).toContain("**Modified** `src/login.ts` (+10, -5)");
    expect(md).toContain("**Added** `src/validate.ts` (+30)");
  });

  it("renders binary file indication", () => {
    const ctx = commitContext({
      files: [
        { status: "A", path: "image.png", additions: 0, deletions: 0, binary: true },
      ],
    });
    const md = theme.render(ctx);
    expect(md).toContain("*(binary)*");
  });

  it("renders diff section when present", () => {
    const ctx = commitContext({ diff: "+const x = 1;\n-const y = 2;" });
    const md = theme.render(ctx);
    expect(md).toContain("## Diff");
    expect(md).toContain("```diff");
    expect(md).toContain("+const x = 1;");
  });

  it("omits diff section when not present", () => {
    const md = theme.render(commitContext());
    expect(md).not.toContain("## Diff");
  });

  it("renders commit body when present", () => {
    const ctx = commitContext({ body: "This fixes the login validation.\n\nCloses #42" });
    const md = theme.render(ctx);
    expect(md).toContain("This fixes the login validation.");
    expect(md).toContain("Closes #42");
  });

  it("embeds image for binary image changes when diffs enabled", () => {
    const ctx = commitContext({
      files: [
        { status: "A", path: "assets/logo.png", additions: 0, deletions: 0, binary: true },
      ],
    });
    const md = theme.render(ctx);
    expect(md).toContain("![[git/abc1234/logo.png]]");
  });

  // --- Branch rendering ---

  it("renders branch with title", () => {
    const md = theme.render(branchContext());
    expect(md).toContain("# main");
  });

  it("renders branch tip wikilink", () => {
    const md = theme.render(branchContext());
    expect(md).toContain("[[commits/abc1234-fix-login-bug|abc1234]]");
  });

  it("renders branch recent commits as list", () => {
    const md = theme.render(branchContext());
    expect(md).toContain("## Recent Commits");
    expect(md).toContain("Fix login bug");
    expect(md).toContain("Add auth module");
  });

  it("renders branch type (local vs remote)", () => {
    const md = theme.render(branchContext());
    expect(md).toContain("**Type:** Local");

    const remoteMd = theme.render(branchContext({ isRemote: true }));
    expect(remoteMd).toContain("**Type:** Remote");
  });

  // --- Tag rendering ---

  it("renders tag with title", () => {
    const md = theme.render(tagContext());
    expect(md).toContain("# v1.0.0");
  });

  it("renders tag target wikilink", () => {
    const md = theme.render(tagContext());
    expect(md).toContain("[[commits/abc1234-fix-login-bug|abc1234]]");
  });

  it("renders tag type and tagger", () => {
    const md = theme.render(tagContext());
    expect(md).toContain("**Type:** Annotated");
    expect(md).toContain("**Tagger:** John Doe");
  });

  it("renders lightweight tag without tagger", () => {
    const ctx = tagContext({ annotated: false, tagger: "" });
    const md = theme.render(ctx);
    expect(md).toContain("**Type:** Lightweight");
    expect(md).not.toContain("**Tagger:**");
  });

  it("renders tag message", () => {
    const md = theme.render(tagContext());
    expect(md).toContain("Release 1.0.0");
  });
});
