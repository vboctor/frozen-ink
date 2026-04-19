import html from "./site.html";
import ogImageSvg from "./og-image.svg";

// Base64-encode the PNG at build time isn't possible with text modules,
// so we import the PNG as a binary module via a separate rule.
import ogImagePng from "./og-image.png";
import vboctorJpg from "./vboctor.jpg";

import { gettingStartedPage } from "./docs/getting-started";
import { whatIsFrozenInkPage } from "./docs/what-is-frozen-ink";
import { keyScenariosPage } from "./docs/key-scenarios";
import { managingCollectionsPage } from "./docs/managing-collections";
import { claudeCodePage } from "./docs/claude-code";
import { claudeCoworkPage } from "./docs/claude-cowork";
import { claudeDesktopPage } from "./docs/claude-desktop";
import { codexCliPage } from "./docs/codex-cli";
import { chatgptDesktopPage } from "./docs/chatgpt-desktop";
import { publishingPage } from "./docs/publishing";
import { desktopAppPage } from "./docs/desktop-app";
import { localMcpPage } from "./docs/local-mcp";
import { cloudMcpPage } from "./docs/cloud-mcp";
import { connectorGithubPage } from "./docs/connector-github";
import { connectorObsidianPage } from "./docs/connector-obsidian";
import { connectorGitPage } from "./docs/connector-git";
import { connectorMantishubPage } from "./docs/connector-mantishub";
import { connectorRssPage } from "./docs/connector-rss";
import { clonePullPage } from "./docs/clone-pull";
import { cliReferencePage } from "./docs/cli-reference";
import { configurationPage } from "./docs/configuration";

const DOC_PAGES: Record<string, string> = {
  "/docs": gettingStartedPage,
  "/docs/what-is-frozen-ink": whatIsFrozenInkPage,
  "/docs/key-scenarios": keyScenariosPage,
  "/docs/collections": managingCollectionsPage,
  "/docs/clone-pull": clonePullPage,
  "/docs/publishing": publishingPage,
  "/docs/desktop-app": desktopAppPage,
  "/docs/connectors/github": connectorGithubPage,
  "/docs/connectors/obsidian": connectorObsidianPage,
  "/docs/connectors/git": connectorGitPage,
  "/docs/connectors/mantishub": connectorMantishubPage,
  "/docs/connectors/rss": connectorRssPage,
  "/docs/integrations/local-mcp": localMcpPage,
  "/docs/integrations/cloud-mcp": cloudMcpPage,
  "/docs/integrations/claude-code": claudeCodePage,
  "/docs/integrations/claude-cowork": claudeCoworkPage,
  "/docs/integrations/claude-desktop": claudeDesktopPage,
  "/docs/integrations/codex-cli": codexCliPage,
  "/docs/integrations/chatgpt-desktop": chatgptDesktopPage,
  "/docs/reference/cli": cliReferencePage,
  "/docs/reference/configuration": configurationPage,
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

    if (path === "/vboctor.jpg") {
      return new Response(vboctorJpg, {
        headers: {
          "content-type": "image/jpeg",
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

    // Redirects from old URLs to new locations
    const REDIRECTS: Record<string, string> = {
      "/docs/managing-collections": "/docs/collections",
      "/docs/claude-code": "/docs/integrations/claude-code",
      "/docs/claude-cowork": "/docs/integrations/claude-cowork",
      "/docs/claude-desktop": "/docs/integrations/claude-desktop",
      "/docs/codex-cli": "/docs/integrations/codex-cli",
      "/docs/chatgpt-desktop": "/docs/integrations/chatgpt-desktop",
      "/docs/local-mcp": "/docs/integrations/local-mcp",
      "/docs/cloud-mcp": "/docs/integrations/cloud-mcp",
    };

    const redirect = REDIRECTS[path];
    if (redirect) {
      return Response.redirect(
        new URL(redirect, request.url).toString(),
        301
      );
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
