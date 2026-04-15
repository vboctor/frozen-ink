import { Hono } from "hono";
import { compress } from "hono/compress";
import type { Env } from "./types";
import { authMiddleware, handleLogin, handleLogout } from "./auth";
import { renderLoginPage } from "./login";
import { api } from "./handlers/api";
import { ui } from "./handlers/ui";
import { handleMcpRequest } from "./handlers/mcp";

const app = new Hono<{ Bindings: Env }>();

app.use("*", compress());

// Public routes (no auth)
app.get("/login", renderLoginPage);
app.post("/login", handleLogin);
app.post("/logout", handleLogout);

// MCP endpoint — auth checked via Bearer header
app.all("/mcp", authMiddleware, async (c) => {
  return handleMcpRequest(c.req.raw, c.env);
});

// All API routes — auth required
app.use("/api/*", authMiddleware);
app.route("/", api);

// Static UI — auth required (cookie)
app.use("/*", authMiddleware);
app.route("/", ui);

export { app };
