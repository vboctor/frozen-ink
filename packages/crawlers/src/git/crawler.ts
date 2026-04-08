import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { extname, basename } from "path";
import type {
  Crawler,
  CrawlerMetadata,
  CrawlerEntityData,
  SyncCursor,
  SyncResult,
} from "@veecontext/core";
import { createCryptoHasher } from "@veecontext/core";
import type {
  GitConfig,
  GitCredentials,
  GitCommitInfo,
  GitFileChange,
  GitBranchInfo,
  GitTagInfo,
} from "./types";

const IMAGE_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp", ".ico",
]);

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
};

interface GitSyncCursor extends SyncCursor {
  knownCommitHashes?: string[];
  knownBranches?: string[];
  knownTags?: string[];
}

function gitExec(repoPath: string, args: string[]): string {
  const result = spawnSync("git", ["-C", repoPath, ...args], {
    encoding: "utf-8",
    maxBuffer: 100 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && result.stderr) {
    throw new Error(`git ${args[0]} failed: ${result.stderr}`);
  }
  return result.stdout ?? "";
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

export class GitCrawler implements Crawler {
  metadata: CrawlerMetadata = {
    type: "git",
    displayName: "Git Repository",
    description:
      "Crawls a local Git repository capturing commits, branches, and tags",
    configSchema: {
      repoPath: {
        type: "string",
        required: true,
        description: "Path to the Git repository",
      },
      includeDiffs: {
        type: "boolean",
        default: false,
        description: "Include commit diffs in output",
      },
    },
    credentialFields: ["repoPath"],
  };

  private repoPath = "";
  private includeDiffs = false;

  async initialize(
    config: Record<string, unknown>,
    credentials: Record<string, unknown>,
  ): Promise<void> {
    const cfg = config as unknown as GitConfig;
    const creds = credentials as unknown as GitCredentials;
    this.repoPath = creds.repoPath || cfg.repoPath;
    this.includeDiffs = cfg.includeDiffs ?? false;
  }

  async sync(cursor: SyncCursor | null): Promise<SyncResult> {
    const c = (cursor as GitSyncCursor) ?? {};
    const knownCommits = new Set(c.knownCommitHashes ?? []);
    const knownBranches = new Set(c.knownBranches ?? []);
    const knownTags = new Set(c.knownTags ?? []);

    // Get current state
    const allHashes = this.getAllCommitHashes();
    const commitMap = this.parseCommitMetadata();
    const fileStatusMap = this.parseFileStatus();
    const numstatMap = this.parseNumstat();
    const branches = this.parseBranches();
    const tags = this.parseTags();

    // Merge file changes
    const fileChanges = this.mergeFileChanges(fileStatusMap, numstatMap);

    // Find new commits
    const newHashes = allHashes.filter((h) => !knownCommits.has(h));

    // Find deleted items
    const currentHashes = new Set(allHashes);
    const currentBranchNames = new Set(branches.map((b) => b.name));
    const currentTagNames = new Set(tags.map((t) => t.name));

    const deletedCommits = [...knownCommits].filter(
      (h) => !currentHashes.has(h),
    );
    const deletedBranches = [...knownBranches].filter(
      (b) => !currentBranchNames.has(b),
    );
    const deletedTags = [...knownTags].filter(
      (t) => !currentTagNames.has(t),
    );

    const deletedExternalIds = [
      ...deletedCommits.map((h) => `commit:${h}`),
      ...deletedBranches.map((b) => `branch:${b}`),
      ...deletedTags.map((t) => `tag:${t}`),
    ];

    // Build entities
    const entities: CrawlerEntityData[] = [];

    // New commit entities
    for (const hash of newHashes) {
      const commit = commitMap.get(hash);
      if (!commit) continue;
      const files = fileChanges.get(hash) ?? [];
      entities.push(this.buildCommitEntity(commit, files, commitMap));
    }

    // Branch entities (always refreshed — tip may have moved)
    for (const branch of branches) {
      entities.push(this.buildBranchEntity(branch, commitMap));
    }

    // Tag entities (always refreshed to detect new tags)
    for (const tag of tags) {
      entities.push(this.buildTagEntity(tag, commitMap));
    }

    return {
      entities,
      nextCursor: {
        knownCommitHashes: allHashes,
        knownBranches: branches.map((b) => b.name),
        knownTags: tags.map((t) => t.name),
      },
      hasMore: false,
      deletedExternalIds,
    };
  }

  async validateCredentials(
    credentials: Record<string, unknown>,
  ): Promise<boolean> {
    const creds = credentials as unknown as GitCredentials;
    if (!creds.repoPath || !existsSync(creds.repoPath)) return false;
    try {
      gitExec(creds.repoPath, ["rev-parse", "--git-dir"]);
      return true;
    } catch {
      return false;
    }
  }

  async dispose(): Promise<void> {}

  // --- Git data parsing ---

  private getAllCommitHashes(): string[] {
    try {
      const output = gitExec(this.repoPath, ["rev-list", "--all"]);
      return output.trim().split("\n").filter(Boolean);
    } catch {
      return [];
    }
  }

  private parseCommitMetadata(): Map<string, GitCommitInfo> {
    const map = new Map<string, GitCommitInfo>();
    try {
      const output = gitExec(this.repoPath, [
        "log",
        "--all",
        `--format=%H%x00%h%x00%an%x00%ae%x00%aI%x00%P%x00%s%x00%b%x1e`,
      ]);
      const blocks = output.split("\x1e").filter((s) => s.trim());
      for (const block of blocks) {
        const fields = block.split("\x00");
        if (fields.length < 7) continue;
        const hash = fields[0].trim();
        map.set(hash, {
          hash,
          shortHash: fields[1],
          author: fields[2],
          authorEmail: fields[3],
          date: fields[4],
          parents: fields[5] ? fields[5].split(" ").filter(Boolean) : [],
          subject: fields[6],
          body: (fields[7] ?? "").trim(),
        });
      }
    } catch {
      // empty repo
    }
    return map;
  }

  private parseFileStatus(): Map<string, Array<{ status: string; path: string; oldPath?: string }>> {
    const map = new Map<string, Array<{ status: string; path: string; oldPath?: string }>>();
    try {
      const output = gitExec(this.repoPath, [
        "log", "--all", "--format=COMMIT_SEP%H", "--name-status",
      ]);
      const blocks = output.split("COMMIT_SEP").filter((s) => s.trim());
      for (const block of blocks) {
        const lines = block.trim().split("\n");
        const hash = lines[0].trim();
        const entries: Array<{ status: string; path: string; oldPath?: string }> = [];
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          const parts = line.split("\t");
          if (parts.length < 2) continue;
          const statusCode = parts[0];
          if (statusCode.startsWith("R") || statusCode.startsWith("C")) {
            entries.push({
              status: statusCode[0],
              oldPath: parts[1],
              path: parts[2] ?? parts[1],
            });
          } else {
            entries.push({ status: statusCode[0], path: parts[1] });
          }
        }
        map.set(hash, entries);
      }
    } catch {
      // empty repo
    }
    return map;
  }

  private parseNumstat(): Map<string, Map<string, { additions: number; deletions: number; binary: boolean }>> {
    const map = new Map<string, Map<string, { additions: number; deletions: number; binary: boolean }>>();
    try {
      const output = gitExec(this.repoPath, [
        "log", "--all", "--format=COMMIT_SEP%H", "--numstat",
      ]);
      const blocks = output.split("COMMIT_SEP").filter((s) => s.trim());
      for (const block of blocks) {
        const lines = block.trim().split("\n");
        const hash = lines[0].trim();
        const stats = new Map<string, { additions: number; deletions: number; binary: boolean }>();
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          const parts = line.split("\t");
          if (parts.length < 3) continue;
          const binary = parts[0] === "-" && parts[1] === "-";
          // Handle renames: "old => new" or "{old => new}/path"
          let path = parts[2];
          if (path.includes(" => ")) {
            const match = path.match(/(?:\{[^}]*\s=>\s)?([^}]+)\}?$/);
            if (match) path = path.replace(/\{[^}]*\s=>\s([^}]+)\}/, "$1");
          }
          stats.set(path, {
            additions: binary ? 0 : parseInt(parts[0], 10),
            deletions: binary ? 0 : parseInt(parts[1], 10),
            binary,
          });
        }
        map.set(hash, stats);
      }
    } catch {
      // empty repo
    }
    return map;
  }

  private mergeFileChanges(
    statusMap: Map<string, Array<{ status: string; path: string; oldPath?: string }>>,
    numstatMap: Map<string, Map<string, { additions: number; deletions: number; binary: boolean }>>,
  ): Map<string, GitFileChange[]> {
    const merged = new Map<string, GitFileChange[]>();
    for (const [hash, entries] of statusMap) {
      const stats = numstatMap.get(hash);
      const files: GitFileChange[] = entries.map((e) => {
        const s = stats?.get(e.path) ?? stats?.get(e.oldPath ?? "") ?? {
          additions: 0, deletions: 0, binary: false,
        };
        return {
          status: e.status,
          path: e.path,
          oldPath: e.oldPath,
          additions: s.additions,
          deletions: s.deletions,
          binary: s.binary,
        };
      });
      merged.set(hash, files);
    }
    return merged;
  }

  private parseBranches(): GitBranchInfo[] {
    try {
      const output = gitExec(this.repoPath, [
        "for-each-ref",
        "--format=%(refname:short)\t%(objectname:short)",
        "refs/heads/",
        "refs/remotes/",
      ]);
      return output.trim().split("\n").filter(Boolean).map((line) => {
        const [name, hash] = line.split("\t");
        return {
          name,
          hash,
          isRemote: name.includes("/"),
        };
      });
    } catch {
      return [];
    }
  }

  private parseTags(): GitTagInfo[] {
    try {
      const output = gitExec(this.repoPath, [
        "for-each-ref",
        "--format=%(refname:short)\t%(objectname:short)\t%(*objectname:short)\t%(taggername)\t%(creatordate:iso-strict)\t%(subject)",
        "refs/tags/",
      ]);
      return output.trim().split("\n").filter(Boolean).map((line) => {
        const fields = line.split("\t");
        const annotated = !!fields[3]; // has tagger
        return {
          name: fields[0],
          objectHash: fields[1],
          targetHash: fields[2] || fields[1], // lightweight tags: target = object
          tagger: fields[3] ?? "",
          date: fields[4] ?? "",
          subject: fields[5] ?? "",
          annotated,
        };
      });
    } catch {
      return [];
    }
  }

  private getBranchCommits(
    branchName: string,
    commitMap: Map<string, GitCommitInfo>,
  ): Array<{ hash: string; shortHash: string; subject: string }> {
    try {
      const output = gitExec(this.repoPath, [
        "log", branchName, "-20", "--format=%H\t%s",
      ]);
      return output.trim().split("\n").filter(Boolean).map((line) => {
        const idx = line.indexOf("\t");
        const hash = line.slice(0, idx);
        const subject = line.slice(idx + 1);
        const info = commitMap.get(hash);
        return {
          hash,
          shortHash: info?.shortHash ?? hash.slice(0, 7),
          subject: subject || info?.subject || "",
        };
      });
    } catch {
      return [];
    }
  }

  getCommitDiff(hash: string): string {
    try {
      const output = gitExec(this.repoPath, [
        "diff-tree", "-p", "--root", "--no-commit-id", hash,
      ]);
      // Truncate very large diffs
      if (output.length > 200_000) {
        return output.slice(0, 200_000) + "\n\n... (diff truncated, exceeded 200KB)";
      }
      return output;
    } catch {
      return "";
    }
  }

  private getFileAtCommit(hash: string, path: string): Buffer | null {
    try {
      const result = spawnSync(
        "git", ["-C", this.repoPath, "show", `${hash}:${path}`],
        { maxBuffer: 10 * 1024 * 1024 },
      );
      if (result.status !== 0) return null;
      return Buffer.from(result.stdout);
    } catch {
      return null;
    }
  }

  // --- Entity building ---

  private buildCommitEntity(
    commit: GitCommitInfo,
    files: GitFileChange[],
    commitMap: Map<string, GitCommitInfo>,
  ): CrawlerEntityData {
    const parentDetails = commit.parents.map((h) => {
      const p = commitMap.get(h);
      return {
        hash: h,
        shortHash: p?.shortHash ?? h.slice(0, 7),
        subject: p?.subject ?? "",
      };
    });

    const diff = this.includeDiffs ? this.getCommitDiff(commit.hash) : undefined;

    // Build binary image attachments when diffs enabled
    const attachments: CrawlerEntityData["attachments"] = [];
    if (this.includeDiffs) {
      for (const file of files) {
        if (!file.binary) continue;
        const ext = extname(file.path).toLowerCase();
        if (!IMAGE_EXTENSIONS.has(ext)) continue;
        if (file.status === "D") continue; // deleted — no image to show

        const content = this.getFileAtCommit(commit.hash, file.path);
        if (!content) continue;

        attachments.push({
          filename: basename(file.path),
          mimeType: MIME_TYPES[ext] || "application/octet-stream",
          content,
          storagePath: `attachments/git/${commit.shortHash}/${basename(file.path)}`,
        });
      }
    }

    return {
      externalId: `commit:${commit.hash}`,
      entityType: "commit",
      title: commit.subject,
      contentHash: commit.hash, // immutable
      data: {
        hash: commit.hash,
        shortHash: commit.shortHash,
        author: commit.author,
        authorEmail: commit.authorEmail,
        date: commit.date,
        subject: commit.subject,
        body: commit.body,
        parents: commit.parents,
        parentDetails,
        files,
        diff,
      },
      tags: this.buildCommitTags(files),
      attachments: attachments.length > 0 ? attachments : undefined,
    };
  }

  private buildCommitTags(files: GitFileChange[]): string[] {
    const tags: string[] = [];
    const added = files.filter((f) => f.status === "A").length;
    const modified = files.filter((f) => f.status === "M").length;
    const deleted = files.filter((f) => f.status === "D").length;
    if (added > 0) tags.push(`${added} added`);
    if (modified > 0) tags.push(`${modified} modified`);
    if (deleted > 0) tags.push(`${deleted} deleted`);
    if (files.some((f) => f.binary)) tags.push("binary");
    return tags;
  }

  private buildBranchEntity(
    branch: GitBranchInfo,
    commitMap: Map<string, GitCommitInfo>,
  ): CrawlerEntityData {
    const recentCommits = this.getBranchCommits(branch.name, commitMap);

    const hasher = createCryptoHasher("sha256");
    hasher.update(`${branch.name}:${branch.hash}:${recentCommits.length}`);
    const contentHash = hasher.digest("hex");

    return {
      externalId: `branch:${branch.name}`,
      entityType: "branch",
      title: branch.name,
      contentHash,
      data: {
        name: branch.name,
        hash: branch.hash,
        isRemote: branch.isRemote,
        recentCommits,
      },
      tags: [branch.isRemote ? "remote" : "local"],
    };
  }

  private buildTagEntity(
    tag: GitTagInfo,
    commitMap: Map<string, GitCommitInfo>,
  ): CrawlerEntityData {
    const target = commitMap.get(
      // targetHash from for-each-ref is short — find full hash
      [...commitMap.keys()].find((h) => h.startsWith(tag.targetHash)) ?? "",
    );

    const hasher = createCryptoHasher("sha256");
    hasher.update(`${tag.name}:${tag.objectHash}:${tag.subject}`);
    const contentHash = hasher.digest("hex");

    return {
      externalId: `tag:${tag.name}`,
      entityType: "tag",
      title: tag.name,
      contentHash,
      data: {
        name: tag.name,
        objectHash: tag.objectHash,
        targetHash: tag.targetHash,
        targetSubject: target?.subject ?? "",
        targetShortHash: target?.shortHash ?? tag.targetHash,
        tagger: tag.tagger,
        date: tag.date,
        subject: tag.subject,
        annotated: tag.annotated,
      },
      tags: [tag.annotated ? "annotated" : "lightweight"],
    };
  }
}
