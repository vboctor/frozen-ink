import { Hono } from "hono";
import type { Env } from "../types";
import { getR2Object, getMimeType } from "../storage/r2";

const ui = new Hono<{ Bindings: Env }>();

// Vite outputs hashed filenames for all assets under /assets/
// These are safe to cache forever (immutable). Everything else is short-lived.
function getCacheControl(pathname: string): string {
  if (pathname === "/" || pathname === "/index.html") {
    // Always revalidate the HTML entry point — it references hashed asset filenames
    return "no-cache";
  }
  if (pathname.startsWith("/assets/")) {
    // Content-hashed by Vite — safe to cache for 1 year
    return "public, max-age=31536000, immutable";
  }
  // Other static files (favicon, etc.) — cache for 1 hour
  return "public, max-age=3600";
}

// Serve static UI files from R2 `_ui/` prefix
ui.get("/*", async (c) => {
  const pathname = c.req.path;

  // Try exact file
  const r2Key = `_ui${pathname}`;
  const obj = await getR2Object(c.env.BUCKET, r2Key);
  if (obj) {
    return new Response(obj.body, {
      headers: {
        "Content-Type": getMimeType(pathname),
        "Cache-Control": getCacheControl(pathname),
      },
    });
  }

  // SPA fallback — serve index.html (always revalidate)
  const indexObj = await getR2Object(c.env.BUCKET, "_ui/index.html");
  if (indexObj) {
    return new Response(indexObj.body, {
      headers: {
        "Content-Type": "text/html",
        "Cache-Control": "no-cache",
      },
    });
  }

  return c.text("Not found", 404);
});

export { ui };
