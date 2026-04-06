import { Hono } from "hono";
import type { Env } from "../types";
import { getR2Object, getMimeType } from "../storage/r2";

const ui = new Hono<{ Bindings: Env }>();

// Serve static UI files from R2 `_ui/` prefix
ui.get("/*", async (c) => {
  const pathname = new URL(c.req.url).pathname;

  // Try exact file
  const r2Key = `_ui${pathname}`;
  const obj = await getR2Object(c.env.BUCKET, r2Key);
  if (obj) {
    return new Response(obj.body, {
      headers: { "Content-Type": getMimeType(pathname) },
    });
  }

  // SPA fallback — serve index.html
  const indexObj = await getR2Object(c.env.BUCKET, "_ui/index.html");
  if (indexObj) {
    return new Response(indexObj.body, {
      headers: { "Content-Type": "text/html" },
    });
  }

  return c.text("Not found", 404);
});

export { ui };
