import { readdirSync, statSync, readFileSync, existsSync } from "fs";
import { join, relative, extname, basename } from "path";
import type {
  Crawler,
  CrawlerMetadata,
  CrawlerEntityData,
  SyncCursor,
  SyncResult,
} from "@frozenink/core";
import { createCryptoHasher } from "@frozenink/core";
import type { ObsidianConfig, ObsidianCredentials, VaultFile } from "./types";

const EXCLUDED_DIRS = new Set([".obsidian", ".trash", ".git", "node_modules"]);

const IMAGE_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp", ".ico",
]);

const ATTACHMENT_EXTENSIONS = new Set([
  ...IMAGE_EXTENSIONS,
  ".pdf", ".mp3", ".mp4", ".webm", ".wav", ".ogg",
  ".zip", ".tar", ".gz",
  ".csv", ".xls", ".xlsx", ".doc", ".docx", ".ppt", ".pptx",
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
  ".pdf": "application/pdf",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".zip": "application/zip",
  ".csv": "text/csv",
};

interface ObsidianSyncCursor extends SyncCursor {
  lastSyncTime?: number;
  knownPaths?: string[];
}

export class ObsidianCrawler implements Crawler {
  metadata: CrawlerMetadata = {
    type: "obsidian",
    displayName: "Obsidian Vault",
    description: "Syncs markdown files and attachments from a local Obsidian vault",
    configSchema: {
      vaultPath: { type: "string", required: true, description: "Path to the Obsidian vault directory" },
      excludePatterns: { type: "array", description: "Glob patterns to exclude" },
    },
    credentialFields: ["vaultPath"],
  };

  private vaultPath = "";
  private excludePatterns: string[] = [];

  async initialize(
    config: Record<string, unknown>,
    credentials: Record<string, unknown>,
  ): Promise<void> {
    const cfg = config as unknown as ObsidianConfig;
    const creds = credentials as unknown as ObsidianCredentials;
    this.vaultPath = creds.vaultPath || cfg.vaultPath;
    this.excludePatterns = cfg.excludePatterns ?? [];
  }

  async sync(cursor: SyncCursor | null): Promise<SyncResult> {
    const c = (cursor as ObsidianSyncCursor) ?? {};
    const lastSyncTime = c.lastSyncTime ?? 0;
    const knownPaths = new Set(c.knownPaths ?? []);

    // Walk vault and collect all files
    const allFiles = this.walkVault(this.vaultPath);

    // Use max mtime across all files as sync marker to avoid sub-ms precision issues
    let maxMtime = Date.now();
    for (const f of allFiles) {
      if (f.mtime > maxMtime) maxMtime = f.mtime;
    }
    const syncTime = Math.ceil(maxMtime);
    const mdFiles = allFiles.filter((f) => f.relativePath.endsWith(".md"));
    const attachmentFiles = allFiles.filter((f) => {
      const ext = extname(f.relativePath).toLowerCase();
      return ATTACHMENT_EXTENSIONS.has(ext);
    });

    // Build lookup for attachment resolution
    const attachmentByName = new Map<string, VaultFile>();
    for (const f of attachmentFiles) {
      // Index by full relative path and by filename only (for Obsidian short links)
      attachmentByName.set(f.relativePath, f);
      attachmentByName.set(basename(f.relativePath), f);
    }

    const currentPaths = new Set(mdFiles.map((f) => f.relativePath));

    // Find changed markdown files
    const changedFiles = mdFiles.filter((f) => f.mtime > lastSyncTime);

    // Find deleted files
    const deletedPaths: string[] = [];
    for (const known of knownPaths) {
      if (!currentPaths.has(known)) {
        deletedPaths.push(known);
      }
    }

    // Also check for changed attachment files — if an attachment changed,
    // re-sync all markdown files that reference it
    const changedAttachments = attachmentFiles.filter((f) => f.mtime > lastSyncTime);
    if (changedAttachments.length > 0 && changedFiles.length < mdFiles.length) {
      const changedAttPaths = new Set(changedAttachments.map((f) => f.relativePath));
      const changedAttNames = new Set(changedAttachments.map((f) => basename(f.relativePath)));
      const alreadyChanged = new Set(changedFiles.map((f) => f.relativePath));

      for (const md of mdFiles) {
        if (alreadyChanged.has(md.relativePath)) continue;
        const content = readFileSync(md.absolutePath, "utf-8");
        const refs = this.extractImageRefs(content);
        for (const ref of refs) {
          if (changedAttPaths.has(ref) || changedAttNames.has(ref)) {
            changedFiles.push(md);
            alreadyChanged.add(md.relativePath);
            break;
          }
        }
      }
    }

    // Build entities for changed files
    const entities: CrawlerEntityData[] = [];
    for (const file of changedFiles) {
      entities.push(this.buildEntity(file, attachmentByName));
    }

    return {
      entities,
      nextCursor: {
        lastSyncTime: syncTime,
        knownPaths: Array.from(currentPaths),
      },
      hasMore: false,
      deletedExternalIds: deletedPaths,
    };
  }

  async validateCredentials(
    credentials: Record<string, unknown>,
  ): Promise<boolean> {
    const creds = credentials as unknown as ObsidianCredentials;
    if (!creds.vaultPath) return false;
    return existsSync(creds.vaultPath) && existsSync(join(creds.vaultPath, ".obsidian")) || existsSync(creds.vaultPath);
  }

  async dispose(): Promise<void> {
    // No resources to clean up
  }

  private walkVault(dirPath: string, basePath: string = ""): VaultFile[] {
    const files: VaultFile[] = [];
    if (!existsSync(dirPath)) return files;

    let entries;
    try {
      entries = readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return files;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".") && EXCLUDED_DIRS.has(entry.name)) continue;
      if (EXCLUDED_DIRS.has(entry.name)) continue;

      const absPath = join(dirPath, entry.name);
      const relPath = basePath ? `${basePath}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        files.push(...this.walkVault(absPath, relPath));
      } else if (entry.isFile()) {
        if (this.isExcluded(relPath)) continue;
        try {
          const stat = statSync(absPath);
          files.push({
            relativePath: relPath,
            absolutePath: absPath,
            mtime: stat.mtimeMs,
            size: stat.size,
          });
        } catch {
          // Skip files we can't stat
        }
      }
    }

    return files;
  }

  private isExcluded(relativePath: string): boolean {
    for (const pattern of this.excludePatterns) {
      if (relativePath.includes(pattern)) return true;
    }
    return false;
  }

  private buildEntity(
    file: VaultFile,
    attachmentLookup: Map<string, VaultFile>,
  ): CrawlerEntityData {
    const content = readFileSync(file.absolutePath, "utf-8");
    const title = this.extractTitle(content, file.relativePath);
    const { frontmatter, body } = this.parseFrontmatter(content);
    const tags = this.extractTags(frontmatter, body);
    const imageRefs = this.extractImageRefs(content);

    // Build attachments from image references and track resolved paths
    const attachments: CrawlerEntityData["attachments"] = [];
    const seenPaths = new Set<string>();
    const imageRefMap: Record<string, string> = {};

    for (const ref of imageRefs) {
      // Try exact ref, then basename — handles paths like ../attachments/assets/img.png
      // that embed the output layout rather than the vault-relative path.
      const attFile = attachmentLookup.get(ref) ?? attachmentLookup.get(basename(ref));
      if (!attFile) continue;
      imageRefMap[ref] = attFile.relativePath;
      if (seenPaths.has(attFile.relativePath)) continue;
      seenPaths.add(attFile.relativePath);

      const ext = extname(attFile.relativePath).toLowerCase();
      const mimeType = MIME_TYPES[ext] || "application/octet-stream";

      try {
        const fileContent = readFileSync(attFile.absolutePath);
        attachments.push({
          filename: basename(attFile.relativePath),
          mimeType,
          content: fileContent,
          storagePath: `attachments/${attFile.relativePath}`,
        });
      } catch {
        // Skip unreadable attachments
      }
    }

    // Compute content hash from file content + mtime
    const hasher = createCryptoHasher("sha256");
    hasher.update(content);
    hasher.update(String(file.mtime));
    const contentHash = hasher.digest("hex");

    return {
      externalId: file.relativePath,
      entityType: "note",
      title,
      url: undefined,
      tags,
      contentHash,
      data: {
        content,
        frontmatter,
        relativePath: file.relativePath,
        imageRefMap,
        mtime: file.mtime,
        size: file.size,
      },
      attachments: attachments.length > 0 ? attachments : undefined,
    };
  }

  private extractTitle(content: string, relativePath: string): string {
    // Try to get title from first H1 heading (skip frontmatter and code blocks)
    let body = content;
    if (body.startsWith("---")) {
      const endIdx = body.indexOf("---", 3);
      if (endIdx !== -1) {
        body = body.slice(endIdx + 3).trimStart();
      }
    }

    // Strip fenced code blocks so we don't match H1 headings inside them
    const stripped = body.replace(/^(`{3,}|~{3,}).*\n[\s\S]*?\n\1\s*$/gm, "");

    const h1Match = stripped.match(/^#\s+(.+)$/m);
    if (h1Match) return h1Match[1].trim();

    // Fall back to filename without extension
    return basename(relativePath, ".md");
  }

  private parseFrontmatter(content: string): {
    frontmatter: Record<string, unknown>;
    body: string;
  } {
    if (!content.startsWith("---")) {
      return { frontmatter: {}, body: content };
    }

    const endIdx = content.indexOf("---", 3);
    if (endIdx === -1) {
      return { frontmatter: {}, body: content };
    }

    const fmBlock = content.slice(3, endIdx).trim();
    const body = content.slice(endIdx + 3).trimStart();
    const frontmatter: Record<string, unknown> = {};

    // Simple YAML parser for common Obsidian frontmatter fields
    let currentKey = "";
    let currentArrayItems: string[] | null = null;

    for (const line of fmBlock.split("\n")) {
      const trimmed = line.trim();

      // Array item
      if (trimmed.startsWith("- ") && currentKey) {
        if (!currentArrayItems) currentArrayItems = [];
        currentArrayItems.push(trimmed.slice(2).trim());
        continue;
      }

      // Save previous array if we were building one
      if (currentArrayItems && currentKey) {
        frontmatter[currentKey] = currentArrayItems;
        currentArrayItems = null;
      }

      const kvMatch = trimmed.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
      if (kvMatch) {
        currentKey = kvMatch[1];
        const value = kvMatch[2].trim();

        if (!value) {
          // Could be start of array or empty value
          continue;
        }

        // Inline array: [item1, item2]
        if (value.startsWith("[") && value.endsWith("]")) {
          frontmatter[currentKey] = value
            .slice(1, -1)
            .split(",")
            .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
            .filter(Boolean);
        } else {
          // Scalar value — strip quotes
          frontmatter[currentKey] = value.replace(/^['"]|['"]$/g, "");
        }
      }
    }

    // Save trailing array
    if (currentArrayItems && currentKey) {
      frontmatter[currentKey] = currentArrayItems;
    }

    return { frontmatter, body };
  }

  private extractTags(
    frontmatter: Record<string, unknown>,
    body: string,
  ): string[] {
    const tags = new Set<string>();

    // Tags from frontmatter
    const fmTags = frontmatter.tags;
    if (Array.isArray(fmTags)) {
      for (const t of fmTags) {
        if (typeof t === "string") tags.add(t);
      }
    } else if (typeof fmTags === "string") {
      tags.add(fmTags);
    }

    // Inline #tags from body (but not in code blocks or URLs)
    const tagMatches = body.match(/(?:^|\s)#([a-zA-Z][\w-/]*)/g);
    if (tagMatches) {
      for (const match of tagMatches) {
        const tag = match.trim().slice(1); // Remove # prefix
        if (tag && !tag.includes("//")) {
          tags.add(tag);
        }
      }
    }

    return Array.from(tags);
  }

  extractImageRefs(content: string): string[] {
    const refs: string[] = [];
    const seen = new Set<string>();

    // Obsidian embeds: ![[path]] or ![[path|size]]
    const wikiEmbeds = content.matchAll(/!\[\[([^\]|]+?)(?:\|[^\]]+)?\]\]/g);
    for (const match of wikiEmbeds) {
      const ref = match[1].trim();
      if (!seen.has(ref)) {
        seen.add(ref);
        refs.push(ref);
      }
    }

    // Standard markdown images with relative paths: ![alt](path)
    const mdImages = content.matchAll(/!\[(?:[^\]]*)\]\(([^)]+)\)/g);
    for (const match of mdImages) {
      const ref = match[1].trim();
      // Skip absolute URLs
      if (ref.startsWith("http://") || ref.startsWith("https://") || ref.startsWith("data:")) continue;
      if (!seen.has(ref)) {
        seen.add(ref);
        refs.push(ref);
      }
    }

    return refs;
  }
}
