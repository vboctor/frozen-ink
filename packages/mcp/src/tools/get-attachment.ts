import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { existsSync, readFileSync } from "fs";
import { basename, join, posix } from "path";
import {
  getMasterDb,
  getCollectionDb,
  collections,
  entities,
  attachments,
} from "@veecontext/core";
import { and, eq } from "drizzle-orm";
import type { McpServerOptions } from "../server";

function extractReferencePath(reference: string): string {
  const raw = reference.trim();

  const wikiMatch = raw.match(/^!\[\[(.+?)\]\]$/);
  if (wikiMatch) {
    return wikiMatch[1].split("|")[0].trim();
  }

  const mdMatch = raw.match(/^!\[[^\]]*\]\((.+?)\)$/);
  if (mdMatch) {
    return mdMatch[1].trim();
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

  const clean = normalizePath(refPath);
  if (!clean || clean.startsWith("http://") || clean.startsWith("https://") || clean.startsWith("data:")) {
    return [];
  }

  candidates.add(clean);
  if (!clean.startsWith("attachments/")) {
    candidates.add(`attachments/${clean}`);
  }

  if (markdownPath) {
    const markdownDir = posix.dirname(markdownPath);
    const relResolved = posix.normalize(posix.join(markdownDir, clean));
    candidates.add(relResolved);
    if (!relResolved.startsWith("attachments/")) {
      candidates.add(`attachments/${relResolved}`);
    }

    const relResolvedNoMd = posix.normalize(posix.join(markdownDir.replace(/^markdown\/?/, ""), clean));
    candidates.add(relResolvedNoMd);
    if (!relResolvedNoMd.startsWith("attachments/")) {
      candidates.add(`attachments/${relResolvedNoMd}`);
    }
  }

  return Array.from(candidates).filter((c) => !c.startsWith(".."));
}

export function registerGetAttachment(
  server: McpServer,
  options: McpServerOptions,
): void {
  server.registerTool(
    "entity_get_attachment",
    {
      title: "Get Entity Attachment",
      description:
        "Returns base64 encoded attachment content from a markdown reference",
      inputSchema: {
        collection: z.string().describe("Collection name"),
        reference: z
          .string()
          .describe("Attachment reference from markdown, e.g. ![[git/abc/logo.png]] or attachments/git/abc/logo.png"),
        externalId: z
          .string()
          .optional()
          .describe("Optional entity external ID for resolving relative references"),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const masterDbPath = join(options.veecontextHome, "master.db");
      if (!existsSync(masterDbPath)) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "VeeContext not initialized" }),
            },
          ],
        };
      }

      const db = getMasterDb(masterDbPath);
      const [col] = db
        .select()
        .from(collections)
        .where(eq(collections.name, args.collection))
        .all();

      if (!col) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: `Collection "${args.collection}" not found`,
              }),
            },
          ],
        };
      }

      if (!existsSync(col.dbPath)) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "Collection database not found" }),
            },
          ],
        };
      }

      const colDb = getCollectionDb(col.dbPath);

      let sourceEntityId: number | null = null;
      let sourceMarkdownPath: string | null = null;
      if (args.externalId) {
        const [sourceEntity] = colDb
          .select()
          .from(entities)
          .where(eq(entities.externalId, args.externalId))
          .all();

        if (!sourceEntity) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  error: `Entity "${args.externalId}" not found in "${args.collection}"`,
                }),
              },
            ],
          };
        }

        sourceEntityId = sourceEntity.id;
        sourceMarkdownPath = sourceEntity.markdownPath;
      }

      const extracted = extractReferencePath(args.reference);
      const candidates = buildCandidates(extracted, sourceMarkdownPath);
      if (candidates.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: "Reference is not a local attachment path",
              }),
            },
          ],
        };
      }

      let attachmentRow:
        | {
            id: number;
            entityId: number;
            filename: string;
            mimeType: string;
            storagePath: string;
            backend: string;
          }
        | undefined;

      for (const candidate of candidates) {
        const rows = sourceEntityId
          ? colDb
            .select()
            .from(attachments)
            .where(
              and(
                eq(attachments.storagePath, candidate),
                eq(attachments.entityId, sourceEntityId),
              ),
            )
            .all()
          : colDb
            .select()
            .from(attachments)
            .where(eq(attachments.storagePath, candidate))
            .all();

        if (rows.length > 0) {
          attachmentRow = rows[0];
          break;
        }
      }

      if (!attachmentRow) {
        const fileName = basename(extracted);
        const byFilename = sourceEntityId
          ? colDb
            .select()
            .from(attachments)
            .where(and(eq(attachments.filename, fileName), eq(attachments.entityId, sourceEntityId)))
            .all()
          : colDb
            .select()
            .from(attachments)
            .where(eq(attachments.filename, fileName))
            .all();

        if (byFilename.length === 1) {
          attachmentRow = byFilename[0];
        }
      }

      if (!attachmentRow) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: "Attachment not found for reference",
                reference: args.reference,
                candidates,
              }),
            },
          ],
        };
      }

      const collectionDir = join(options.veecontextHome, "collections", args.collection);
      const fullPath = join(collectionDir, attachmentRow.storagePath);
      const normalizedCollectionDir = join(collectionDir, "/");
      if (!join(fullPath, "/").startsWith(normalizedCollectionDir)) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "Resolved attachment path is outside collection directory" }),
            },
          ],
        };
      }

      if (!existsSync(fullPath)) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: `Attachment file not found on disk: ${attachmentRow.storagePath}`,
              }),
            },
          ],
        };
      }

      const content = readFileSync(fullPath);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              collection: args.collection,
              reference: args.reference,
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
    },
  );
}
