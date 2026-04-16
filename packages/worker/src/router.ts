import { Hono } from "hono";
import type { Env } from "./types";
import { authMiddleware, handleLogin, handleLogout } from "./auth";
import { renderLoginPage } from "./login";
import { api } from "./handlers/api";
import { ui } from "./handlers/ui";
import { handleMcpRequest } from "./handlers/mcp";

declare const __BUILD_ID__: string;
const CACHE_TTL = 60 * 60 * 24;

const app = new Hono<{ Bindings: Env }>();

// Public routes (no auth)
app.get("/login", renderLoginPage);
app.post("/login", handleLogin);
app.post("/logout", handleLogout);

// MCP endpoint — auth checked via Bearer header
app.all("/mcp", authMiddleware, async (c) => {
  return handleMcpRequest(c.req.raw, c.env);
});

// All API routes — auth required, with edge caching for GET requests
app.use("/api/*", authMiddleware);
app.use("/api/*", async (c, next) => {
  if (c.req.method !== "GET") return next();
  const cache = caches.default;
  const cacheUrl = new URL(c.req.url);
  cacheUrl.searchParams.set("__v", __BUILD_ID__);
  const cacheKey = new Request(cacheUrl.toString(), c.req.raw);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;
  await next();
  const res = c.res;
  if (res.ok) {
    const cloned = res.clone();
    const cacheable = new Response(cloned.body, cloned);
    cacheable.headers.set("Cache-Control", `public, max-age=${CACHE_TTL}`);
    c.executionCtx.waitUntil(cache.put(cacheKey, cacheable));
  }
});
app.route("/", api);

// Static UI — auth required (cookie)
app.use("/*", authMiddleware);
app.route("/", ui);

export { app };
