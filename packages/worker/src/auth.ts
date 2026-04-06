import type { Context, Next } from "hono";
import type { Env } from "./types";

const COOKIE_NAME = "vctx_token";
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 days

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const data = new TextEncoder().encode(salt + password);
  const hashBuf = await crypto.subtle.digest("SHA-256", data);
  const hashHex = Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${salt}:${hashHex}`;
}

async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [salt, expectedHash] = storedHash.split(":");
  if (!salt || !expectedHash) return false;
  const data = new TextEncoder().encode(salt + password);
  const hashBuf = await crypto.subtle.digest("SHA-256", data);
  const hashHex = Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hashHex === expectedHash;
}

function parseCookies(header: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key) cookies[key.trim()] = rest.join("=").trim();
  }
  return cookies;
}

export function setCookieHeader(password: string): string {
  return `${COOKIE_NAME}=${encodeURIComponent(password)}; HttpOnly; Secure; SameSite=Strict; Max-Age=${COOKIE_MAX_AGE}; Path=/`;
}

export function clearCookieHeader(): string {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Max-Age=0; Path=/`;
}

export async function authMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
  const passwordHash = c.env.PASSWORD_HASH;

  // No password set — allow all
  if (!passwordHash) {
    return next();
  }

  // Check Bearer token (API/MCP)
  const authHeader = c.req.header("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    if (await verifyPassword(token, passwordHash)) {
      return next();
    }
    return c.json({ error: "Unauthorized" }, 401);
  }

  // Check cookie (browser)
  const cookieHeader = c.req.header("Cookie");
  if (cookieHeader) {
    const cookies = parseCookies(cookieHeader);
    const token = cookies[COOKIE_NAME];
    if (token && await verifyPassword(decodeURIComponent(token), passwordHash)) {
      return next();
    }
  }

  // For API/MCP requests, return 401 JSON
  const path = new URL(c.req.url).pathname;
  if (path.startsWith("/api/") || path.startsWith("/mcp")) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  // For browser requests, redirect to login
  return c.redirect("/login");
}

export async function handleLogin(c: Context<{ Bindings: Env }>): Promise<Response> {
  const passwordHash = c.env.PASSWORD_HASH;
  if (!passwordHash) {
    return c.redirect("/");
  }

  const body = await c.req.parseBody();
  const password = body.password as string;

  if (!password || !(await verifyPassword(password, passwordHash))) {
    return c.redirect("/login?error=1");
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: "/",
      "Set-Cookie": setCookieHeader(password),
    },
  });
}

export function handleLogout(c: Context<{ Bindings: Env }>): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: "/login",
      "Set-Cookie": clearCookieHeader(),
    },
  });
}
