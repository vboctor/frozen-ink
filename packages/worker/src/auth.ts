import type { Context, Next } from "hono";
import type { Env } from "./types";

const COOKIE_NAME = "fink_token";
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 days

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function base64UrlEncode(input: string): string {
  return btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(input: string): string {
  const padded = `${input}${"=".repeat((4 - (input.length % 4)) % 4)}`
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  return atob(padded);
}

async function signSession(payloadB64: string, key: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(payloadB64));
  return base64UrlEncode(String.fromCharCode(...new Uint8Array(sigBuf)));
}

async function createSessionToken(passwordHash: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({ iat: now, exp: now + COOKIE_MAX_AGE });
  const payloadB64 = base64UrlEncode(payload);
  const sig = await signSession(payloadB64, passwordHash);
  return `${payloadB64}.${sig}`;
}

async function verifySessionToken(token: string, passwordHash: string): Promise<boolean> {
  const [payloadB64, providedSig] = token.split(".");
  if (!payloadB64 || !providedSig) return false;

  const expectedSig = await signSession(payloadB64, passwordHash);
  if (!constantTimeEqual(providedSig, expectedSig)) return false;

  try {
    const payloadRaw = base64UrlDecode(payloadB64);
    const payload = JSON.parse(payloadRaw) as { exp?: number };
    const now = Math.floor(Date.now() / 1000);
    return typeof payload.exp === "number" && payload.exp > now;
  } catch {
    return false;
  }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const data = new TextEncoder().encode(salt + password);
  const hashBuf = await crypto.subtle.digest("SHA-256", data);
  const hashHex = toHex(hashBuf);
  return `${salt}:${hashHex}`;
}

async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [salt, expectedHash] = storedHash.split(":");
  if (!salt || !expectedHash) return false;
  const data = new TextEncoder().encode(salt + password);
  const hashBuf = await crypto.subtle.digest("SHA-256", data);
  const hashHex = toHex(hashBuf);
  return constantTimeEqual(hashHex, expectedHash);
}

function parseCookies(header: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key) cookies[key.trim()] = rest.join("=").trim();
  }
  return cookies;
}

export function setCookieHeader(token: string): string {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Strict; Max-Age=${COOKIE_MAX_AGE}; Path=/`;
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
    if (token && await verifySessionToken(decodeURIComponent(token), passwordHash)) {
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

  const sessionToken = await createSessionToken(passwordHash);

  return new Response(null, {
    status: 302,
    headers: {
      Location: "/",
      "Set-Cookie": setCookieHeader(sessionToken),
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
