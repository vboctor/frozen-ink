# CLAUDE.md

See [AGENTS.md](AGENTS.md) for full project context, architecture, schemas, conventions, and navigation guide.

## Pre-push checklist

Always run `bun run ci` before pushing. This mirrors the full GitHub Actions CI pipeline including markdown lint, typecheck, all test suites (bun + vitest), UI build, and **worker build**. The worker build (Cloudflare Workers via esbuild) catches imports that work in Node/Bun but fail in the Workers runtime (e.g., `"path"`, `"fs"`).
