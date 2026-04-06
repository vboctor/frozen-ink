import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { spawnSync } from "child_process";
import { GitCrawler } from "../crawler";

let repoDir: string;
let crawler: GitCrawler;

function git(...args: string[]): string {
  const result = spawnSync("git", args, {
    cwd: repoDir,
    encoding: "utf-8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test Author",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test Author",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  });
  if (result.status !== 0) {
    throw new Error(`git ${args[0]} failed: ${result.stderr}`);
  }
  return result.stdout;
}

function writeFile(name: string, content: string): void {
  const fullPath = join(repoDir, name);
  const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(fullPath, content);
}

function commit(message: string): string {
  git("add", "-A");
  git("commit", "-m", message);
  return git("rev-parse", "HEAD").trim();
}

beforeEach(() => {
  repoDir = join(
    tmpdir(),
    `git-crawler-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(repoDir, { recursive: true });
  git("init");
  git("symbolic-ref", "HEAD", "refs/heads/main");
  git("config", "user.name", "Test Author");
  git("config", "user.email", "test@example.com");

  crawler = new GitCrawler();
});

afterEach(() => {
  rmSync(repoDir, { recursive: true, force: true });
});

describe("GitCrawler", () => {
  it("has correct metadata", () => {
    expect(crawler.metadata.type).toBe("git");
    expect(crawler.metadata.displayName).toBe("Git Repository");
  });

  it("validates a valid git repo", async () => {
    writeFile("readme.md", "# Hello");
    commit("Initial commit");
    const valid = await crawler.validateCredentials({ repoPath: repoDir });
    expect(valid).toBe(true);
  });

  it("rejects non-git directory", async () => {
    const dir = join(tmpdir(), `not-git-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const valid = await crawler.validateCredentials({ repoPath: dir });
    expect(valid).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects nonexistent path", async () => {
    const valid = await crawler.validateCredentials({
      repoPath: "/nonexistent/path",
    });
    expect(valid).toBe(false);
  });

  it("syncs a single commit", async () => {
    writeFile("readme.md", "# Hello");
    const hash = commit("Initial commit");

    await crawler.initialize(
      { repoPath: repoDir },
      { repoPath: repoDir },
    );
    const result = await crawler.sync(null);

    const commits = result.entities.filter((e) => e.entityType === "commit");
    expect(commits.length).toBe(1);
    expect(commits[0].title).toBe("Initial commit");
    expect(commits[0].data.hash).toBe(hash);
    expect(commits[0].data.author).toBe("Test Author");
    expect(commits[0].data.authorEmail).toBe("test@example.com");
    expect((commits[0].data.parents as string[]).length).toBe(0);
  });

  it("syncs multiple commits with parent links", async () => {
    writeFile("file.txt", "v1");
    const hash1 = commit("First commit");
    writeFile("file.txt", "v2");
    const hash2 = commit("Second commit");

    await crawler.initialize(
      { repoPath: repoDir },
      { repoPath: repoDir },
    );
    const result = await crawler.sync(null);

    const commits = result.entities.filter((e) => e.entityType === "commit");
    expect(commits.length).toBe(2);

    const second = commits.find((e) => e.data.hash === hash2);
    expect(second).toBeDefined();
    expect((second!.data.parents as string[])).toContain(hash1);

    const parentDetails = second!.data.parentDetails as Array<{
      hash: string;
      shortHash: string;
      subject: string;
    }>;
    expect(parentDetails[0].subject).toBe("First commit");
  });

  it("detects file additions, modifications, and deletions", async () => {
    writeFile("added.txt", "new file");
    commit("Add file");
    writeFile("added.txt", "modified");
    writeFile("another.txt", "another");
    commit("Modify and add");

    await crawler.initialize(
      { repoPath: repoDir },
      { repoPath: repoDir },
    );
    const result = await crawler.sync(null);

    const secondCommit = result.entities.find(
      (e) => e.entityType === "commit" && e.title === "Modify and add",
    );
    const files = secondCommit!.data.files as Array<{
      status: string;
      path: string;
      additions: number;
      deletions: number;
      binary: boolean;
    }>;
    expect(files.length).toBe(2);
    const modified = files.find((f) => f.path === "added.txt");
    expect(modified?.status).toBe("M");
    expect(modified?.binary).toBe(false);
    const added = files.find((f) => f.path === "another.txt");
    expect(added?.status).toBe("A");
  });

  it("detects binary files", async () => {
    // Create a binary file (PNG header with NUL bytes so git detects it as binary)
    const pngHeader = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
    ]);
    writeFileSync(join(repoDir, "image.png"), pngHeader);
    commit("Add image");

    await crawler.initialize(
      { repoPath: repoDir },
      { repoPath: repoDir },
    );
    const result = await crawler.sync(null);

    const imageCommit = result.entities.find(
      (e) => e.entityType === "commit" && e.title === "Add image",
    );
    const files = imageCommit!.data.files as Array<{
      status: string;
      path: string;
      binary: boolean;
    }>;
    const img = files.find((f) => f.path === "image.png");
    expect(img).toBeDefined();
    expect(img!.binary).toBe(true);
  });

  it("includes diffs when configured", async () => {
    writeFile("code.ts", 'console.log("hello");');
    commit("Add code");

    await crawler.initialize(
      { repoPath: repoDir, includeDiffs: true },
      { repoPath: repoDir },
    );
    const result = await crawler.sync(null);

    const addCommit = result.entities.find(
      (e) => e.entityType === "commit" && e.title === "Add code",
    );
    expect(addCommit!.data.diff).toBeDefined();
    expect((addCommit!.data.diff as string)).toContain("console.log");
  });

  it("excludes diffs by default", async () => {
    writeFile("code.ts", "const x = 1;");
    commit("Add code");

    await crawler.initialize(
      { repoPath: repoDir },
      { repoPath: repoDir },
    );
    const result = await crawler.sync(null);

    const addCommit = result.entities.find(
      (e) => e.entityType === "commit" && e.title === "Add code",
    );
    expect(addCommit!.data.diff).toBeUndefined();
  });

  it("includes binary image attachments when diffs enabled", async () => {
    const pngData = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
    ]);
    writeFileSync(join(repoDir, "logo.png"), pngData);
    commit("Add logo");

    await crawler.initialize(
      { repoPath: repoDir, includeDiffs: true },
      { repoPath: repoDir },
    );
    const result = await crawler.sync(null);

    const logoCommit = result.entities.find(
      (e) => e.entityType === "commit" && e.title === "Add logo",
    );
    expect(logoCommit!.attachments).toBeDefined();
    expect(logoCommit!.attachments!.length).toBe(1);
    expect(logoCommit!.attachments![0].mimeType).toBe("image/png");
    expect(logoCommit!.attachments![0].storagePath).toContain("attachments/git/");
    expect(logoCommit!.attachments![0].storagePath).toContain("logo.png");
  });

  it("syncs branches", async () => {
    writeFile("main.txt", "main content");
    commit("Main commit");
    git("checkout", "-b", "feature");
    writeFile("feature.txt", "feature content");
    commit("Feature commit");

    await crawler.initialize(
      { repoPath: repoDir },
      { repoPath: repoDir },
    );
    const result = await crawler.sync(null);

    const branches = result.entities.filter(
      (e) => e.entityType === "branch",
    );
    const branchNames = branches.map((b) => b.data.name);
    expect(branchNames).toContain("main");
    expect(branchNames).toContain("feature");
  });

  it("includes recent commits for branches", async () => {
    writeFile("file.txt", "v1");
    commit("First");
    writeFile("file.txt", "v2");
    commit("Second");

    await crawler.initialize(
      { repoPath: repoDir },
      { repoPath: repoDir },
    );
    const result = await crawler.sync(null);

    const main = result.entities.find(
      (e) => e.entityType === "branch" && e.data.name === "main",
    );
    const recent = main!.data.recentCommits as Array<{
      hash: string;
      subject: string;
    }>;
    expect(recent.length).toBe(2);
    expect(recent[0].subject).toBe("Second");
    expect(recent[1].subject).toBe("First");
  });

  it("syncs tags", async () => {
    writeFile("file.txt", "content");
    commit("Release commit");
    git("tag", "v1.0.0");

    await crawler.initialize(
      { repoPath: repoDir },
      { repoPath: repoDir },
    );
    const result = await crawler.sync(null);

    const tags = result.entities.filter((e) => e.entityType === "tag");
    expect(tags.length).toBe(1);
    expect(tags[0].title).toBe("v1.0.0");
  });

  it("syncs annotated tags with message", async () => {
    writeFile("file.txt", "content");
    commit("Release");
    git("tag", "-a", "v2.0.0", "-m", "Major release");

    await crawler.initialize(
      { repoPath: repoDir },
      { repoPath: repoDir },
    );
    const result = await crawler.sync(null);

    const tag = result.entities.find(
      (e) => e.entityType === "tag" && e.title === "v2.0.0",
    );
    expect(tag).toBeDefined();
    expect(tag!.data.annotated).toBe(true);
    expect(tag!.data.subject).toBe("Major release");
    expect(tag!.data.tagger).toBe("Test Author");
  });

  it("performs incremental sync for new commits", async () => {
    writeFile("file.txt", "v1");
    commit("First");

    await crawler.initialize(
      { repoPath: repoDir },
      { repoPath: repoDir },
    );
    const first = await crawler.sync(null);
    const firstCommits = first.entities.filter(
      (e) => e.entityType === "commit",
    );
    expect(firstCommits.length).toBe(1);

    // Add a new commit
    writeFile("file.txt", "v2");
    commit("Second");

    const second = await crawler.sync(first.nextCursor);
    const secondCommits = second.entities.filter(
      (e) => e.entityType === "commit",
    );
    // Only the new commit should appear
    expect(secondCommits.length).toBe(1);
    expect(secondCommits[0].title).toBe("Second");
  });

  it("detects deleted branches", async () => {
    writeFile("file.txt", "v1");
    commit("Initial");
    git("checkout", "-b", "temp-branch");
    writeFile("temp.txt", "temp");
    commit("Temp commit");
    git("checkout", "main");

    await crawler.initialize(
      { repoPath: repoDir },
      { repoPath: repoDir },
    );
    const first = await crawler.sync(null);

    // Delete the branch
    git("branch", "-D", "temp-branch");

    const second = await crawler.sync(first.nextCursor);
    expect(second.deletedExternalIds).toContain("branch:temp-branch");
  });

  it("detects deleted tags", async () => {
    writeFile("file.txt", "v1");
    commit("Initial");
    git("tag", "temp-tag");

    await crawler.initialize(
      { repoPath: repoDir },
      { repoPath: repoDir },
    );
    const first = await crawler.sync(null);

    // Delete the tag
    git("tag", "-d", "temp-tag");

    const second = await crawler.sync(first.nextCursor);
    expect(second.deletedExternalIds).toContain("tag:temp-tag");
  });

  it("handles empty repository gracefully", async () => {
    await crawler.initialize(
      { repoPath: repoDir },
      { repoPath: repoDir },
    );
    const result = await crawler.sync(null);
    expect(result.entities.length).toBe(0);
    expect(result.hasMore).toBe(false);
  });

  it("uses commit hash as contentHash (immutable)", async () => {
    writeFile("file.txt", "content");
    const hash = commit("Test commit");

    await crawler.initialize(
      { repoPath: repoDir },
      { repoPath: repoDir },
    );
    const result = await crawler.sync(null);
    const entity = result.entities.find(
      (e) => e.entityType === "commit",
    );
    expect(entity!.contentHash).toBe(hash);
  });

  it("generates tags for file change summary", async () => {
    writeFile("new.txt", "content");
    commit("Add file");

    await crawler.initialize(
      { repoPath: repoDir },
      { repoPath: repoDir },
    );
    const result = await crawler.sync(null);
    const entity = result.entities.find(
      (e) => e.entityType === "commit" && e.title === "Add file",
    );
    expect(entity!.tags).toContain("1 added");
  });
});
