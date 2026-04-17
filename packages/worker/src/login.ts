import type { Context } from "hono";
import type { Env } from "./types";

export function renderLoginPage(c: Context<{ Bindings: Env }>): Response {
  const url = new URL(c.req.url);
  const hasError = url.searchParams.has("error");
  const workerName = c.env.WORKER_NAME || "Frozen Ink";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Login — ${workerName}</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f0f0f; color: #e0e0e0;
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh;
    }
    .login-card {
      background: #1a1a1a; border: 1px solid #333; border-radius: 12px;
      padding: 2rem; width: 100%; max-width: 360px;
    }
    h1 { font-size: 1.25rem; margin-bottom: 1.5rem; text-align: center; }
    .error { color: #f87171; font-size: 0.875rem; margin-bottom: 1rem; text-align: center; }
    label { display: block; font-size: 0.875rem; margin-bottom: 0.5rem; color: #999; }
    input[type="password"] {
      width: 100%; padding: 0.625rem 0.75rem; border: 1px solid #444;
      border-radius: 6px; background: #111; color: #e0e0e0;
      font-size: 1rem; outline: none;
    }
    input[type="password"]:focus { border-color: #6366f1; }
    button {
      width: 100%; margin-top: 1rem; padding: 0.625rem;
      background: #6366f1; color: white; border: none; border-radius: 6px;
      font-size: 1rem; cursor: pointer;
    }
    button:hover { background: #4f46e5; }
  </style>
</head>
<body>
  <div class="login-card">
    <h1>${workerName}</h1>
    ${hasError ? '<p class="error">Invalid password. Please try again.</p>' : ""}
    <form method="POST" action="/login">
      <label for="password">Password</label>
      <input type="password" id="password" name="password" autofocus required>
      <button type="submit">Sign in</button>
    </form>
  </div>
</body>
</html>`;

  return c.html(html);
}
