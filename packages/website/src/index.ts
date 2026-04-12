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
import { localMcpPage } from "./docs/local-mcp";
import { anythingllmMcpPage } from "./docs/anythingllm-mcp";
import { publishingPage } from "./docs/publishing";
import { cloudMcpPage } from "./docs/cloud-mcp";
import { desktopAppPage } from "./docs/desktop-app";
import { connectorGithubPage } from "./docs/connector-github";
import { connectorObsidianPage } from "./docs/connector-obsidian";
import { connectorGitPage } from "./docs/connector-git";
import { connectorMantisbtPage } from "./docs/connector-mantisbt";

const DOC_PAGES: Record<string, string> = {
  "/docs": gettingStartedPage,
  "/docs/what-is-frozen-ink": whatIsFrozenInkPage,
  "/docs/key-scenarios": keyScenariosPage,
  "/docs/managing-collections": managingCollectionsPage,
  "/docs/claude-code": claudeCodePage,
  "/docs/local-mcp": localMcpPage,
  "/docs/anythingllm-mcp": anythingllmMcpPage,
  "/docs/publishing": publishingPage,
  "/docs/cloud-mcp": cloudMcpPage,
  "/docs/desktop-app": desktopAppPage,
  "/docs/connectors/github": connectorGithubPage,
  "/docs/connectors/obsidian": connectorObsidianPage,
  "/docs/connectors/git": connectorGitPage,
  "/docs/connectors/mantisbt": connectorMantisbtPage,
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
