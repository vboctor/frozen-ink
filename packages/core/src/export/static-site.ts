import { existsSync, readdirSync, statSync, readFileSync, mkdirSync, writeFileSync, copyFileSync } from "fs";
import { join, relative, dirname, extname } from "path";
import { getFrozenInkHome } from "../config/loader";
import { getCollection, getCollectionDbPath } from "../config/context";
import { getCollectionDb } from "../db/client";
import { entities } from "../db/collection-schema";
import { ThemeEngine } from "../theme/engine";

export interface ExportOptions {
  collections: string[];
  outputDir: string;
  format: "markdown" | "html";
  themeEngine?: ThemeEngine;
  onProgress?: (step: string, current: number, total: number) => void;
}

/**
 * Export collections to a static site (Markdown or HTML).
 */
export async function exportStaticSite(options: ExportOptions): Promise<void> {
  const { collections, outputDir, format, onProgress } = options;
  const home = getFrozenInkHome();

  mkdirSync(outputDir, { recursive: true });

  if (format === "markdown") {
    await exportMarkdown(home, collections, outputDir, onProgress);
  } else {
    await exportHtml(home, collections, outputDir, options.themeEngine, onProgress);
  }
}

// --- Markdown Export ---

async function exportMarkdown(
  home: string,
  collections: string[],
  outputDir: string,
  onProgress?: (step: string, current: number, total: number) => void,
): Promise<void> {
  const indexLines: string[] = ["# Frozen Ink Export\n"];
  let totalFiles = 0;
  let exported = 0;

  // Count total files
  for (const colName of collections) {
    const mdDir = join(home, "collections", colName, "markdown");
    if (existsSync(mdDir)) totalFiles += countFiles(mdDir);
    const attDir = join(home, "collections", colName, "attachments");
    if (existsSync(attDir)) totalFiles += countFiles(attDir);
  }

  for (const colName of collections) {
    const colDir = join(home, "collections", colName);
    const outColDir = join(outputDir, colName);
    mkdirSync(outColDir, { recursive: true });

    indexLines.push(`## ${colName}\n`);

    // Copy markdown files
    const mdDir = join(colDir, "markdown");
    if (existsSync(mdDir)) {
      const files = collectAllFiles(mdDir);
      for (const file of files) {
        const relPath = relative(mdDir, file);
        const destPath = join(outColDir, relPath);
        mkdirSync(dirname(destPath), { recursive: true });
        copyFileSync(file, destPath);
        indexLines.push(`- [${relPath}](./${colName}/${relPath})`);
        exported++;
        onProgress?.("copying", exported, totalFiles);
      }
    }

    // Copy attachments
    const attDir = join(colDir, "attachments");
    if (existsSync(attDir)) {
      const outAttDir = join(outColDir, "attachments");
      const files = collectAllFiles(attDir);
      for (const file of files) {
        const relPath = relative(attDir, file);
        const destPath = join(outAttDir, relPath);
        mkdirSync(dirname(destPath), { recursive: true });
        copyFileSync(file, destPath);
        exported++;
        onProgress?.("copying", exported, totalFiles);
      }
    }

    indexLines.push("");
  }

  // Write index
  writeFileSync(join(outputDir, "index.md"), indexLines.join("\n"), "utf-8");
  onProgress?.("done", exported, totalFiles);
}

// --- HTML Export ---

async function exportHtml(
  home: string,
  collections: string[],
  outputDir: string,
  themeEngine?: ThemeEngine,
  onProgress?: (step: string, current: number, total: number) => void,
): Promise<void> {
  let totalEntities = 0;
  let exported = 0;

  // Count entities
  for (const colName of collections) {
    const dbPath = getCollectionDbPath(colName);
    if (existsSync(dbPath)) {
      const colDb = getCollectionDb(dbPath);
      totalEntities += colDb.select().from(entities).all().length;
    }
  }

  const navItems: Array<{ collection: string; title: string; path: string }> = [];

  for (const colName of collections) {
    const col = getCollection(colName);
    if (!col) continue;

    const dbPath = getCollectionDbPath(colName);
    if (!existsSync(dbPath)) continue;

    const colDb = getCollectionDb(dbPath);
    const allEntities = colDb.select().from(entities).all();
    const outColDir = join(outputDir, "collections", colName);
    mkdirSync(outColDir, { recursive: true });

    for (const entity of allEntities) {
      const entityTagNames: string[] = (entity as any).tags ?? [];

      const data = typeof entity.data === "string" ? JSON.parse(entity.data) : entity.data;
      let html = "";

      // Try theme HTML renderer
      if (themeEngine?.hasHtmlRenderer(col.crawler)) {
        const rendered = themeEngine.renderHtml({
          entity: {
            externalId: entity.externalId,
            entityType: entity.entityType,
            title: entity.title,
            data,
            url: entity.url ?? undefined,
            tags: entityTagNames,
          },
          collectionName: colName,
          crawlerType: col.crawler,
        });
        if (rendered) html = rendered;
      }

      // Fallback: read markdown and wrap in basic HTML
      if (!html && entity.markdownPath) {
        const mdFullPath = join(home, "collections", colName, "content", entity.markdownPath);
        if (existsSync(mdFullPath)) {
          const mdContent = readFileSync(mdFullPath, "utf-8");
          html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(entity.title)}</title>
<style>body { font-family: -apple-system, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }</style>
</head><body><h1>${escapeHtml(entity.title)}</h1><pre>${escapeHtml(mdContent)}</pre></body></html>`;
        }
      }

      if (html) {
        const filename = `${sanitizeFilename(entity.externalId)}.html`;
        const outPath = join(outColDir, filename);
        writeFileSync(outPath, html, "utf-8");
        navItems.push({
          collection: colName,
          title: entity.title,
          path: `collections/${colName}/${filename}`,
        });
      }

      exported++;
      onProgress?.("rendering", exported, totalEntities);
    }

    // Copy attachments
    const attDir = join(home, "collections", colName, "attachments");
    if (existsSync(attDir)) {
      const outAttDir = join(outputDir, "collections", colName, "attachments");
      const files = collectAllFiles(attDir);
      for (const file of files) {
        const relPath = relative(attDir, file);
        const destPath = join(outAttDir, relPath);
        mkdirSync(dirname(destPath), { recursive: true });
        copyFileSync(file, destPath);
      }
    }
  }

  // Generate index.html
  const indexHtml = generateIndexHtml(collections, navItems);
  writeFileSync(join(outputDir, "index.html"), indexHtml, "utf-8");
  onProgress?.("done", exported, totalEntities);
}

// --- Helpers ---

function countFiles(dir: string): number {
  let count = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) count += countFiles(join(dir, entry.name));
    else count++;
  }
  return count;
}

function collectAllFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...collectAllFiles(fullPath));
    else files.push(fullPath);
  }
  return files;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function sanitizeFilename(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
}

function generateIndexHtml(
  collections: string[],
  navItems: Array<{ collection: string; title: string; path: string }>,
): string {
  const navByCollection = new Map<string, typeof navItems>();
  for (const item of navItems) {
    const list = navByCollection.get(item.collection) ?? [];
    list.push(item);
    navByCollection.set(item.collection, list);
  }

  const navHtml = collections
    .map((col) => {
      const items = navByCollection.get(col) ?? [];
      const links = items
        .map((i) => `<li><a href="${i.path}">${escapeHtml(i.title)}</a></li>`)
        .join("\n");
      return `<h2>${escapeHtml(col)}</h2>\n<ul>${links}</ul>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Frozen Ink Export</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; color: #1f2328; }
  a { color: #0969da; text-decoration: none; }
  a:hover { text-decoration: underline; }
  h1 { border-bottom: 1px solid #d0d7de; padding-bottom: 8px; }
  h2 { font-size: 18px; margin-top: 24px; }
  ul { padding-left: 20px; }
  li { padding: 2px 0; }
</style>
</head>
<body>
<h1>Frozen Ink Export</h1>
${navHtml}
</body>
</html>`;
}
