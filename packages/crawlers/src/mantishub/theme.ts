import type { Theme, ThemeRenderContext } from "@frozenink/core/theme";
import { frontmatter, wikilink } from "@frozenink/core/theme";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function requiredDataString(context: ThemeRenderContext, field: string): string {
  const value = context.entity.data[field];
  if (typeof value === "string" && value.trim()) return value;
  throw new Error(`Missing required field "${field}"`);
}

function padId(id: number): string {
  return String(id).padStart(5, "0");
}

/**
 * Convert an attachment storagePath to a relative reference from a markdown file.
 * Assets are stored as siblings in an `assets/` dir next to the markdown files,
 * so the reference is always `assets/<filename>`.
 */
function assetRef(storagePath: string | undefined): string {
  if (!storagePath) return "";
  const filename = storagePath.split("/").pop() ?? storagePath;
  return `assets/${filename}`;
}

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp"]);

function isImageFile(filename: string): boolean {
  const dot = filename.lastIndexOf(".");
  return dot !== -1 && IMAGE_EXTS.has(filename.slice(dot).toLowerCase());
}

/**
 * Render a single attachment in HTML.
 * Images: inline <img>. Text files: lazy-loading <details> block matching MantisBT UI.
 * If not downloaded locally, shows a link to download directly from the source.
 */
function renderAttachmentHtml(
  att: { filename: string; storagePath?: string; size: number },
  collectionName: string,
  fallbackUrl?: string,
): string {
  const sizeKb = Math.round(att.size / 1024) || "<1";
  if (!att.storagePath) {
    const link = fallbackUrl
      ? ` <a class="mt-attachment-download-link" href="${esc(fallbackUrl)}" target="_blank" rel="noopener noreferrer">↓ download</a>`
      : "";
    return `<div class="mt-attachment-item mt-attachment-unavailable">${esc(att.filename)} <span class="mt-attachment-size">(${sizeKb} KB — not downloaded${link})</span></div>`;
  }
  const fileUrl = `/api/collections/${encodeURIComponent(collectionName)}/file/${att.storagePath.split("/").map(encodeURIComponent).join("/")}`;
  if (isImageFile(att.filename)) {
    return `<div class="mt-attachment-item mt-attachment-image-wrap"><img src="${fileUrl}" alt="${esc(att.filename)}" class="mt-attachment-image" loading="lazy"></div>`;
  }
  // Text / binary: collapsible block with lazy content load
  return `<details class="mt-attachment-item mt-attachment-text" data-url="${fileUrl}"><summary>${esc(att.filename)} <span class="mt-attachment-size">(${sizeKb} KB)</span></summary><pre class="mt-attachment-content">Loading…</pre></details>`;
}

/** Returns the wikilink path (no extension) for an issue by id and summary. */
function issueFilePath(id: number, summary: string, projectName?: string): string {
  const slug = slugify(summary);
  const issuePart = slug ? `${padId(id)}-${slug}` : padId(id);
  const projectSlug = slugify(projectName ?? "unknown") || "unknown";
  return `${projectSlug}/issues/${issuePart}`;
}

function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateCompact(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }) + " " + d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function tableRow(label: string, value: string): string {
  return `| **${label}** | ${value} |`;
}

// ── HTML rendering helpers ─────────────────────────────────────

function esc(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Deterministic color from a name string. */
function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const palette = ["#e74c3c", "#8e44ad", "#2980b9", "#16a085", "#27ae60", "#f39c12", "#d35400", "#34495e", "#c0392b", "#7f8c8d"];
  return palette[Math.abs(hash) % palette.length];
}

/** Render a round avatar — real image when URL provided, initials circle otherwise. */
function mtAvatar(name: string, avatarUrl?: string | null, size = 24): string {
  if (avatarUrl) {
    return `<img class="mt-avatar" src="${esc(avatarUrl)}" width="${size}" height="${size}" alt="${esc(name)}" />`;
  }
  const initial = (name || "?").charAt(0).toUpperCase();
  const bg = avatarColor(name || "?");
  return `<span class="mt-avatar mt-avatar-fallback" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.48)}px;background:${bg}">${initial}</span>`;
}

type Lookup = (externalId: string) => string | undefined;

/**
 * Convert plain text to HTML with escaped entities, line breaks,
 * and #1234 issue references / @mentions converted to wikilinks.
 */
function textToHtml(
  text: string,
  lookup?: Lookup,
  projectId?: number,
): string {
  let html = esc(text);

  if (lookup) {
    // Resolve cross-project page links: [[/project-name/page-name]]
    html = html.replace(/\[\[\/(.+?)\/([\w-]+)\]\]/g, (match, projName: string, pageName: string) => {
      const rawProjName = projName.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
      const path = `${slugify(rawProjName)}/pages/${slugify(pageName)}`;
      return `<a class="mt-page-link" href="#wikilink/${encodeURIComponent(path)}">${projName}/${esc(pageName)}</a>`;
    });

    // Resolve same-project page links: [[page-name]]
    html = html.replace(/\[\[([\w-]+)\]\]/g, (match, pageName: string) => {
      if (!projectId) return match;
      const path = lookup(`page:${projectId}:${pageName}`);
      if (!path) return match;
      return `<a class="mt-page-link" href="#wikilink/${encodeURIComponent(path)}">${esc(pageName)}</a>`;
    });

    // Linkify #1234 issue references
    html = html.replace(/#(\d+)/g, (match, id) => {
      const path = lookup(`issue:${id}`);
      if (!path) return match;
      return `<a class="mt-issue-ref" href="#wikilink/${encodeURIComponent(path)}">#${padId(parseInt(id))}</a>`;
    });

    // Linkify @mentions to user entities
    html = html.replace(/@([a-zA-Z0-9_.-]+)/g, (match, name) => {
      const path = lookup(`user:${name}`);
      if (!path) return match;
      return `<a class="mt-user-link" href="#wikilink/${encodeURIComponent(path)}">@${esc(name)}</a>`;
    });
  }

  // Bare URLs
  html = html.replace(
    /(?<!="|>)(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>',
  );

  // Convert line breaks
  html = html.replace(/\n/g, "<br>");

  return html;
}

/**
 * Convert markdown text to HTML, resolving MantisHub cross-entity references.
 * Handles fenced code blocks, inline code, headings, bold/italic, unordered and
 * ordered lists, blockquotes, markdown links, bare URLs, #issue refs, @mentions,
 * and [[page]] / [[/project/page]] wiki links.
 */
function markdownToHtml(
  text: string,
  lookup?: Lookup,
  projectId?: number,
): string {
  let raw = text.replace(/\r\n/g, "\n");

  // ── Step 1: extract fenced code blocks (their newlines are preserved via placeholder) ──
  const codeBlocks: string[] = [];
  raw = raw.replace(/```([^\n]*)\n([\s\S]*?)```/g, (_m, langLine: string, code: string) => {
    const idx = codeBlocks.length;
    const lang = langLine.trim().split(/\s/)[0] || "";
    // Escape the code content; newlines inside pre blocks are preserved via \x00PRENL\x00
    const escapedCode = esc(code.replace(/\n$/, "")).replace(/\n/g, "\x00PRENL\x00");
    const langClass = lang ? ` class="language-${esc(lang)}"` : "";
    codeBlocks.push(`<pre class="mt-code-block"><code${langClass}>${escapedCode}</code></pre>`);
    return `\x00CODEBLOCK${idx}\x00`;
  });

  // ── Step 2: extract markdown links [text](url) before escaping ──
  const links: string[] = [];
  raw = raw.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, (_m, linkText: string, url: string) => {
    const idx = links.length;
    links.push(`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(linkText)}</a>`);
    return `\x00LINK${idx}\x00`;
  });

  // ── Step 3: resolve MantisHub page links before escaping (names may have &, <, >) ──
  if (lookup) {
    // Cross-project: [[/project-name/page-name]]
    raw = raw.replace(/\[\[\/(.+?)\/([\w-]+)\]\]/g, (_m, projName: string, pageName: string) => {
      const path = `${slugify(projName)}/pages/${slugify(pageName)}`;
      const idx = links.length;
      links.push(`<a class="mt-page-link" href="#wikilink/${encodeURIComponent(path)}">${esc(projName)}/${esc(pageName)}</a>`);
      return `\x00LINK${idx}\x00`;
    });
    // Same-project: [[page-name]]
    raw = raw.replace(/\[\[([\w-]+)\]\]/g, (_m, pageName: string) => {
      const path = projectId ? lookup(`page:${projectId}:${pageName}`) : undefined;
      const idx = links.length;
      if (!path) {
        links.push(`<span class="mt-page-link mt-page-missing" title="Page not found">${esc(pageName)}</span>`);
      } else {
        links.push(`<a class="mt-page-link" href="#wikilink/${encodeURIComponent(path)}">${esc(pageName)}</a>`);
      }
      return `\x00LINK${idx}\x00`;
    });
  } else {
    raw = raw.replace(/\[\[\/(.+?)\/([\w-]+)\]\]/g, (_m, projName: string, pageName: string) => {
      const idx = links.length;
      links.push(`<span class="mt-page-link mt-page-missing" title="Page not found">${esc(projName)}/${esc(pageName)}</span>`);
      return `\x00LINK${idx}\x00`;
    });
    raw = raw.replace(/\[\[([\w-]+)\]\]/g, (_m, pageName: string) => {
      const idx = links.length;
      links.push(`<span class="mt-page-link mt-page-missing" title="Page not found">${esc(pageName)}</span>`);
      return `\x00LINK${idx}\x00`;
    });
  }

  // ── Step 4: HTML-escape remaining text ──
  let html = esc(raw);

  // ── Step 5: restore code blocks and links ──
  html = html.replace(/\x00CODEBLOCK(\d+)\x00/g, (_m, idx) => codeBlocks[parseInt(idx)]);
  html = html.replace(/\x00LINK(\d+)\x00/g, (_m, idx) => links[parseInt(idx)]);

  // ── Step 6: inline code (backticks survive esc; content inside is already escaped) ──
  html = html.replace(/`([^`\n]+)`/g, "<code>$1</code>");

  // ── Step 7: bold and italic ──
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/(?<!\w)\*(.+?)\*(?!\w)/g, "<em>$1</em>");

  // ── Step 8: issue refs (#1234) and @mentions ──
  if (lookup) {
    html = html.replace(/#(\d+)/g, (_m, id: string) => {
      const path = lookup(`issue:${id}`);
      if (!path) return `#${id}`;
      return `<a class="mt-issue-ref" href="#wikilink/${encodeURIComponent(path)}">#${padId(parseInt(id))}</a>`;
    });
    html = html.replace(/@([a-zA-Z0-9_.-]+)/g, (_m, name: string) => {
      const path = lookup(`user:${name}`);
      if (!path) return `@${name}`;
      return `<a class="mt-user-link" href="#wikilink/${encodeURIComponent(path)}">@${name}</a>`;
    });
  }

  // ── Step 9: bare URLs (not already inside an href) ──
  html = html.replace(
    /(?<!="|>)(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>',
  );

  // ── Step 10: headings (### etc) ──
  html = html.replace(/^(#{1,6})\s+(.+)$/gm, (_m, hashes: string, content: string) => {
    return `<h${hashes.length} class="mt-md-h${hashes.length}">${content}</h${hashes.length}>`;
  });

  // ── Step 11: unordered lists (groups of "- ", "* ", or "+ " lines) ──
  html = html.replace(/((?:^[ \t]*[-*+] .+(?:\n|$))+)/gm, (block) => {
    const items = block.trim().split("\n")
      .map((line) => { const m = line.match(/^[ \t]*[-*+] (.+)$/); return m ? `<li>${m[1]}</li>` : ""; })
      .filter(Boolean).join("");
    return `<ul class="mt-md-list">${items}</ul>`;
  });

  // ── Step 12: ordered lists (groups of "1. " lines) ──
  html = html.replace(/((?:^[ \t]*\d+\. .+(?:\n|$))+)/gm, (block) => {
    const items = block.trim().split("\n")
      .map((line) => { const m = line.match(/^[ \t]*\d+\. (.+)$/); return m ? `<li>${m[1]}</li>` : ""; })
      .filter(Boolean).join("");
    return `<ol class="mt-md-list">${items}</ol>`;
  });

  // ── Step 13: blockquotes (">" becomes "&gt;" after escaping) ──
  html = html.replace(/((?:^&gt; .+(?:\n|$))+)/gm, (block) => {
    const content = block.trim().split("\n")
      .map((line) => line.replace(/^&gt; /, "")).join("<br>");
    return `<blockquote class="mt-md-blockquote">${content}</blockquote>`;
  });

  // ── Step 14: paragraphs (blank lines separate blocks) ──
  html = html.replace(/\n\n+/g, "</p><p>");
  html = `<p>${html}</p>`;
  html = html.replace(/<p>\s*<\/p>/g, "");
  // Unwrap block elements incorrectly wrapped in <p>
  html = html.replace(/<p>(\s*<(?:h[1-6]|pre|ul|ol|blockquote)[ >])/g, "$1");
  html = html.replace(/(<\/(?:h[1-6]|pre|ul|ol|blockquote)>\s*)<\/p>/g, "$1");

  // ── Step 15: single newlines → <br> (within paragraphs) ──
  html = html.replace(/\n/g, "<br>");

  // ── Step 16: restore pre-block newlines (so code blocks stay as literal newlines) ──
  html = html.replace(/\x00PRENL\x00/g, "\n");

  return html;
}

/** Render a username as a link to the user entity, prefixed with @. */
function mtUserLink(name: string, lookup?: Lookup): string {
  const path = lookup?.(`user:${name}`);
  if (path) {
    return `<a class="mt-user-link" href="#wikilink/${encodeURIComponent(path)}">@${esc(name)}</a>`;
  }
  return `@${esc(name)}`;
}

/** Render a user's full name as a link to the user entity (no @ prefix). */
function mtUserLinkFull(username: string, fullName: string, lookup?: Lookup): string {
  const path = lookup?.(`user:${username}`);
  if (path) {
    return `<a class="mt-user-link" href="#wikilink/${encodeURIComponent(path)}">${esc(fullName)}</a>`;
  }
  return esc(fullName);
}

/** Render a project name as a link to the project entity (underline on hover only). */
function mtProjectLink(project: { id: number; name: string }, lookup?: Lookup): string {
  const path = lookup?.(`project:${project.id}`);
  if (path) {
    return `<a class="mt-project-link" href="#wikilink/${encodeURIComponent(path)}">${esc(project.name)}</a>`;
  }
  return esc(project.name);
}

function mtSidebarRow(label: string, value: string): string {
  return `<div class="mt-sidebar-row"><div class="mt-sidebar-label">${esc(label)}</div><div class="mt-sidebar-value">${value}</div></div>`;
}

function statusColor(status: { color?: string; name?: string }): string {
  if (status.color) return status.color;
  // Fallback colors based on common MantisHub status names
  switch (status.name) {
    case "new": return "#fcbdbd";
    case "feedback": return "#e3b7eb";
    case "acknowledged": return "#ffcd85";
    case "confirmed": return "#fff494";
    case "assigned": return "#c2dfff";
    case "resolved": return "#d2f5b0";
    case "closed": return "#c9ccc4";
    default: return "#e8e8e8";
  }
}

function priorityIndicator(name: string): string {
  const colors: Record<string, string> = {
    none: "#ccc",
    low: "#83c67e",
    normal: "#f0ad4e",
    high: "#e67e22",
    urgent: "#e74c3c",
    immediate: "#c0392b",
  };
  const color = colors[(name ?? "").toLowerCase()] ?? "#999";
  return `<span class="mt-priority-dash" style="color:${color}">&mdash;</span>`;
}

/**
 * Linkify all cross-entity references in prose text for markdown output.
 * Handles: #1234 issue refs, @username mentions, [[page-name]] same-project
 * page links, and [[/project-name/page-name]] cross-project page links.
 * Skips text inside code fences and inline code.
 */
function linkifyContent(
  text: string,
  lookup: (externalId: string) => string | undefined,
  projectId?: number,
): string {
  // Split on code fences and inline code to avoid corrupting code samples.
  const codeSkip = /(```[\s\S]*?```|`[^`\n]+`)/g;
  const parts: string[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = codeSkip.exec(text)) !== null) {
    parts.push(linkifySegment(text.slice(last, m.index), lookup, projectId));
    parts.push(m[0]);
    last = m.index + m[0].length;
  }
  parts.push(linkifySegment(text.slice(last), lookup, projectId));
  return parts.join("");
}

/**
 * Process a single non-code text segment: first resolve [[...]] page links,
 * then linkify #issue refs and @mentions while skipping resulting wikilinks.
 */
function linkifySegment(
  text: string,
  lookup: (externalId: string) => string | undefined,
  projectId?: number,
): string {
  // Step 1: Resolve cross-project page links [[/project-name/page-name]]
  text = text.replace(/\[\[\/(.+?)\/([\w-]+)\]\]/g, (_match, projName: string, pageName: string) => {
    const path = `${slugify(projName)}/pages/${slugify(pageName)}`;
    return `[[${path}|${projName}/${pageName}]]`;
  });

  // Step 2: Resolve same-project page links [[page-name]]
  // Only match bare [[word-chars]] that haven't been resolved yet (no | inside).
  text = text.replace(/\[\[([\w-]+)\]\]/g, (match, pageName: string) => {
    if (!projectId) return match;
    const path = lookup(`page:${projectId}:${pageName}`);
    if (!path) return match;
    return `[[${path}|${pageName}]]`;
  });

  // Step 3: Linkify #issue refs and @mentions, skipping inside [[...]] blocks
  const wikiSkip = /\[\[[^\]]*\]\]/g;
  const parts: string[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = wikiSkip.exec(text)) !== null) {
    parts.push(replaceInlineRefs(text.slice(last, m.index), lookup));
    parts.push(m[0]);
    last = m.index + m[0].length;
  }
  parts.push(replaceInlineRefs(text.slice(last), lookup));
  return parts.join("");
}

/** Replace #issue refs and @mentions in a text fragment (no wikilinks inside). */
function replaceInlineRefs(
  text: string,
  lookup: (externalId: string) => string | undefined,
): string {
  // #1234 issue references
  text = text.replace(/#(\d+)/g, (match, id) => {
    const path = lookup(`issue:${id}`);
    if (!path) return match;
    return `[[${path}|#${padId(parseInt(id))}]]`;
  });

  // @username mentions
  text = text.replace(/@([a-zA-Z0-9_.-]+)/g, (match, name) => {
    const path = lookup(`user:${name}`);
    if (!path) return match;
    return `[[${path}|@${name}]]`;
  });

  return text;
}

/** Render a username as a link to the user entity in markdown, prefixed with @. */
function mdUserRef(
  username: string,
  lookup: (externalId: string) => string | undefined,
  sourcePath?: string,
): string {
  const path = lookup(`user:${username}`);
  if (path) {
    return wikilink(path, `@${username}`, sourcePath);
  }
  return `@${username}`;
}

/** Render a user's full name as a link to the user entity in markdown (no @ prefix). */
function mdUserRefFull(
  username: string,
  fullName: string,
  lookup: (externalId: string) => string | undefined,
  sourcePath?: string,
): string {
  const path = lookup(`user:${username}`);
  if (path) {
    return wikilink(path, fullName, sourcePath);
  }
  return fullName;
}

/** Returns the file path (no extension) for a page. */
function pageFilePath(name: string, projectName?: string): string {
  const slug = slugify(name);
  const pagePart = slug || name;
  const projectSlug = slugify(projectName ?? "unknown") || "unknown";
  return `${projectSlug}/pages/${pagePart}`;
}

export class MantisHubTheme implements Theme {
  crawlerType = "mantishub";

  render(context: ThemeRenderContext): string {
    if (context.entity.entityType === "user") return this.renderUserMd(context);
    if (context.entity.entityType === "project") return this.renderProjectMd(context);
    if (context.entity.entityType === "page") return this.renderPageMd(context);
    return this.renderIssue(context);
  }

  folderConfigs() {
    return {
      issues: { sort: "DESC" as const, showCount: true },
      pages: { showCount: true },
      users: { showCount: true, expanded: false },
      assets: { visible: false },
    };
  }

  agentsMarkdown(options: { title: string; description?: string; config?: Record<string, unknown> }): string {
    const { title, description, config } = options;
    const baseUrl = config?.baseUrl as string | undefined;
    const hostRef = baseUrl ? ` at **${baseUrl}**` : "";

    const lines: string[] = [];
    lines.push(`# ${title}`);
    lines.push("");
    if (description) {
      lines.push(description);
    } else {
      lines.push(`This collection is synced from a MantisHub instance${hostRef}.`);
    }
    lines.push("");
    lines.push("## Entity Types");
    lines.push("");
    lines.push("### Issues (`issues/`)");
    lines.push("Issues represent a feature request, a task, or a bug report. Each issue is stored as a Markdown file with frontmatter containing status, priority, severity, category, and reporter. Files include the full description, notes, and references to attachments.");
    lines.push("");
    lines.push("### Projects (`projects/`)");
    lines.push("Projects are containers for issues and wiki pages. A set of users generally have visibility and contribute to a project. Each project is stored as `projects/{name}.md`.");
    lines.push("");
    lines.push("### Users (`users/`)");
    lines.push("These are user profile pages and are references from issues and wiki pages where such users are referenced. Each user is stored as `users/{name}.md`.");
    lines.push("");
    lines.push("### Pages (`pages/`)");
    lines.push("Pages are wiki pages associated with projects. Each page is stored as `pages/{name}.md`.");
    return lines.join("\n") + "\n";
  }

  getFilePath(context: ThemeRenderContext): string {
    const d = context.entity.data;

    if (context.entity.entityType === "user") {
      const name = requiredDataString(context, "name");
      return `users/${slugify(name)}.md`;
    }

    if (context.entity.entityType === "project") {
      const name = requiredDataString(context, "name");
      const slug = slugify(name);
      // Project entity lives inside its own project folder so every project's
      // issues/pages/metadata nest together under one subtree.
      return `${slug}/${slug}.md`;
    }

    if (context.entity.entityType === "page") {
      const name = requiredDataString(context, "name");
      const projectName = (d.project as { name: string })?.name;
      return `${pageFilePath(name, projectName)}.md`;
    }

    const id = d.id as number;
    const summary = requiredDataString(context, "summary");
    const projectName = (d.project as { name: string })?.name;
    return `${issueFilePath(id, summary, projectName)}.md`;
  }

  renderHtml(context: ThemeRenderContext): string | null {
    if (context.entity.entityType === "user") return this.renderUserHtml(context);
    if (context.entity.entityType === "project") return this.renderProjectHtml(context);
    if (context.entity.entityType === "page") return this.renderPageHtml(context);
    return this.renderIssueHtml(context);
  }

  getTitle(context: ThemeRenderContext): string | undefined {
    const d = context.entity.data;
    switch (context.entity.entityType) {
      case "issue":
        return d.id != null
          ? `${padId(d.id as number)}: ${requiredDataString(context, "summary")}`
          : undefined;
      case "page":
        return ((d.title as string | undefined)?.trim() || requiredDataString(context, "name"));
      case "user": {
        const realName = d.realName as string | null;
        const name = requiredDataString(context, "name");
        return realName ? `${realName} (@${name})` : name;
      }
      case "project":
        return requiredDataString(context, "name");
      default:
        return undefined;
    }
  }

  private renderIssueHtml(context: ThemeRenderContext): string {
    const d = context.entity.data;
    const lookup = context.lookupEntityPath;
    const projectId = (d.project as { id: number } | null)?.id;

    const status = d.status as { name: string; label: string; color?: string };
    const resolution = d.resolution as { name: string; label: string };
    const priority = d.priority as { name: string; label: string };
    const severity = d.severity as { name: string; label: string };
    const project = d.project as { id: number; name: string } | null;
    const category = d.category as { name: string } | null;
    const reporter = d.reporter as { name: string } | null;
    const handler = d.handler as { name: string } | null;
    const reproducibility = d.reproducibility as { label: string } | null;

    const issueId = padId(d.id as number);
    const parts: string[] = [];

    parts.push(`<div class="mt-issue-view">`);

    // ── Header ──
    parts.push(`<div class="mt-header">`);
    if (project || category) {
      const projectHtml = project ? mtProjectLink(project, lookup) : null;
      const crumbs = [projectHtml, category ? esc(category.name) : null, esc(padId(d.id as number))].filter(Boolean);
      parts.push(`<div class="mt-breadcrumb">${crumbs.join(" &rsaquo; ")}</div>`);
    }
    parts.push(`<h1 class="mt-title">${markdownToHtml(d.summary as string, lookup, projectId)}</h1>`);

    // Tags as badges
    const tags = context.entity.tags ?? [];
    const customTags = tags.filter((t) => !t.includes(":"));
    if (customTags.length > 0) {
      parts.push(`<div class="mt-tags">${customTags.map((t) => `<span class="mt-tag">${esc(t)}</span>`).join(" ")}</div>`);
    }
    parts.push(`</div>`); // mt-header

    // ── Two-column layout ──
    parts.push(`<div class="mt-columns">`);

    // ── Main column ──
    parts.push(`<div class="mt-main-col">`);

    // Details section
    parts.push(`<div class="mt-section">`);
    parts.push(`<h2 class="mt-section-title">Details</h2>`);
    parts.push(`<div class="mt-section-body">`);
    if (d.description) {
      parts.push(`<div class="mt-description">${markdownToHtml(d.description as string, lookup, projectId)}</div>`);
    }
    if (d.stepsToReproduce) {
      parts.push(`<h3 class="mt-subsection-title">Steps to Reproduce</h3>`);
      parts.push(`<div class="mt-description">${markdownToHtml(d.stepsToReproduce as string, lookup, projectId)}</div>`);
    }
    if (d.additionalInformation) {
      parts.push(`<h3 class="mt-subsection-title">Additional Information</h3>`);
      parts.push(`<div class="mt-description">${markdownToHtml(d.additionalInformation as string, lookup, projectId)}</div>`);
    }

    // Text custom fields
    const customFields = d.customFields as Array<{ id: number; name: string; value: string }> | undefined;
    for (const cf of customFields ?? []) {
      if (!cf.value) continue;
      parts.push(`<h3 class="mt-subsection-title">${esc(cf.name)}</h3>`);
      parts.push(`<div class="mt-description">${markdownToHtml(cf.value, lookup, projectId)}</div>`);
    }

    // Issue-level attachments
    const issueBaseUrl = context.entity.url ? new URL(context.entity.url).origin : "";
    const files = d.attachments as Array<{ id?: number; filename: string; storagePath?: string; size: number }> | undefined;
    if (files?.length) {
      parts.push(`<h3 class="mt-subsection-title">Attachments</h3>`);
      parts.push(`<div class="mt-attachments">`);
      for (const f of files) {
        const fallback = (issueBaseUrl && f.id) ? `${issueBaseUrl}/file_download.php?file_id=${f.id}&type=bug` : undefined;
        parts.push(renderAttachmentHtml(f, context.collectionName, fallback));
      }
      parts.push(`</div>`);
    }
    parts.push(`</div>`); // mt-section-body
    parts.push(`</div>`); // mt-section

    // Relationships section
    const relationships = d.relationships as Array<{
      type: { name: string; label: string };
      issue: { id: number; summary?: string };
    }> | undefined;
    if (relationships?.length) {
      parts.push(`<div class="mt-section">`);
      parts.push(`<h2 class="mt-section-title">Relationships</h2>`);
      parts.push(`<div class="mt-section-body">`);
      for (const rel of relationships) {
        const targetPath = lookup?.(`issue:${rel.issue.id}`) ?? issueFilePath(rel.issue.id, rel.issue.summary ?? "", project?.name);
        const label = rel.issue.summary
          ? `${padId(rel.issue.id)} - ${esc(rel.issue.summary)}`
          : padId(rel.issue.id);
        parts.push(`<div class="mt-relationship">`);
        parts.push(`<span class="mt-rel-type">${esc(rel.type.label ?? rel.type.name)}</span>`);
        parts.push(`<a class="mt-issue-ref" href="#wikilink/${encodeURIComponent(targetPath)}">${label}</a>`);
        parts.push(`</div>`);
      }
      parts.push(`</div>`);
      parts.push(`</div>`);
    }

    // Activities section (notes + history interleaved chronologically)
    const notes = d.notes as Array<{
      id: number;
      reporter?: { name: string };
      text: string;
      view_state?: { name: string };
      created_at: string;
      attachments?: Array<{ id?: number; filename: string; storagePath?: string; size: number }>;
    }> | undefined;

    const history = (d.history ?? []) as Array<{
      created_at: string;
      user: { name: string };
      type: { name: string };
      message: string;
      field?: { name: string; old_value: string; new_value: string };
    }>;

    // Build a unified timeline of activities
    type Activity = { type: "note"; timestamp: string; data: typeof notes extends Array<infer T> | undefined ? T : never }
                  | { type: "history"; timestamp: string; data: typeof history extends Array<infer T> ? T : never };
    const activities: Activity[] = [];

    if (notes?.length) {
      for (const note of notes) {
        activities.push({ type: "note", timestamp: note.created_at, data: note as any });
      }
    }
    for (const entry of history) {
      activities.push({ type: "history", timestamp: entry.created_at, data: entry as any });
    }

    // Sort chronologically (oldest first)
    activities.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    if (activities.length > 0) {
      parts.push(`<div class="mt-section">`);
      parts.push(`<h2 class="mt-section-title">Activities</h2>`);
      parts.push(`<div class="mt-activity-list">`);

      for (const activity of activities) {
        if (activity.type === "note") {
          const note = activity.data as NonNullable<typeof notes>[number];
          const author = note.reporter?.name ?? "Unknown";
          const isPrivate = note.view_state?.name === "private";
          const borderClass = isPrivate ? "mt-note-private" : "mt-note-public";

          parts.push(`<div class="mt-activity">`);
          parts.push(`<div class="mt-activity-header">`);
          parts.push(`${mtAvatar(author)} <strong class="mt-activity-author">${mtUserLink(author, lookup)}</strong>`);
          parts.push(`<span class="mt-activity-date">${formatDateCompact(note.created_at)}</span>`);
          if (isPrivate) {
            parts.push(`<span class="mt-private-badge">private</span>`);
          }
          parts.push(`</div>`);
          parts.push(`<div class="mt-activity-body">`);
          parts.push(`<div class="mt-note-body ${borderClass}">`);
          parts.push(`<div class="mt-note-text">${markdownToHtml(note.text, lookup, projectId)}</div>`);

          // Note attachments
          if (note.attachments?.length) {
            parts.push(`<div class="mt-note-attachments">`);
            for (const att of note.attachments) {
              const fallback = (issueBaseUrl && att.id) ? `${issueBaseUrl}/file_download.php?file_id=${att.id}&type=bugnote` : undefined;
              parts.push(renderAttachmentHtml(att, context.collectionName, fallback));
            }
            parts.push(`</div>`);
          }
          parts.push(`</div>`);
          parts.push(`</div>`);
          parts.push(`</div>`);
        } else {
          // History entry
          const entry = activity.data as typeof history[number];
          parts.push(`<div class="mt-activity mt-history-entry">`);
          parts.push(`<div class="mt-activity-header">`);
          parts.push(`${mtAvatar(entry.user.name)} <strong class="mt-activity-author">${mtUserLink(entry.user.name, lookup)}</strong>`);
          parts.push(`<span class="mt-activity-date">${formatDateCompact(entry.created_at)}</span>`);
          parts.push(`</div>`);
          if (entry.field || entry.message) {
            parts.push(`<div class="mt-activity-body">`);
            if (entry.field) {
              parts.push(`<div class="mt-history-text">${esc(entry.message || `changed "${entry.field.name}" from "${entry.field.old_value}" to "${entry.field.new_value}"`)}</div>`);
            } else if (entry.message) {
              parts.push(`<div class="mt-history-text">${esc(entry.message)}</div>`);
            }
            parts.push(`</div>`);
          }
          parts.push(`</div>`);
        }
      }

      parts.push(`</div>`); // mt-activity-list
      parts.push(`</div>`); // mt-section
    }

    parts.push(`</div>`); // mt-main-col

    // ── Sidebar ──
    parts.push(`<div class="mt-sidebar-col">`);
    parts.push(`<h3 class="mt-sidebar-heading">Overview</h3>`);

    if (category) {
      parts.push(mtSidebarRow("Category", esc(category.name)));
    }
    parts.push(mtSidebarRow("Priority", `${priorityIndicator(priority.name)} ${esc(priority.label)}`));
    parts.push(mtSidebarRow("Severity", esc(severity.label)));

    // Status with colored indicator
    const sColor = statusColor(status);
    parts.push(mtSidebarRow("Status", `<span class="mt-status-dot" style="background:${sColor}"></span> ${esc(status.label)}`));

    parts.push(mtSidebarRow("Resolution", esc(resolution.label)));

    if (reproducibility) {
      parts.push(mtSidebarRow("Reproducibility", esc(reproducibility.label)));
    }

    if (reporter?.name) {
      parts.push(mtSidebarRow("Reporter", `${mtAvatar(reporter.name, null, 20)} <strong>${mtUserLink(reporter.name, lookup)}</strong>`));
    }
    if (handler?.name) {
      parts.push(mtSidebarRow("Assigned To", `${mtAvatar(handler.name, null, 20)} <strong>${mtUserLink(handler.name, lookup)}</strong>`));
    }

    parts.push(mtSidebarRow("Created", formatDateCompact(d.createdAt as string)));
    parts.push(mtSidebarRow("Updated", formatDateCompact(d.updatedAt as string)));

    if (context.entity.url) {
      parts.push(`<div class="mt-sidebar-row mt-sidebar-link-row"><a class="mt-sidebar-link" href="${esc(context.entity.url)}" target="_blank" rel="noopener noreferrer">View in MantisHub &rarr;</a></div>`);
    }

    parts.push(`</div>`); // mt-sidebar-col
    parts.push(`</div>`); // mt-columns
    parts.push(`</div>`); // mt-issue-view

    return parts.join("\n");
  }

  private renderUserMd(context: ThemeRenderContext): string {
    const d = context.entity.data;
    const fm: Record<string, unknown> = {
      title: context.entity.title,
      type: "user",
      username: d.name,
    };
    if (d.email) fm.email = d.email;
    const lines = [frontmatter(fm), `## ${context.entity.title}`];
    if (d.realName) lines.push(`**Name:** ${d.realName as string}`);
    if (d.email) lines.push(`**Email:** ${d.email as string}`);
    return lines.join("\n\n");
  }

  private renderProjectMd(context: ThemeRenderContext): string {
    const d = context.entity.data;
    const categories = (d.categories ?? []) as string[];
    const fm: Record<string, unknown> = { title: context.entity.title, type: "project" };
    if (categories.length) fm.categories = categories;
    const lines = [frontmatter(fm), `## ${d.name as string}`];
    if (categories.length) {
      lines.push("### Categories\n\n" + categories.map((c) => `- ${c}`).join("\n"));
    }
    return lines.join("\n\n");
  }

  private renderUserHtml(context: ThemeRenderContext): string {
    const d = context.entity.data;
    const name = (d.name as string) ?? "Unknown";
    const parts: string[] = [];
    parts.push(`<div class="mt-issue-view">`);
    parts.push(`<div class="mt-header">`);
    parts.push(`<h1 class="mt-title">${esc(context.entity.title)}</h1>`);
    parts.push(`</div>`);
    parts.push(`<div class="mt-user-card">`);
    parts.push(mtAvatar(name, d.avatarUrl as string | null, 80));
    parts.push(`<div class="mt-user-info">`);
    if (d.realName) parts.push(`<div class="mt-user-realname">${esc(d.realName as string)}</div>`);
    parts.push(`<div class="mt-user-username">@${esc(name)}</div>`);
    if (d.email) parts.push(`<div class="mt-user-email">${esc(d.email as string)}</div>`);
    parts.push(`</div>`);
    parts.push(`</div>`);
    if (context.entity.url) {
      parts.push(`<div style="margin-top:16px"><a class="mt-sidebar-link" href="${esc(context.entity.url)}" target="_blank" rel="noopener noreferrer">View profile in MantisHub &rarr;</a></div>`);
    }
    parts.push(`</div>`);
    return parts.join("\n");
  }

  private renderProjectHtml(context: ThemeRenderContext): string {
    const d = context.entity.data;
    const categories = (d.categories ?? []) as string[];
    const parts: string[] = [];
    parts.push(`<div class="mt-issue-view">`);
    parts.push(`<div class="mt-header">`);
    parts.push(`<h1 class="mt-title">${esc(d.name as string)}</h1>`);
    parts.push(`</div>`);
    if (categories.length) {
      parts.push(`<div class="mt-section">`);
      parts.push(`<h2 class="mt-section-title">Categories</h2>`);
      parts.push(`<div class="mt-section-body">`);
      parts.push(`<ul class="mt-category-list">${categories.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>`);
      parts.push(`</div>`);
      parts.push(`</div>`);
    }
    if (context.entity.url) {
      parts.push(`<a class="mt-sidebar-link" href="${esc(context.entity.url)}" target="_blank" rel="noopener noreferrer">Open project in MantisHub &rarr;</a>`);
    }
    parts.push(`</div>`);
    return parts.join("\n");
  }

  private renderPageMd(context: ThemeRenderContext): string {
    const d = context.entity.data;
    const source = this.getFilePath(context);
    const lookup = context.lookupEntityPath ?? (() => undefined);
    const projectId = (d.project as { id: number } | null)?.id;

    const project = d.project as { id: number; name: string } | null;
    const createdBy = d.createdBy as { name: string; real_name?: string } | null;
    const updatedBy = d.updatedBy as { name: string; real_name?: string } | null;
    let content = (d.content as string) ?? "";
    let pageHeading = (d.title as string) || (d.name as string);

    // If the content begins with a leading H1, prefer it over the stored title
    // so we don't render two stacked headers.
    const leadingH1 = content.match(/^\s*#\s+(.+?)\s*(?:\n|$)/);
    if (leadingH1) {
      pageHeading = leadingH1[1];
      content = content.slice(leadingH1[0].length);
    }

    const fm: Record<string, unknown> = {
      title: d.title || d.name,
      type: "page",
      name: d.name,
    };
    if (project) fm.project = project.name;
    if (d.createdAt) fm.created = d.createdAt;
    if (d.updatedAt) fm.updated = d.updatedAt;
    if (context.entity.tags?.length) fm.tags = context.entity.tags;

    const sections: string[] = [frontmatter(fm)];

    // Header with project breadcrumb
    const crumbs = [project?.name, d.name as string].filter(Boolean).join(" > ");
    sections.push(`**${crumbs}**`);

    sections.push(`## ${pageHeading}`);

    // Page content (raw markdown)
    if (content) {
      sections.push(linkifyContent(content, lookup, projectId));
    }

    // File attachments
    const files = d.files as Array<{ name: string; storagePath?: string }> | undefined;
    if (files?.length) {
      const embeds = files
        .filter((f) => f.storagePath)
        .map((f) => `![${f.name}](${assetRef(f.storagePath)})`);
      if (embeds.length) {
        sections.push("### Attachments\n\n" + embeds.join("\n\n"));
      }
    }

    // Metadata
    const rows: string[] = ["| | |", "|---|---|"];
    if (createdBy?.name) {
      const ref = createdBy.real_name
        ? mdUserRefFull(createdBy.name, createdBy.real_name, lookup, source)
        : mdUserRef(createdBy.name, lookup, source);
      rows.push(tableRow("Created By", ref));
    }
    if (updatedBy?.name) {
      const ref = updatedBy.real_name
        ? mdUserRefFull(updatedBy.name, updatedBy.real_name, lookup, source)
        : mdUserRef(updatedBy.name, lookup, source);
      rows.push(tableRow("Updated By", ref));
    }
    if (d.createdAt) rows.push(tableRow("Created", formatDate(d.createdAt as string)));
    if (d.updatedAt) rows.push(tableRow("Updated", formatDate(d.updatedAt as string)));
    sections.push("### Metadata\n\n" + rows.join("\n"));

    return sections.join("\n\n");
  }

  private renderPageHtml(context: ThemeRenderContext): string {
    const d = context.entity.data;
    const lookup = context.lookupEntityPath;
    const projectId = (d.project as { id: number } | null)?.id;

    const project = d.project as { id: number; name: string } | null;
    const createdBy = d.createdBy as { name: string; real_name?: string } | null;
    const updatedBy = d.updatedBy as { name: string; real_name?: string } | null;
    let content = (d.content as string) ?? "";
    const storedTitle = (d.title as string) || (d.name as string);

    // If the content begins with a leading H1, prefer it over the stored title
    // to avoid rendering a duplicate header.
    let headerTitle = storedTitle;
    const leadingH1 = content.match(/^\s*#\s+(.+?)\s*(?:\n|$)/);
    if (leadingH1) {
      headerTitle = leadingH1[1];
      content = content.slice(leadingH1[0].length);
    }

    const parts: string[] = [];
    parts.push(`<div class="mt-issue-view">`);

    // Header
    parts.push(`<div class="mt-header">`);
    if (project) {
      const projectHtml = mtProjectLink(project, lookup);
      parts.push(`<div class="mt-breadcrumb">${projectHtml} &rsaquo; ${esc(d.name as string)}</div>`);
    }
    parts.push(`<h1 class="mt-title">${esc(headerTitle)}</h1>`);
    parts.push(`</div>`);

    // Two-column layout
    parts.push(`<div class="mt-columns">`);

    // Main column
    parts.push(`<div class="mt-main-col">`);

    // Content section
    if (content) {
      parts.push(`<div class="mt-section">`);
      parts.push(`<div class="mt-section-body">`);
      parts.push(`<div class="mt-description">${markdownToHtml(content, lookup, projectId)}</div>`);
      parts.push(`</div>`);
      parts.push(`</div>`);
    }

    // File attachments
    const files = d.files as Array<{ name: string; storagePath?: string; size: number }> | undefined;
    if (files?.length) {
      parts.push(`<div class="mt-section">`);
      parts.push(`<h2 class="mt-section-title">Attachments</h2>`);
      parts.push(`<div class="mt-section-body">`);
      parts.push(`<div class="mt-attachments">`);
      for (const f of files) {
        const sizeKb = Math.round(f.size / 1024);
        parts.push(`<div class="mt-attachment-item">${esc(f.name)} <span class="mt-attachment-size">(${sizeKb} KB)</span></div>`);
      }
      parts.push(`</div>`);
      parts.push(`</div>`);
      parts.push(`</div>`);
    }

    parts.push(`</div>`); // mt-main-col

    // Sidebar
    parts.push(`<div class="mt-sidebar-col">`);
    parts.push(`<h3 class="mt-sidebar-heading">Overview</h3>`);

    if (createdBy?.name) {
      const userHtml = createdBy.real_name
        ? mtUserLinkFull(createdBy.name, createdBy.real_name, lookup)
        : mtUserLink(createdBy.name, lookup);
      parts.push(mtSidebarRow("Created By", `${mtAvatar(createdBy.name, null, 20)} <strong>${userHtml}</strong>`));
    }
    if (updatedBy?.name) {
      const userHtml = updatedBy.real_name
        ? mtUserLinkFull(updatedBy.name, updatedBy.real_name, lookup)
        : mtUserLink(updatedBy.name, lookup);
      parts.push(mtSidebarRow("Updated By", `${mtAvatar(updatedBy.name, null, 20)} <strong>${userHtml}</strong>`));
    }

    if (d.createdAt) parts.push(mtSidebarRow("Created", formatDateCompact(d.createdAt as string)));
    if (d.updatedAt) parts.push(mtSidebarRow("Updated", formatDateCompact(d.updatedAt as string)));

    if (context.entity.url) {
      parts.push(`<div class="mt-sidebar-row mt-sidebar-link-row"><a class="mt-sidebar-link" href="${esc(context.entity.url)}" target="_blank" rel="noopener noreferrer">View in MantisHub &rarr;</a></div>`);
    }

    parts.push(`</div>`); // mt-sidebar-col
    parts.push(`</div>`); // mt-columns
    parts.push(`</div>`); // mt-issue-view

    return parts.join("\n");
  }

  private renderIssue(context: ThemeRenderContext): string {
    const d = context.entity.data;
    const source = this.getFilePath(context);
    const sections: string[] = [];

    const status = d.status as { name: string; label: string };
    const resolution = d.resolution as { name: string; label: string };
    const priority = d.priority as { name: string; label: string };
    const severity = d.severity as { name: string; label: string };
    const project = d.project as { id: number; name: string } | null;
    const category = d.category as { name: string } | null;
    const reporter = d.reporter as { name: string } | null;
    const handler = d.handler as { name: string } | null;
    const reproducibility = d.reproducibility as { label: string } | null;

    const lookup = context.lookupEntityPath ?? (() => undefined);
    const projectId = project?.id;


    // Frontmatter
    const fm: Record<string, unknown> = {
      title: `${padId(d.id as number)}: ${d.summary}`,
      type: "issue",
      id: d.id,
      status: status.name,
      priority: priority.name,
      severity: severity.name,
      created: d.createdAt,
      updated: d.updatedAt,
    };
    if (project) fm.project = project.name;
    if (category) fm.category = category.name;
    if (context.entity.tags?.length) fm.tags = context.entity.tags;
    sections.push(frontmatter(fm));

    const issueId = padId(d.id as number);
    const issueRef = context.entity.url
      ? `[${issueId}](${context.entity.url})`
      : issueId;
    const summaryLead = [project?.name, category?.name, issueRef]
      .filter(Boolean)
      .join(" > ");
    sections.push(`**${summaryLead} - ${status.label}**`);

    // Title: "00042 Issue summary"
    sections.push(`## ${padId(d.id as number)} ${d.summary}`);

    // Details table (rendered at bottom)
    const rows: string[] = [
      "| | |",
      "|---|---|",
      tableRow("Resolution", resolution.label),
      tableRow("Priority", priority.label),
      tableRow("Severity", severity.label),
    ];
    if (reporter?.name) rows.push(tableRow("Reporter", mdUserRef(reporter.name, lookup, source)));
    if (handler?.name) rows.push(tableRow("Assigned To", mdUserRef(handler.name, lookup, source)));
    if (reproducibility) rows.push(tableRow("Reproducibility", reproducibility.label));
    rows.push(tableRow("Created", formatDate(d.createdAt as string)));
    rows.push(tableRow("Updated", formatDate(d.updatedAt as string)));

    // Issue-level attachments — standard markdown images with relative paths
    // from markdown/<type>/<file>.md up to the collection root, then into attachments/
    const files = d.attachments as Array<{ filename: string; storagePath?: string }>;
    if (files?.length) {
      const embeds = files
        .filter((f) => f.storagePath)
        .map((f) => `![${f.filename}](${assetRef(f.storagePath)})`);
      if (embeds.length) {
        sections.push("### Attachments\n\n" + embeds.join("\n\n"));
      }
    }

    // Description
    if (d.description) {
      sections.push(
        linkifyContent(d.description as string, lookup, projectId),
      );
    }

    // Steps to Reproduce
    if (d.stepsToReproduce) {
      sections.push(
        "### Steps to Reproduce\n\n" +
          linkifyContent(d.stepsToReproduce as string, lookup, projectId),
      );
    }

    // Additional Information
    if (d.additionalInformation) {
      sections.push(
        "### Additional Information\n\n" +
          linkifyContent(d.additionalInformation as string, lookup, projectId),
      );
    }

    // Text custom fields
    const customFields = d.customFields as Array<{ id: number; name: string; value: string }> | undefined;
    for (const cf of customFields ?? []) {
      if (!cf.value) continue;
      sections.push(`### ${cf.name}\n\n${linkifyContent(cf.value, lookup, projectId)}`);
    }

    // Relationships — label: "00042 Title" (no # prefix)
    const relationships = d.relationships as Array<{
      type: { name: string; label: string };
      issue: { id: number; summary?: string };
    }>;
    if (relationships?.length) {
      const relLines = relationships.map((rel) => {
        const targetPath = lookup(`issue:${rel.issue.id}`) ?? issueFilePath(rel.issue.id, rel.issue.summary ?? "", project?.name);
        const label = rel.issue.summary
          ? `${padId(rel.issue.id)} ${rel.issue.summary}`
          : padId(rel.issue.id);
        return `- **${rel.type.label ?? rel.type.name}:** ${wikilink(targetPath, label, source)}`;
      });
      sections.push("### Relationships\n\n" + relLines.join("\n"));
    }

    // Notes
    const notes = d.notes as Array<{
      id: number;
      reporter?: { name: string };
      text: string;
      view_state?: { name: string };
      created_at: string;
      attachments?: Array<{ filename: string; storagePath?: string }>;
    }>;
    if (notes?.length) {
      const noteBlocks = notes.map((note) => {
        const authorName = note.reporter?.name ?? "Unknown";
        const authorRef = authorName !== "Unknown" ? mdUserRef(authorName, lookup, source) : authorName;
        const isPrivate = note.view_state?.name === "private";
        const headerParts = [authorRef, formatDate(note.created_at)];
        if (isPrivate) headerParts.push("private");
        const header = `**${headerParts.join(" | ")}**`;

        const body = linkifyContent(note.text, lookup, projectId);

        // Embed note attachments using stored paths (relative from markdown/<type>/)
        const embeds = (note.attachments ?? [])
          .filter((att) => att.storagePath)
          .map((att) => `![${att.filename}](${assetRef(att.storagePath)})`);

        return [header, body, ...embeds].filter(Boolean).join("\n\n");
      });
      sections.push("### Notes\n\n" + noteBlocks.join("\n\n---\n\n"));
    }

    sections.push("### Metadata\n\n" + rows.join("\n"));

    return sections.join("\n\n");
  }
}
