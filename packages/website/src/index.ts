import html from "./site.html";
import ogImageSvg from "./og-image.svg";

// Base64-encode the PNG at build time isn't possible with text modules,
// so we import the PNG as a binary module via a separate rule.
import ogImagePng from "./og-image.png";

import { gettingStartedPage } from "./docs/getting-started";
import { whatIsFrozenInkPage } from "./docs/what-is-frozen-ink";
import { keyScenariosPage } from "./docs/key-scenarios";
import { managingCollectionsPage } from "./docs/managing-collections";
import { claudeCodePage } from "./docs/claude-code";
import { claudeCoworkPage } from "./docs/claude-cowork";
import { claudeDesktopPage } from "./docs/claude-desktop";
import { codexCliPage } from "./docs/codex-cli";
import { chatgptDesktopPage } from "./docs/chatgpt-desktop";
import { anythingllmMcpPage } from "./docs/anythingllm-mcp";
import { publishingPage } from "./docs/publishing";
import { desktopAppPage } from "./docs/desktop-app";
import { connectorGithubPage } from "./docs/connector-github";
import { connectorObsidianPage } from "./docs/connector-obsidian";
import { connectorGitPage } from "./docs/connector-git";
import { connectorMantishubPage } from "./docs/connector-mantishub";

const DOC_PAGES: Record<string, string> = {
  "/docs": gettingStartedPage,
  "/docs/what-is-frozen-ink": whatIsFrozenInkPage,
  "/docs/key-scenarios": keyScenariosPage,
  "/docs/managing-collections": managingCollectionsPage,
  "/docs/claude-code": claudeCodePage,
  "/docs/claude-cowork": claudeCoworkPage,
  "/docs/claude-desktop": claudeDesktopPage,
  "/docs/codex-cli": codexCliPage,
  "/docs/chatgpt-desktop": chatgptDesktopPage,
  "/docs/anythingllm-mcp": anythingllmMcpPage,
  "/docs/publishing": publishingPage,
  "/docs/desktop-app": desktopAppPage,
  "/docs/connectors/github": connectorGithubPage,
  "/docs/connectors/obsidian": connectorObsidianPage,
  "/docs/connectors/git": connectorGitPage,
  "/docs/connectors/mantishub": connectorMantishubPage,
};

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";

    if (path === "/" || path === "/index.html") {
      return new Response(html, {
        headers: {
          "content-type": "text/html;charset=UTF-8",
          "cache-control": "no-cache",
        },
      });
    }

    if (path === "/og.png") {
      return new Response(ogImagePng, {
        headers: {
          "content-type": "image/png",
          "cache-control": "public, max-age=86400",
        },
      });
    }

    if (path === "/og.svg") {
      return new Response(ogImageSvg, {
        headers: {
          "content-type": "image/svg+xml",
          "cache-control": "public, max-age=86400",
        },
      });
    }

    const docPage = DOC_PAGES[path];
    if (docPage) {
      return new Response(docPage, {
        headers: {
          "content-type": "text/html;charset=UTF-8",
          "cache-control": "no-cache",
        },
      });
    }

    return Response.redirect(new URL("/", request.url).toString(), 301);
  },
};
