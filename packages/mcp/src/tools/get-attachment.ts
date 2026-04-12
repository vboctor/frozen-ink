import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { existsSync, readFileSync } from "fs";
import { basename, join, posix } from "path";
import {
  contextExists,
  listCollections,
  getCollection,
  getCollectionDb,
  getCollectionDbPath,
  entities,
  assets,
} from "@frozenink/core";
import { and, eq } from "drizzle-orm";
import type { McpServerOptions } from "../server";
import {
  buildCollectionDeniedError,
  filterAllowedCollections,
  isCollectionAllowed,
} from "../collection-scope";

function textErr(message: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
  };
}

function extractReferencePath(reference: string): string {
  const raw = reference.trim();

  // Obsidian-style: ![[path]] (backward compat)
  const wikiMatch = raw.match(/^!\[\[(.+?)\]\]$/);
  if (wikiMatch) {
    return wikiMatch[1].split("|")[0].trim();
  }

  // Standard markdown: ![alt](path)
  const mdMatch = raw.match(/^!\[[^\]]*\]\((.+?)\)$/);
  if (mdMatch) {
    let path = mdMatch[1].trim();
    // Strip relative attachment prefix (../../attachments/ or attachments/)
    path = path.replace(/^(?:\.\.\/)*attachments\//, "");
    return path;
  }

  return raw;
}

function normalizePath(p: string): string {
  let out = p.trim();
  if ((out.startsWith("\"") && out.endsWith("\"")) || (out.startsWith("'") && out.endsWith("'"))) {
    out = out.slice(1, -1);
  }
  if ((out.startsWith("<") && out.endsWith(">"))) {
    out = out.slice(1, -1);
  }

  out = out.replace(/\\\\/g, "/");
  out = out.replace(/^\//, "");
  out = decodeURIComponent(out);

  return posix.normalize(out);
}

function buildCandidates(refPath: string, markdownPath: string | null): string[] {
  const candidates = new Set<string>();

  // Check the raw path for external URLs before normalization, since
  // posix.normalize collapses "https://" → "https:/" which bypasses string checks.
  const trimmed = refPath.trim();
  if (!trimmed || trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("data:")) {
    return [];
  }

  const clean = normalizePath(trimmed);
  if (!clean) {
    return [];
  }

  candidates.add(clean);
  if (!clean.startsWith("assets/")) {
    candidates.add(`assets/${clean}`);
  }

  if (markdownPath) {
    const markdownDir = posix.dirname(markdownPath);
    const relResolved = posix.normalize(posix.join(markdownDir, clean));
    candidates.add(relResolved);
    if (!relResolved.startsWith("assets/")) {
      candidates.add(`assets/${relResolved}`);
    }

    const relResolvedNoMd = posix.normalize(posix.join(markdownDir.replace(/^markdown\/?/, ""), clean));
    candidates.add(relResolvedNoMd);
    if (!relResolvedNoMd.startsWith("assets/")) {
      candidates.add(`assets/${relResolvedNoMd}`);
    }
  }

  return Array.from(candidates).filter((c) => !c.startsWith(".."));
}

/** Searches for an attachment within a single collection DB. Returns the row or undefined. */
function findAttachmentInDb(
  colDb: ReturnType<typeof getCollectionDb>,
  candidates: string[],
  extracted: string,
  sourceEntityId: number | null,
): { id: number; entityId: number; filename: string; mimeType: string; storagePath: string } | undefined {
  for (const candidate of candidates) {
    const rows = sourceEntityId
      ? colDb
          .select()
          .from(assets)
          .where(and(eq(assets.storagePath, candidate), eq(assets.entityId, sourceEntityId)))
          .all()
      : colDb.select().from(assets).where(eq(assets.storagePath, candidate)).all();

    if (rows.length > 0) return rows[0];
  }

  // Fallback: match by filename alone
  const fileName = basename(extracted);
  const byFilename = sourceEntityId
    ? colDb
        .select()
        .from(assets)
        .where(and(eq(assets.filename, fileName), eq(assets.entityId, sourceEntityId)))
        .all()
    : colDb.select().from(assets).where(eq(assets.filename, fileName)).all();

  return byFilename.length === 1 ? byFilename[0] : undefined;
}

async function handleGetAttachment(
  collectionName: string | undefined,
  reference: string,
  externalId: string | undefined,
  options: McpServerOptions,
) {
  if (!contextExists()) {
    return textErr("Frozen Ink not initialized");
  }

  // Validate reference is local before any DB work.
  const extracted = extractReferencePath(reference);
  const candidates = buildCandidates(extracted, null); // no markdownPath yet — refined per collection below
  if (candidates.length === 0) {
    return textErr("Reference is not a local attachment path");
  }

  // Resolve which collections to search.
  type ColRow = { name: string; dbPath: string };
  let colRows: ColRow[];

  if (collectionName) {
    if (!isCollectionAllowed(options, collectionName)) {
      return textErr(buildCollectionDeniedError(collectionName));
    }
    const col = getCollection(collectionName);
    if (!col) return textErr(`Collection "${collectionName}" not found`);
    const dbPath = getCollectionDbPath(collectionName);
    if (!existsSync(dbPath)) return textErr("Collection database not found");
    colRows = [{ name: collectionName, dbPath }];
  } else {
    colRows = filterAllowedCollections(options, listCollections())
      .map((col) => ({ name: col.name, dbPath: getCollectionDbPath(col.name) }))
      .filter((row) => existsSync(row.dbPath));
  }

  for (const { name: colName, dbPath } of colRows) {
    const colDb = getCollectionDb(dbPath);

    // Resolve source entity for relative-path candidate generation.
    let sourceEntityId: number | null = null;
    let sourceMarkdownPath: string | null = null;
    if (externalId) {
      const [sourceEntity] = colDb
        .select()
        .from(entities)
        .where(eq(entities.externalId, externalId))
        .all();

      if (!sourceEntity) {
        // Entity not found in this collection — skip when searching all,
        // but surface the error when a specific collection was requested.
        if (collectionName) {
          return textErr(`Entity "${externalId}" not found in "${collectionName}"`);
        }
        continue;
      }

      sourceEntityId = sourceEntity.id;
      sourceMarkdownPath = sourceEntity.markdownPath;
    }

    const effectiveCandidates = buildCandidates(extracted, sourceMarkdownPath);
    const attachmentRow = findAttachmentInDb(colDb, effectiveCandidates, extracted, sourceEntityId);

    if (!attachmentRow) continue;

    const collectionDir = join(options.frozeninkHome, "collections", colName);
    const fullPath = join(collectionDir, attachmentRow.storagePath);
    const normalizedCollectionDir = join(collectionDir, "/");
    if (!join(fullPath, "/").startsWith(normalizedCollectionDir)) {
      return textErr("Resolved attachment path is outside collection directory");
    }

    if (!existsSync(fullPath)) {
      return textErr(`Attachment file not found on disk: ${attachmentRow.storagePath}`);
    }

    const content = readFileSync(fullPath);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            collection: colName,
            reference,
            resolvedStoragePath: attachmentRow.storagePath,
            filename: attachmentRow.filename,
            mimeType: attachmentRow.mimeType,
            entityId: attachmentRow.entityId,
            sizeBytes: content.length,
            contentBase64: content.toString("base64"),
          }),
        },
      ],
    };
  }

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          error: "Attachment not found for reference",
          reference,
          candidates,
        }),
      },
    ],
  };
}

export function registerGetAttachment(
  server: McpServer,
  options: McpServerOptions,
): void {
  const { singleCollectionName } = options;

  if (singleCollectionName) {
    server.registerTool(
      "entity_get_attachment",
      {
        title: "Get Entity Attachment",
        description:
          "Retrieve an image or file attachment (base64-encoded) referenced in an item's markdown. Use this when the user asks about images, diagrams, or files attached to their notes or issues.",
        inputSchema: {
          reference: z
            .string()
            .describe("Attachment reference from markdown, e.g. ![logo](../../attachments/git/abc/logo.png) or assets/git/abc/logo.png"),
          id: z
            .string()
            .optional()
            .describe("The item ID to resolve relative attachment paths (from entity_search)"),
        },
        annotations: { readOnlyHint: true },
      },
      async (args) =>
        handleGetAttachment(singleCollectionName, args.reference, args.id, options),
    );
  } else {
    server.registerTool(
      "entity_get_attachment",
      {
        title: "Get Entity Attachment",
        description:
          "Retrieve an image or file attachment (base64-encoded) referenced in an item's markdown. Use this when the user asks about images, diagrams, or files attached to their notes or issues. Optionally specify a collection.",
        inputSchema: {
          reference: z
            .string()
            .describe("Attachment reference from markdown, e.g. ![logo](../../attachments/git/abc/logo.png) or assets/git/abc/logo.png"),
          collection: z
            .string()
            .optional()
            .describe("Collection to look in. Omit to search all collections."),
          id: z
            .string()
            .optional()
            .describe("The item ID to resolve relative attachment paths (from entity_search)"),
        },
        annotations: { readOnlyHint: true },
      },
      async (args) =>
        handleGetAttachment(args.collection, args.reference, args.id, options),
    );
  }
}
