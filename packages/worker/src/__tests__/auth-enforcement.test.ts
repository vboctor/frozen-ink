import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { authMiddleware, handleLogin, hashPassword } from "../auth";

interface TestEnv {
  PASSWORD_HASH: string;
}

function createTestApp() {
  const app = new Hono<{ Bindings: TestEnv }>();
  app.post("/login", handleLogin);
  app.get("/api/collections", authMiddleware, (c) => c.json({ ok: true }));
  app.post("/mcp", authMiddleware, (c) => c.json({ ok: true }));
  app.get("/", authMiddleware, (c) => c.text("ui"));
  return app;
}

describe("worker auth enforcement across channels", () => {
  it("denies unauthenticated API and MCP access when password is set", async () => {
    const app = createTestApp();
    const passwordHash = await hashPassword("secret123");

    const apiRes = await app.request("http://local/api/collections", {}, { PASSWORD_HASH: passwordHash });
    expect(apiRes.status).toBe(401);

    const mcpRes = await app.request(
      "http://local/mcp",
      { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", id: 1 }) },
      { PASSWORD_HASH: passwordHash },
    );
    expect(mcpRes.status).toBe(401);
  });

  it("redirects unauthenticated UI requests to login when password is set", async () => {
    const app = createTestApp();
    const passwordHash = await hashPassword("secret123");

    const res = await app.request("http://local/", {}, { PASSWORD_HASH: passwordHash });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
  });

  it("accepts bearer password for API and MCP", async () => {
    const app = createTestApp();
    const passwordHash = await hashPassword("secret123");
    const headers = { Authorization: "Bearer secret123" };

    const apiRes = await app.request("http://local/api/collections", { headers }, { PASSWORD_HASH: passwordHash });
    expect(apiRes.status).toBe(200);

    const mcpRes = await app.request(
      "http://local/mcp",
      { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", id: 1 }) },
      { PASSWORD_HASH: passwordHash },
    );
    expect(mcpRes.status).toBe(200);
  });

  it("creates session cookie on login and accepts it for UI/API access", async () => {
    const app = createTestApp();
    const passwordHash = await hashPassword("secret123");

    const loginRes = await app.request(
      "http://local/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ password: "secret123" }).toString(),
      },
      { PASSWORD_HASH: passwordHash },
    );
    expect(loginRes.status).toBe(302);
    const setCookie = loginRes.headers.get("set-cookie");
    expect(setCookie).toBeTruthy();
    const cookieHeader = (setCookie ?? "").split(";")[0];

    const uiRes = await app.request("http://local/", { headers: { Cookie: cookieHeader } }, { PASSWORD_HASH: passwordHash });
    expect(uiRes.status).toBe(200);

    const apiRes = await app.request(
      "http://local/api/collections",
      { headers: { Cookie: cookieHeader } },
      { PASSWORD_HASH: passwordHash },
    );
    expect(apiRes.status).toBe(200);
  });

  it("allows all channels when password is not configured", async () => {
    const app = createTestApp();

    const apiRes = await app.request("http://local/api/collections", {}, { PASSWORD_HASH: "" });
    expect(apiRes.status).toBe(200);

    const mcpRes = await app.request(
      "http://local/mcp",
      { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", id: 1 }) },
      { PASSWORD_HASH: "" },
    );
    expect(mcpRes.status).toBe(200);

    const uiRes = await app.request("http://local/", {}, { PASSWORD_HASH: "" });
    expect(uiRes.status).toBe(200);
  });
});
