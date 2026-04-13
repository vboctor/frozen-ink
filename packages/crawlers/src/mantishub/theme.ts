import type { Theme, ThemeRenderContext } from "@frozenink/core/theme";
import { frontmatter, wikilink } from "@frozenink/core/theme";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
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

/** Returns the wikilink path (no extension) for an issue by id and summary. Includes project folder for multi-project collections. */
function issueFilePath(id: number, summary: string, projectName?: string, singleProject?: boolean): string {
  const slug = slugify(summary);
  const issuePart = slug ? `${padId(id)}-${slug}` : padId(id);
  if (singleProject || !projectName) return `issues/${issuePart}`;
  return `${slugify(projectName)}/issues/${issuePart}`;
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
  projectNameToId?: Record<string, number>,
): string {
  let html = esc(text);

  if (lookup) {
    // Resolve cross-project page links: [[/Project Name/page-name]]
    html = html.replace(/\[\[\/(.+?)\/([\w-]+)\]\]/g, (match, projName: string, pageName: string) => {
      // projName may be HTML-escaped; unescape for lookup
      const rawProjName = projName.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
      const pid = projectNameToId?.[rawProjName];
      if (!pid) return match;
      const path = lookup(`page:${pid}:${pageName}`);
      if (!path) return match;
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
  const color = colors[name.toLowerCase()] ?? "#999";
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
  projectNameToId?: Record<string, number>,
): string {
  // Split on code fences and inline code to avoid corrupting code samples.
  const codeSkip = /(```[\s\S]*?```|`[^`\n]+`)/g;
  const parts: string[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = codeSkip.exec(text)) !== null) {
    parts.push(linkifySegment(text.slice(last, m.index), lookup, projectId, projectNameToId));
    parts.push(m[0]);
    last = m.index + m[0].length;
  }
  parts.push(linkifySegment(text.slice(last), lookup, projectId, projectNameToId));
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
  projectNameToId?: Record<string, number>,
): string {
  // Step 1: Resolve cross-project page links [[/Project Name/page-name]]
  text = text.replace(/\[\[\/(.+?)\/([\w-]+)\]\]/g, (_match, projName: string, pageName: string) => {
    const pid = projectNameToId?.[projName];
    if (!pid) return `[[${projName}/${pageName}]]`;
    const path = lookup(`page:${pid}:${pageName}`);
    if (!path) return `[[${projName}/${pageName}]]`;
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

/** Returns the file path (no extension) for a page. Includes project folder for multi-project collections. */
function pageFilePath(name: string, projectName?: string, singleProject?: boolean): string {
  const slug = slugify(name);
  const pagePart = slug || name;
  if (singleProject || !projectName) return `pages/${pagePart}`;
  return `${slugify(projectName)}/pages/${pagePart}`;
}

export class MantisHubTheme implements Theme {
  crawlerType = "mantishub";

  render(context: ThemeRenderContext): string {
    if (context.entity.entityType === "user") return this.renderUserMd(context);
    if (context.entity.entityType === "project") return this.renderProjectMd(context);
    if (context.entity.entityType === "page") return this.renderPageMd(context);
    return this.renderIssue(context);
  }

  getFilePath(context: ThemeRenderContext): string {
    const d = context.entity.data;

    if (context.entity.entityType === "user") {
      const name = d.name as string;
      return `users/${slugify(name)}.md`;
    }

    if (context.entity.entityType === "project") {
      const name = d.name as string;
      const slug = slugify(name);
      return `projects/${slug || "unnamed"}.md`;
    }

    if (context.entity.entityType === "page") {
      const name = d.name as string;
      const projectName = (d.project as { name: string })?.name;
      const singleProject = d._singleProject as boolean | undefined;
      return `${pageFilePath(name, projectName, singleProject)}.md`;
    }

    const id = d.id as number;
    const summary = d.summary as string;
    const projectName = (d.project as { name: string })?.name;
    const singleProject = d._singleProject as boolean | undefined;
    return `${issueFilePath(id, summary, projectName, singleProject)}.md`;
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
        return d.id != null && d.summary != null
          ? `${padId(d.id as number)}: ${d.summary as string}`
          : undefined;
      case "page":
        return ((d.title || d.name) as string) || undefined;
      case "user": {
        const realName = d.realName as string | null;
        const name = d.name as string;
        return realName ? `${realName} (@${name})` : name;
      }
      case "project":
        return (d.name as string) || undefined;
      default:
        return undefined;
    }
  }

  private renderIssueHtml(context: ThemeRenderContext): string {
    const d = context.entity.data;
    const lookup = context.lookupEntityPath;
    const projectId = (d.project as { id: number } | null)?.id;
    const projectNameToId = d._projectNameToId as Record<string, number> | undefined;

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
    parts.push(`<h1 class="mt-title">${esc(d.summary as string)}</h1>`);

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
      parts.push(`<div class="mt-description">${textToHtml(d.description as string, lookup, projectId, projectNameToId)}</div>`);
    }
    if (d.stepsToReproduce) {
      parts.push(`<h3 class="mt-subsection-title">Steps to Reproduce</h3>`);
      parts.push(`<div class="mt-description">${textToHtml(d.stepsToReproduce as string, lookup, projectId, projectNameToId)}</div>`);
    }
    if (d.additionalInformation) {
      parts.push(`<h3 class="mt-subsection-title">Additional Information</h3>`);
      parts.push(`<div class="mt-description">${textToHtml(d.additionalInformation as string, lookup, projectId, projectNameToId)}</div>`);
    }

    // Issue-level attachments
    const files = d.attachments as Array<{ filename: string; storagePath?: string; size: number }> | undefined;
    if (files?.length) {
      parts.push(`<h3 class="mt-subsection-title">Attachments</h3>`);
      parts.push(`<div class="mt-attachments">`);
      for (const f of files) {
        const sizeKb = Math.round(f.size / 1024);
        parts.push(`<div class="mt-attachment-item">${esc(f.filename)} <span class="mt-attachment-size">(${sizeKb} KB)</span></div>`);
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
        const targetPath = lookup?.(`issue:${rel.issue.id}`) ?? issueFilePath(rel.issue.id, rel.issue.summary ?? "", project?.name, !!(d._singleProject));
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
      attachments?: Array<{ filename: string; storagePath?: string; size: number }>;
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
          parts.push(`<div class="mt-note-text">${textToHtml(note.text, lookup, projectId, projectNameToId)}</div>`);

          // Note attachments
          if (note.attachments?.length) {
            parts.push(`<div class="mt-note-attachments">`);
            for (const att of note.attachments) {
              const sizeKb = Math.round(att.size / 1024);
              parts.push(`<div class="mt-attachment-item">${esc(att.filename)} <span class="mt-attachment-size">(${sizeKb} KB)</span></div>`);
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
    const projectNameToId = d._projectNameToId as Record<string, number> | undefined;
    const project = d.project as { id: number; name: string } | null;
    const createdBy = d.createdBy as { name: string; real_name?: string } | null;
    const updatedBy = d.updatedBy as { name: string; real_name?: string } | null;
    const content = (d.content as string) ?? "";

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

    sections.push(`## ${d.title || d.name}`);

    // Page content (raw markdown)
    if (content) {
      sections.push(linkifyContent(content, lookup, projectId, projectNameToId));
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
    const projectNameToId = d._projectNameToId as Record<string, number> | undefined;
    const project = d.project as { id: number; name: string } | null;
    const createdBy = d.createdBy as { name: string; real_name?: string } | null;
    const updatedBy = d.updatedBy as { name: string; real_name?: string } | null;
    const content = (d.content as string) ?? "";

    const parts: string[] = [];
    parts.push(`<div class="mt-issue-view">`);

    // Header
    parts.push(`<div class="mt-header">`);
    if (project) {
      const projectHtml = mtProjectLink(project, lookup);
      parts.push(`<div class="mt-breadcrumb">${projectHtml} &rsaquo; ${esc(d.name as string)}</div>`);
    }
    parts.push(`<h1 class="mt-title">${esc((d.title as string) || (d.name as string))}</h1>`);
    parts.push(`</div>`);

    // Two-column layout
    parts.push(`<div class="mt-columns">`);

    // Main column
    parts.push(`<div class="mt-main-col">`);

    // Content section
    if (content) {
      parts.push(`<div class="mt-section">`);
      parts.push(`<div class="mt-section-body">`);
      parts.push(`<div class="mt-description">${textToHtml(content, lookup, projectId, projectNameToId)}</div>`);
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
    const projectNameToId = d._projectNameToId as Record<string, number> | undefined;

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
        linkifyContent(d.description as string, lookup, projectId, projectNameToId),
      );
    }

    // Steps to Reproduce
    if (d.stepsToReproduce) {
      sections.push(
        "### Steps to Reproduce\n\n" +
          linkifyContent(d.stepsToReproduce as string, lookup, projectId, projectNameToId),
      );
    }

    // Additional Information
    if (d.additionalInformation) {
      sections.push(
        "### Additional Information\n\n" +
          linkifyContent(d.additionalInformation as string, lookup, projectId, projectNameToId),
      );
    }

    // Relationships — label: "00042 Title" (no # prefix)
    const relationships = d.relationships as Array<{
      type: { name: string; label: string };
      issue: { id: number; summary?: string };
    }>;
    if (relationships?.length) {
      const relLines = relationships.map((rel) => {
        const targetPath = lookup(`issue:${rel.issue.id}`) ?? issueFilePath(rel.issue.id, rel.issue.summary ?? "", project?.name, !!projectId && !!(d._singleProject));
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

        const body = linkifyContent(note.text, lookup, projectId, projectNameToId);

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
