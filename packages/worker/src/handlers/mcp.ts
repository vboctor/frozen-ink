import type { Env } from "../types";
import {
  getCollections,
  getEntityByExternalId,
  getEntityTags,
  getEntityCount,
} from "../db/client";
import { searchEntities } from "../db/search";
import { getR2Object } from "../storage/r2";

/**
 * Handle MCP requests using JSON-RPC over HTTP.
 * Implements the MCP protocol directly for the Cloudflare Worker environment
 * since StreamableHTTPServerTransport requires Node.js APIs.
 */
export async function handleMcpRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed. Use POST for MCP requests." }),
      { status: 405, headers: { "Content-Type": "application/json" } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonRpcError(-32700, "Parse error", null);
  }

  const rpc = body as { jsonrpc: string; method: string; params?: unknown; id?: unknown };

  if (rpc.method === "initialize") {
    const description = env.TOOL_DESCRIPTION?.trim();
    const instructions = description
      ? `Frozen Ink MCP server. ${description}`
      : "Frozen Ink MCP server. Provides collection and entity retrieval tools over published collections.";

    return jsonRpcResult(
      {
        protocolVersion: "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: "frozenink", version: "0.1.0" },
        instructions,
      },
      rpc.id,
    );
  }

  if (rpc.method === "notifications/initialized") {
    // Acknowledgement — no response needed for notifications, but return empty ok
    return new Response(null, { status: 204 });
  }

  if (rpc.method === "tools/list") {
    const tools = [
      {
        name: "collection_list",
        description: "Lists all published collections with entity counts",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "entity_search",
        description: "Full-text search across published entities",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
            collection: { type: "string", description: "Filter to collection" },
            entityType: { type: "string", description: "Filter by entity type" },
            limit: { type: "number", description: "Max results", default: 20 },
          },
          required: ["query"],
        },
      },
      {
        name: "entity_get_data",
        description: "Returns full entity data and markdown by collection and external ID",
        inputSchema: {
          type: "object",
          properties: {
            collection: { type: "string", description: "Collection name" },
            externalId: { type: "string", description: "External ID" },
          },
          required: ["collection", "externalId"],
        },
      },
      {
        name: "entity_get_markdown",
        description: "Returns rendered markdown for an entity",
        inputSchema: {
          type: "object",
          properties: {
            collection: { type: "string", description: "Collection name" },
            externalId: { type: "string", description: "External ID" },
          },
          required: ["collection", "externalId"],
        },
      },
      {
        name: "entity_get_attachment",
        description: "Returns base64 encoded attachment",
        inputSchema: {
          type: "object",
          properties: {
            collection: { type: "string", description: "Collection name" },
            path: { type: "string", description: "Attachment path" },
          },
          required: ["collection", "path"],
        },
      },
    ];

    return jsonRpcResult({ tools }, rpc.id);
  }

  if (rpc.method === "tools/call") {
    const params = rpc.params as { name: string; arguments?: Record<string, unknown> };
    const toolName = params.name;
    const args = params.arguments ?? {};

    try {
      const content = await callTool(toolName, args, env);
      return jsonRpcResult({ content }, rpc.id);
    } catch (err) {
      return jsonRpcError(-32603, String(err), rpc.id);
    }
  }

  return jsonRpcError(-32601, `Method not found: ${rpc.method}`, rpc.id);
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
  env: Env,
): Promise<Array<{ type: string; text: string }>> {
  if (name === "collection_list") {
    const collections = await getCollections(env.DB);
    const data = await Promise.all(
      collections.map(async (col) => ({
        name: col.name,
        title: col.title || col.name,
        entityCount: await getEntityCount(env.DB, col.name),
      })),
    );
    return [{ type: "text", text: JSON.stringify(data) }];
  }

  if (name === "entity_search") {
    const results = await searchEntities(env.DB, args.query as string, {
      collectionName: args.collection as string | undefined,
      entityType: args.entityType as string | undefined,
      limit: (args.limit as number | undefined) ?? 20,
    });
    return [{ type: "text", text: JSON.stringify(results) }];
  }

  if (name === "entity_get_data") {
    const entity = await getEntityByExternalId(env.DB, args.collection as string, args.externalId as string);
    if (!entity) return [{ type: "text", text: JSON.stringify({ error: "Entity not found" }) }];

    const tags = await getEntityTags(env.DB, args.collection as string, entity.id);
    let markdown: string | null = null;
    if (entity.markdown_path) {
      const obj = await getR2Object(env.BUCKET, `${args.collection}/${entity.markdown_path}`);
      if (obj) markdown = await new Response(obj.body).text();
    }
    return [{
      type: "text",
      text: JSON.stringify({
        id: entity.id, externalId: entity.external_id, entityType: entity.entity_type,
        title: entity.title, data: JSON.parse(entity.data || "{}"), url: entity.url,
        tags, markdown, createdAt: entity.created_at, updatedAt: entity.updated_at,
      }),
    }];
  }

  if (name === "entity_get_markdown") {
    const entity = await getEntityByExternalId(env.DB, args.collection as string, args.externalId as string);
    if (!entity?.markdown_path) return [{ type: "text", text: JSON.stringify({ error: "Not found" }) }];

    const obj = await getR2Object(env.BUCKET, `${args.collection}/${entity.markdown_path}`);
    if (!obj) return [{ type: "text", text: JSON.stringify({ error: "Markdown not found" }) }];

    const md = await new Response(obj.body).text();
    return [{
      type: "text",
      text: JSON.stringify({
        collection: args.collection, externalId: entity.external_id,
        title: entity.title, markdownPath: entity.markdown_path, markdown: md,
        updatedAt: entity.updated_at,
      }),
    }];
  }

  if (name === "entity_get_attachment") {
    const obj = await getR2Object(env.BUCKET, `${args.collection}/attachments/${args.path}`);
    if (!obj) return [{ type: "text", text: JSON.stringify({ error: "Attachment not found" }) }];

    const buf = await new Response(obj.body).arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return [{
      type: "text",
      text: JSON.stringify({
        collection: args.collection, path: args.path,
        sizeBytes: bytes.length, contentBase64: btoa(binary),
      }),
    }];
  }

  throw new Error(`Unknown tool: ${name}`);
}

function jsonRpcResult(result: unknown, id: unknown): Response {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", result, id }),
    { headers: { "Content-Type": "application/json" } },
  );
}

function jsonRpcError(code: number, message: string, id: unknown): Response {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id }),
    { headers: { "Content-Type": "application/json" } },
  );
}
