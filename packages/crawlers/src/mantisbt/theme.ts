import type { Theme, ThemeRenderContext } from "@veecontext/core/theme";
import { frontmatter, wikilink } from "@veecontext/core/theme";

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

/** Returns the wikilink path (no extension) for an issue by id and summary. */
function issueFilePath(id: number, summary: string): string {
  const slug = slugify(summary);
  return slug ? `issues/${padId(id)}-${slug}` : `issues/${padId(id)}`;
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
function textToHtml(text: string, lookup?: Lookup): string {
  let html = esc(text);

  // Linkify #1234 issue references
  if (lookup) {
    html = html.replace(/#(\d+)/g, (match, id) => {
      const path = lookup(`issue:${id}`);
      if (!path) return match;
      return `<a class="mt-issue-ref" href="#wikilink/${encodeURIComponent(path)}">#${padId(parseInt(id))}</a>`;
    });
  }

  // Linkify @mentions to user entities
  if (lookup) {
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

/** Render a user name as a link to the user entity (underline on hover only). */
function mtUserLink(name: string, lookup?: Lookup): string {
  const path = lookup?.(`user:${name}`);
  if (path) {
    return `<a class="mt-user-link" href="#wikilink/${encodeURIComponent(path)}">${esc(name)}</a>`;
  }
  return esc(name);
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
  // Fallback colors based on common MantisBT status names
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
 * Replace bare #1234 issue references in prose text with wikilinks.
 * Skips text inside code fences, inline code, and existing wikilinks.
 */
function linkifyIssueRefs(
  text: string,
  lookup: (externalId: string) => string | undefined,
): string {
  // Split on code fences, inline code, and existing [[...]] blocks to avoid
  // double-linking or corrupting code samples.
  const skip = /(```[\s\S]*?```|`[^`\n]+`|\[\[[^\]]*\]\])/g;
  const parts: string[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = skip.exec(text)) !== null) {
    parts.push(replaceRefs(text.slice(last, m.index), lookup));
    parts.push(m[0]);
    last = m.index + m[0].length;
  }
  parts.push(replaceRefs(text.slice(last), lookup));
  return parts.join("");
}

function replaceRefs(
  text: string,
  lookup: (externalId: string) => string | undefined,
): string {
  return text.replace(/#(\d+)/g, (match, id) => {
    const path = lookup(`issue:${id}`);
    if (!path) return match;
    return `[[${path}|#${padId(parseInt(id))}]]`;
  });
}

export class MantisBTTheme implements Theme {
  crawlerType = "mantisbt";

  render(context: ThemeRenderContext): string {
    if (context.entity.entityType === "user") return this.renderUserMd(context);
    if (context.entity.entityType === "project") return this.renderProjectMd(context);
    return this.renderIssue(context);
  }

  getFilePath(context: ThemeRenderContext): string {
    const d = context.entity.data;

    if (context.entity.entityType === "user") {
      const name = d.name as string;
      return `users/${slugify(name)}.md`;
    }

    if (context.entity.entityType === "project") {
      const id = d.id as number;
      const name = d.name as string;
      const slug = slugify(name);
      return slug ? `projects/${padId(id)}-${slug}.md` : `projects/${padId(id)}.md`;
    }

    const id = d.id as number;
    const summary = d.summary as string;
    const slug = slugify(summary);
    return slug
      ? `issues/${padId(id)}-${slug}.md`
      : `issues/${padId(id)}.md`;
  }

  renderHtml(context: ThemeRenderContext): string | null {
    if (context.entity.entityType === "user") return this.renderUserHtml(context);
    if (context.entity.entityType === "project") return this.renderProjectHtml(context);
    return this.renderIssueHtml(context);
  }

  private renderIssueHtml(context: ThemeRenderContext): string {
    const d = context.entity.data;
    const lookup = context.lookupEntityPath;

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
      parts.push(`<div class="mt-description">${textToHtml(d.description as string, lookup)}</div>`);
    }
    if (d.stepsToReproduce) {
      parts.push(`<h3 class="mt-subsection-title">Steps to Reproduce</h3>`);
      parts.push(`<div class="mt-description">${textToHtml(d.stepsToReproduce as string, lookup)}</div>`);
    }
    if (d.additionalInformation) {
      parts.push(`<h3 class="mt-subsection-title">Additional Information</h3>`);
      parts.push(`<div class="mt-description">${textToHtml(d.additionalInformation as string, lookup)}</div>`);
    }

    // Issue-level attachments
    const files = d.files as Array<{ filename: string; storagePath?: string; size: number }> | undefined;
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
        const targetPath = issueFilePath(rel.issue.id, rel.issue.summary ?? "");
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
          parts.push(`<div class="mt-note-text">${textToHtml(note.text, lookup)}</div>`);

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
          parts.push(`${mtAvatar(entry.user.name)} <strong class="mt-activity-author">${esc(entry.user.name)}</strong>`);
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
      parts.push(`<div class="mt-sidebar-row mt-sidebar-link-row"><a class="mt-sidebar-link" href="${esc(context.entity.url)}" target="_blank" rel="noopener noreferrer">View in MantisBT &rarr;</a></div>`);
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
      parts.push(`<div style="margin-top:16px"><a class="mt-sidebar-link" href="${esc(context.entity.url)}" target="_blank" rel="noopener noreferrer">View profile in MantisBT &rarr;</a></div>`);
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
      parts.push(`<a class="mt-sidebar-link" href="${esc(context.entity.url)}" target="_blank" rel="noopener noreferrer">Open project in MantisBT &rarr;</a>`);
    }
    parts.push(`</div>`);
    return parts.join("\n");
  }

  private renderIssue(context: ThemeRenderContext): string {
    const d = context.entity.data;
    const sections: string[] = [];

    const status = d.status as { name: string; label: string };
    const resolution = d.resolution as { name: string; label: string };
    const priority = d.priority as { name: string; label: string };
    const severity = d.severity as { name: string; label: string };
    const project = d.project as { name: string } | null;
    const category = d.category as { name: string } | null;
    const reporter = d.reporter as { name: string } | null;
    const handler = d.handler as { name: string } | null;
    const reproducibility = d.reproducibility as { label: string } | null;

    const lookup = context.lookupEntityPath ?? (() => undefined);

    // Frontmatter
    const fm: Record<string, unknown> = {
      title: d.summary,
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
    if (reporter?.name) rows.push(tableRow("Reporter", reporter.name));
    if (handler?.name) rows.push(tableRow("Assigned To", handler.name));
    if (reproducibility) rows.push(tableRow("Reproducibility", reproducibility.label));
    rows.push(tableRow("Created", formatDate(d.createdAt as string)));
    rows.push(tableRow("Updated", formatDate(d.updatedAt as string)));

    // Issue-level attachments
    const files = d.files as Array<{ filename: string; storagePath?: string }>;
    if (files?.length) {
      const embeds = files
        .filter((f) => f.storagePath)
        .map((f) => `![[${f.storagePath!.replace(/^attachments\//, "")}]]`);
      if (embeds.length) {
        sections.push("### Attachments\n\n" + embeds.join("\n\n"));
      }
    }

    // Description
    if (d.description) {
      sections.push(
        linkifyIssueRefs(d.description as string, lookup),
      );
    }

    // Steps to Reproduce
    if (d.stepsToReproduce) {
      sections.push(
        "### Steps to Reproduce\n\n" +
          linkifyIssueRefs(d.stepsToReproduce as string, lookup),
      );
    }

    // Additional Information
    if (d.additionalInformation) {
      sections.push(
        "### Additional Information\n\n" +
          linkifyIssueRefs(d.additionalInformation as string, lookup),
      );
    }

    // Relationships — label: "00042 Title" (no # prefix)
    const relationships = d.relationships as Array<{
      type: { name: string; label: string };
      issue: { id: number; summary?: string };
    }>;
    if (relationships?.length) {
      const relLines = relationships.map((rel) => {
        const targetPath = issueFilePath(rel.issue.id, rel.issue.summary ?? "");
        const label = rel.issue.summary
          ? `${padId(rel.issue.id)} ${rel.issue.summary}`
          : padId(rel.issue.id);
        return `- **${rel.type.label ?? rel.type.name}:** ${wikilink(targetPath, label)}`;
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
        const author = note.reporter?.name ?? "Unknown";
        const isPrivate = note.view_state?.name === "private";
        const parts = [author, formatDate(note.created_at)];
        if (isPrivate) parts.push("private");
        const header = `**${parts.join(" | ")}**`;

        const body = linkifyIssueRefs(note.text, lookup);

        // Embed note attachments using stored paths
        const embeds = (note.attachments ?? [])
          .filter((att) => att.storagePath)
          .map((att) => `![[${att.storagePath!.replace(/^attachments\//, "")}]]`);

        return [header, body, ...embeds].filter(Boolean).join("\n\n");
      });
      sections.push("### Notes\n\n" + noteBlocks.join("\n\n---\n\n"));
    }

    sections.push("### Metadata\n\n" + rows.join("\n"));

    return sections.join("\n\n");
  }
}
