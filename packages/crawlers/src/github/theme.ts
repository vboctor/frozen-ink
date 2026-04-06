import type { Theme, ThemeRenderContext } from "@veecontext/core";
import { frontmatter, wikilink, callout } from "@veecontext/core";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

interface MappedUser {
  login: string;
  avatarUrl: string;
  url: string;
}

interface MappedComment {
  id: number;
  user: MappedUser | null;
  body: string;
  createdAt: string;
  updatedAt: string;
  url: string;
  reactions: MappedReactions | null;
}

interface MappedReview {
  id: number;
  user: MappedUser | null;
  state: string;
  body: string | null;
  submittedAt: string;
  url: string;
}

interface MappedCheckRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  url: string;
  startedAt: string | null;
  completedAt: string | null;
}

interface MappedReactions {
  total: number;
  "+1": number;
  "-1": number;
  laugh: number;
  hooray: number;
  confused: number;
  heart: number;
  rocket: number;
  eyes: number;
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

function formatUserRef(user: MappedUser | null): string {
  if (!user) return "Unknown";
  return `[${user.login}](${user.url})`;
}

function formatUserAvatar(user: MappedUser | null, size = 20): string {
  if (!user) return "Unknown";
  return `![${user.login}](${user.avatarUrl}&size=${size}) [${user.login}](${user.url})`;
}

function formatReactions(reactions: MappedReactions | null): string {
  if (!reactions || reactions.total === 0) return "";
  const emojis: string[] = [];
  if (reactions["+1"] > 0) emojis.push(`\u{1F44D} ${reactions["+1"]}`);
  if (reactions["-1"] > 0) emojis.push(`\u{1F44E} ${reactions["-1"]}`);
  if (reactions.laugh > 0) emojis.push(`\u{1F604} ${reactions.laugh}`);
  if (reactions.hooray > 0) emojis.push(`\u{1F389} ${reactions.hooray}`);
  if (reactions.confused > 0) emojis.push(`\u{1F615} ${reactions.confused}`);
  if (reactions.heart > 0) emojis.push(`\u{2764}\u{FE0F} ${reactions.heart}`);
  if (reactions.rocket > 0) emojis.push(`\u{1F680} ${reactions.rocket}`);
  if (reactions.eyes > 0) emojis.push(`\u{1F440} ${reactions.eyes}`);
  return emojis.join("  ");
}

function checkConclusionIcon(conclusion: string | null): string {
  switch (conclusion) {
    case "success": return "\u2705";
    case "failure": return "\u274C";
    case "cancelled": return "\u{1F6AB}";
    case "timed_out": return "\u23F0";
    case "action_required": return "\u26A0\uFE0F";
    case "skipped": return "\u23ED\uFE0F";
    case "neutral": return "\u25CB";
    default: return "\u{1F504}"; // in progress / queued
  }
}

// ── HTML rendering helpers ─────────────────────────────────────

function esc(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function avatarImg(user: MappedUser | null, size: number): string {
  if (!user) return "";
  return `<img class="gh-avatar" src="${esc(user.avatarUrl)}&amp;size=${size * 2}" width="${size}" height="${size}" alt="${esc(user.login)}" />`;
}

function simpleMarkdown(text: string): string {
  // Minimal markdown: paragraphs, code blocks, inline code, bold, italic, links
  let html = esc(text);
  // Code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, _lang, code) =>
    `<pre><code>${code}</code></pre>`);
  // Inline code
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  // Italic
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
  // Links
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
  );
  // Paragraphs
  html = html.replace(/\n\n+/g, "</p><p>");
  html = `<p>${html}</p>`;
  return html;
}

function commentBox(
  user: MappedUser | null,
  createdAt: string,
  body: string,
  reactions: MappedReactions | null,
): string {
  const parts: string[] = [];
  parts.push(`<div class="gh-comment-box">`);
  parts.push(`<div class="gh-comment-header">`);
  parts.push(`${avatarImg(user, 24)} <strong>${esc(user?.login ?? "Unknown")}</strong> commented on ${formatDate(createdAt)}`);
  parts.push(`</div>`);
  parts.push(`<div class="gh-comment-body">${simpleMarkdown(body)}</div>`);
  const reactionsStr = formatReactions(reactions);
  if (reactionsStr) {
    parts.push(`<div class="gh-comment-reactions">${reactionsStr}</div>`);
  }
  parts.push(`</div>`);
  return parts.join("\n");
}

function sidebarSection(title: string, content: string): string {
  const parts: string[] = [];
  parts.push(`<div class="gh-sidebar-section">`);
  if (title) parts.push(`<div class="gh-sidebar-title">${esc(title)}</div>`);
  parts.push(`<div class="gh-sidebar-content">${content}</div>`);
  parts.push(`</div>`);
  return parts.join("\n");
}

/** Returns "black" or "white" based on label background color for readable text */
function contrastColor(hex: string): string {
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  // Perceived luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? "#000000" : "#ffffff";
}

function reviewStateLabel(state: string): string {
  switch (state) {
    case "APPROVED": return "\u2705 Approved";
    case "CHANGES_REQUESTED": return "\u{1F534} Changes Requested";
    case "COMMENTED": return "\u{1F4AC} Commented";
    case "DISMISSED": return "\u{1F6AB} Dismissed";
    case "PENDING": return "\u23F3 Pending";
    default: return state;
  }
}

function reviewStateIcon(state: string): string {
  switch (state) {
    case "APPROVED": return "\u2705";
    case "CHANGES_REQUESTED": return "\u{1F534}";
    case "COMMENTED": return "\u{1F4AC}";
    case "DISMISSED": return "\u{1F6AB}";
    default: return "";
  }
}

// SVG icons matching GitHub's design
const openIssueIcon = `<svg class="gh-icon" viewBox="0 0 16 16" width="16" height="16"><path fill="currentColor" d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"/><path fill="currentColor" d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z"/></svg>`;
const closedIssueIcon = `<svg class="gh-icon" viewBox="0 0 16 16" width="16" height="16"><path fill="currentColor" d="M11.28 6.78a.75.75 0 0 0-1.06-1.06L7.25 8.69 5.78 7.22a.75.75 0 0 0-1.06 1.06l2 2a.75.75 0 0 0 1.06 0l3.5-3.5Z"/><path fill="currentColor" d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0Zm-1.5 0a6.5 6.5 0 1 0-13 0 6.5 6.5 0 0 0 13 0Z"/></svg>`;
const openPRIcon = `<svg class="gh-icon" viewBox="0 0 16 16" width="16" height="16"><path fill="currentColor" d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z"/></svg>`;
const closedPRIcon = `<svg class="gh-icon" viewBox="0 0 16 16" width="16" height="16"><path fill="currentColor" d="M3.25 1A2.25 2.25 0 0 1 4 5.372v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 3.25 1Zm9.5 5.5a.75.75 0 0 1 .75.75v3.378a2.251 2.251 0 1 1-1.5 0V7.25a.75.75 0 0 1 .75-.75Zm-1.07-4.28 1.97 1.97a.75.75 0 0 1-1.06 1.06L11.5 4.06l-.47.47-.53.53a.75.75 0 1 1-1.06-1.06l.53-.53.47-.47-1.97-1.97a.75.75 0 0 1 1.06-1.06Zm-.93 10.03a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM2.5 3.25a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0ZM3.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z"/></svg>`;
const mergedPRIcon = `<svg class="gh-icon" viewBox="0 0 16 16" width="16" height="16"><path fill="currentColor" d="M5.45 5.154A4.25 4.25 0 0 0 9.25 7.5h1.378a2.251 2.251 0 1 1 0 1.5H9.25A5.734 5.734 0 0 1 5 7.123v3.505a2.25 2.25 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.95-.218ZM4.25 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm8.5-4.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z"/></svg>`;

export class GitHubTheme implements Theme {
  crawlerType = "github";

  render(context: ThemeRenderContext): string {
    const { entity } = context;
    if (entity.entityType === "pull_request") {
      return this.renderPullRequest(context);
    }
    if (entity.entityType === "user") {
      return this.renderUser(context);
    }
    return this.renderIssue(context);
  }

  getFilePath(context: ThemeRenderContext): string {
    const { entity } = context;

    if (entity.entityType === "user") {
      const login = entity.data.login as string;
      return `users/${slugify(login)}.md`;
    }

    const number = entity.data.number as number;
    const slug = slugify(entity.title);

    if (entity.entityType === "pull_request") {
      return `pull-requests/${number}-${slug}.md`;
    }
    return `issues/${number}-${slug}.md`;
  }

  private renderIssue(context: ThemeRenderContext): string {
    const { entity } = context;
    const d = entity.data;
    const user = d.user as MappedUser | null;
    const sections: string[] = [];

    // Frontmatter
    const fm: Record<string, unknown> = {
      title: entity.title,
      type: "issue",
      number: d.number,
      state: d.state,
      source: entity.url,
      created: d.createdAt,
      updated: d.updatedAt,
    };
    if (d.stateReason) fm.state_reason = d.stateReason;
    if (d.closedAt) fm.closed = d.closedAt;
    if (user) fm.author = user.login;
    if (d.milestone) fm.milestone = d.milestone;
    if (entity.tags && entity.tags.length > 0) {
      fm.tags = entity.tags;
    }
    const assignees = d.assignees as MappedUser[] | undefined;
    if (assignees && assignees.length > 0) {
      fm.assignees = assignees.map((a) => a.login);
    }
    sections.push(frontmatter(fm));

    // Title
    sections.push(`# ${entity.title}`);

    // Metadata callout
    const metaParts: string[] = [];
    metaParts.push(`**State:** ${d.state}${d.stateReason ? ` (${d.stateReason})` : ""}`);
    if (user) metaParts.push(`**Author:** ${formatUserAvatar(user)}`);
    if (assignees && assignees.length > 0) {
      metaParts.push(`**Assignees:** ${assignees.map((a) => formatUserRef(a)).join(", ")}`);
    }
    if (d.milestone) metaParts.push(`**Milestone:** ${d.milestone}`);
    if (entity.tags && entity.tags.length > 0) {
      metaParts.push(`**Labels:** ${entity.tags.join(", ")}`);
    }
    const reactions = d.reactions as MappedReactions | null;
    const reactionsStr = formatReactions(reactions);
    if (reactionsStr) metaParts.push(`**Reactions:** ${reactionsStr}`);
    sections.push(callout("info", "Metadata", metaParts.join("\n")));

    // Body
    if (d.body) {
      sections.push(d.body as string);
    }

    // Related issues via wikilinks
    const relatedNumbers = this.extractIssueRefs(d.body as string | null);
    if (relatedNumbers.length > 0) {
      const links = relatedNumbers.map((num) => {
        const resolved = context.lookupEntityPath?.(`issue-${num}`);
        return wikilink(resolved ?? `issues/${num}`, `#${num}`);
      });
      sections.push(
        callout("link", "Related Issues", links.join("\n")),
      );
    }

    // Comments
    const comments = d.comments as MappedComment[] | undefined;
    if (comments && comments.length > 0) {
      sections.push(this.renderComments(comments));
    }

    return sections.join("\n\n");
  }

  private renderPullRequest(context: ThemeRenderContext): string {
    const { entity } = context;
    const d = entity.data;
    const user = d.user as MappedUser | null;
    const sections: string[] = [];

    // Determine review status
    let reviewStatus = "pending";
    if (d.merged) reviewStatus = "merged";
    else if (d.state === "closed") reviewStatus = "closed";
    else if (d.draft) reviewStatus = "draft";

    // Frontmatter
    const fm: Record<string, unknown> = {
      title: entity.title,
      type: "pull_request",
      number: d.number,
      state: d.state,
      review_status: reviewStatus,
      source: entity.url,
      head: d.head,
      base: d.base,
      draft: d.draft,
      merged: d.merged,
      created: d.createdAt,
      updated: d.updatedAt,
    };
    if (d.closedAt) fm.closed = d.closedAt;
    if (d.mergedAt) fm.merged_at = d.mergedAt;
    if (user) fm.author = user.login;
    if (d.milestone) fm.milestone = d.milestone;
    if (entity.tags && entity.tags.length > 0) {
      fm.tags = entity.tags;
    }
    const assignees = d.assignees as MappedUser[] | undefined;
    if (assignees && assignees.length > 0) {
      fm.assignees = assignees.map((a) => a.login);
    }
    sections.push(frontmatter(fm));

    // Title
    sections.push(`# ${entity.title}`);

    // Metadata callout
    const metaParts: string[] = [];
    metaParts.push(`**State:** ${d.state}`);
    metaParts.push(`**Review Status:** ${reviewStatus}`);
    if (user) metaParts.push(`**Author:** ${formatUserAvatar(user)}`);
    if (assignees && assignees.length > 0) {
      metaParts.push(`**Assignees:** ${assignees.map((a) => formatUserRef(a)).join(", ")}`);
    }
    if (d.milestone) metaParts.push(`**Milestone:** ${d.milestone}`);
    if (entity.tags && entity.tags.length > 0) {
      metaParts.push(`**Labels:** ${entity.tags.join(", ")}`);
    }
    const reactions = d.reactions as MappedReactions | null;
    const reactionsStr = formatReactions(reactions);
    if (reactionsStr) metaParts.push(`**Reactions:** ${reactionsStr}`);
    sections.push(callout("info", "Metadata", metaParts.join("\n")));

    // Branch info callout
    const branchParts: string[] = [];
    branchParts.push(`**Head:** \`${d.head}\` (${(d.headSha as string)?.slice(0, 7)})`);
    branchParts.push(`**Base:** \`${d.base}\` (${(d.baseSha as string)?.slice(0, 7)})`);
    if (d.merged) branchParts.push(`**Merged at:** ${d.mergedAt}`);
    if (d.reviewComments) branchParts.push(`**Review comments:** ${d.reviewComments}`);
    sections.push(callout("git", "Branch Info", branchParts.join("\n")));

    // Check runs
    const checkRuns = d.checkRuns as MappedCheckRun[] | undefined;
    if (checkRuns && checkRuns.length > 0) {
      sections.push(this.renderCheckRuns(checkRuns));
    }

    // Body
    if (d.body) {
      sections.push(d.body as string);
    }

    // Linked issues via wikilinks
    const relatedNumbers = this.extractIssueRefs(d.body as string | null);
    if (relatedNumbers.length > 0) {
      const links = relatedNumbers.map((num) => {
        const resolved = context.lookupEntityPath?.(`issue-${num}`);
        return wikilink(resolved ?? `issues/${num}`, `#${num}`);
      });
      sections.push(
        callout("link", "Linked Issues", links.join("\n")),
      );
    }

    // Reviews
    const reviews = d.reviews as MappedReview[] | undefined;
    if (reviews && reviews.length > 0) {
      sections.push(this.renderReviews(reviews));
    }

    // Comments
    const comments = d.comments as MappedComment[] | undefined;
    if (comments && comments.length > 0) {
      sections.push(this.renderComments(comments));
    }

    return sections.join("\n\n");
  }

  private renderComments(comments: MappedComment[]): string {
    const commentBlocks = comments.map((c) => {
      const header = `**${formatUserAvatar(c.user)} | ${formatDate(c.createdAt)}**`;
      const parts = [header];
      if (c.body) parts.push(c.body);
      const reactionsStr = formatReactions(c.reactions);
      if (reactionsStr) parts.push(reactionsStr);
      return parts.join("\n\n");
    });
    return `### Comments\n\n${commentBlocks.join("\n\n---\n\n")}`;
  }

  private renderReviews(reviews: MappedReview[]): string {
    const reviewBlocks = reviews.map((r) => {
      const stateLabel = reviewStateLabel(r.state);
      const header = `**${formatUserAvatar(r.user)} | ${stateLabel} | ${formatDate(r.submittedAt)}**`;
      const parts = [header];
      if (r.body) parts.push(r.body);
      return parts.join("\n\n");
    });
    return `### Reviews\n\n${reviewBlocks.join("\n\n---\n\n")}`;
  }

  private renderCheckRuns(checkRuns: MappedCheckRun[]): string {
    const rows = checkRuns.map((cr) => {
      const icon = checkConclusionIcon(cr.conclusion);
      const status = cr.conclusion ?? cr.status;
      return `| ${icon} | [${cr.name}](${cr.url}) | ${status} |`;
    });
    const table = [
      "| | Check | Status |",
      "|---|---|---|",
      ...rows,
    ].join("\n");
    return callout("check", "Check Runs", table);
  }

  private renderUser(context: ThemeRenderContext): string {
    const { entity } = context;
    const d = entity.data;
    const sections: string[] = [];

    const fm: Record<string, unknown> = {
      title: entity.title,
      type: "user",
      login: d.login,
      source: entity.url,
    };
    if (d.company) fm.company = d.company;
    if (d.location) fm.location = d.location;
    if (d.createdAt) fm.created = d.createdAt;
    sections.push(frontmatter(fm));

    sections.push(`# ${entity.title}`);

    const metaParts: string[] = [];
    metaParts.push(`**Login:** ${d.login}`);
    if (d.company) metaParts.push(`**Company:** ${d.company}`);
    if (d.location) metaParts.push(`**Location:** ${d.location}`);
    if (d.bio) metaParts.push(`**Bio:** ${d.bio}`);
    if (d.blog) metaParts.push(`**Blog:** ${d.blog}`);
    metaParts.push(`**Public repos:** ${d.publicRepos}`);
    metaParts.push(`**Followers:** ${d.followers} | **Following:** ${d.following}`);
    sections.push(callout("info", "Profile", metaParts.join("\n")));

    if (d.bio) {
      sections.push(d.bio as string);
    }

    return sections.join("\n\n");
  }

  // ── HTML rendering ─────────────────────────────────────────────

  renderHtml(context: ThemeRenderContext): string | null {
    const { entity } = context;
    if (entity.entityType === "pull_request") {
      return this.renderPullRequestHtml(context);
    }
    if (entity.entityType === "user") {
      return this.renderUserHtml(context);
    }
    return this.renderIssueHtml(context);
  }

  private renderIssueHtml(context: ThemeRenderContext): string {
    const { entity } = context;
    const d = entity.data;
    const user = d.user as MappedUser | null;
    const assignees = d.assignees as MappedUser[] | undefined;
    const comments = d.comments as MappedComment[] | undefined;
    const reactions = d.reactions as MappedReactions | null;

    const stateClass = d.state === "open" ? "gh-state-open" : "gh-state-closed";
    const stateIcon = d.state === "open" ? openIssueIcon : closedIssueIcon;
    const stateLabel = d.stateReason
      ? `${d.state} (${d.stateReason})`
      : (d.state as string);

    const parts: string[] = [];
    parts.push(`<div class="gh-issue-view">`);

    // Header
    parts.push(`<div class="gh-header">`);
    parts.push(`<h1 class="gh-title">${esc(entity.title)} <span class="gh-title-number">#${d.number}</span></h1>`);
    parts.push(`<div class="gh-header-meta">`);
    parts.push(`<span class="gh-state-badge ${stateClass}">${stateIcon} ${esc(stateLabel)}</span>`);
    if (user) {
      parts.push(`<span class="gh-meta-text">${avatarImg(user, 20)} <strong>${esc(user.login)}</strong> opened this on ${formatDate(d.createdAt as string)}</span>`);
    }
    if (d.commentCount) {
      parts.push(`<span class="gh-meta-text">&middot; ${d.commentCount} comment${(d.commentCount as number) !== 1 ? "s" : ""}</span>`);
    }
    parts.push(`</div>`);
    parts.push(`</div>`);

    // Two-column layout
    parts.push(`<div class="gh-columns">`);

    // Main column
    parts.push(`<div class="gh-main-col">`);

    // Body as first "comment" from the author
    if (d.body) {
      parts.push(commentBox(user, d.createdAt as string, d.body as string, reactions));
    }

    // Comments
    if (comments && comments.length > 0) {
      for (const c of comments) {
        parts.push(commentBox(c.user, c.createdAt, c.body, c.reactions));
      }
    }

    parts.push(`</div>`); // gh-main-col

    // Sidebar
    parts.push(`<div class="gh-sidebar-col">`);
    parts.push(sidebarSection("Assignees", assignees && assignees.length > 0
      ? assignees.map((a) => `<div class="gh-sidebar-user">${avatarImg(a, 20)} ${esc(a.login)}</div>`).join("")
      : `<span class="gh-sidebar-empty">No one assigned</span>`));

    parts.push(sidebarSection("Labels", entity.tags && entity.tags.length > 0
      ? entity.tags.map((t) => {
          const label = (d.labels as Array<{ name: string; color: string }>)?.find((l) => l.name === t);
          const bg = label ? `#${label.color}` : "var(--bg-tertiary)";
          const fg = label ? contrastColor(label.color) : "var(--text)";
          return `<span class="gh-label" style="background:${bg};color:${fg}">${esc(t)}</span>`;
        }).join(" ")
      : `<span class="gh-sidebar-empty">None</span>`));

    if (d.milestone) {
      parts.push(sidebarSection("Milestone", `<span>${esc(d.milestone as string)}</span>`));
    }

    if (entity.url) {
      parts.push(sidebarSection("", `<a class="gh-sidebar-link" href="${esc(entity.url)}" target="_blank" rel="noopener noreferrer">View on GitHub &rarr;</a>`));
    }

    parts.push(`</div>`); // gh-sidebar-col
    parts.push(`</div>`); // gh-columns
    parts.push(`</div>`); // gh-issue-view

    return parts.join("\n");
  }

  private renderPullRequestHtml(context: ThemeRenderContext): string {
    const { entity } = context;
    const d = entity.data;
    const user = d.user as MappedUser | null;
    const assignees = d.assignees as MappedUser[] | undefined;
    const comments = d.comments as MappedComment[] | undefined;
    const reviews = d.reviews as MappedReview[] | undefined;
    const checkRuns = d.checkRuns as MappedCheckRun[] | undefined;
    const reactions = d.reactions as MappedReactions | null;

    let stateClass: string;
    let stateIcon: string;
    let stateLabel: string;
    if (d.merged) {
      stateClass = "gh-state-merged";
      stateIcon = mergedPRIcon;
      stateLabel = "Merged";
    } else if (d.state === "open") {
      stateClass = "gh-state-open";
      stateIcon = openPRIcon;
      stateLabel = d.draft ? "Draft" : "Open";
    } else {
      stateClass = "gh-state-closed";
      stateIcon = closedPRIcon;
      stateLabel = "Closed";
    }

    const parts: string[] = [];
    parts.push(`<div class="gh-issue-view">`);

    // Header
    parts.push(`<div class="gh-header">`);
    parts.push(`<h1 class="gh-title">${esc(entity.title)} <span class="gh-title-number">#${d.number}</span></h1>`);
    parts.push(`<div class="gh-header-meta">`);
    parts.push(`<span class="gh-state-badge ${stateClass}">${stateIcon} ${esc(stateLabel)}</span>`);
    if (user) {
      parts.push(`<span class="gh-meta-text">${avatarImg(user, 20)} <strong>${esc(user.login)}</strong> wants to merge into <code>${esc(d.base as string)}</code> from <code>${esc(d.head as string)}</code></span>`);
    }
    parts.push(`</div>`);
    parts.push(`</div>`);

    // Two-column layout
    parts.push(`<div class="gh-columns">`);

    // Main column
    parts.push(`<div class="gh-main-col">`);

    // Body as first "comment" from author
    if (d.body) {
      parts.push(commentBox(user, d.createdAt as string, d.body as string, reactions));
    }

    // Check runs
    if (checkRuns && checkRuns.length > 0) {
      parts.push(`<div class="gh-checks-box">`);
      parts.push(`<div class="gh-checks-header">Checks</div>`);
      for (const cr of checkRuns) {
        const icon = checkConclusionIcon(cr.conclusion);
        const status = cr.conclusion ?? cr.status;
        parts.push(`<div class="gh-check-row">`);
        parts.push(`<span class="gh-check-icon">${icon}</span>`);
        parts.push(`<span class="gh-check-name">${esc(cr.name)}</span>`);
        parts.push(`<span class="gh-check-status gh-check-${cr.conclusion ?? cr.status}">${esc(status)}</span>`);
        parts.push(`</div>`);
      }
      parts.push(`</div>`);
    }

    // Reviews
    if (reviews && reviews.length > 0) {
      for (const r of reviews) {
        const stateLabel = reviewStateLabel(r.state);
        parts.push(`<div class="gh-review-box gh-review-${r.state.toLowerCase()}">`);
        parts.push(`<div class="gh-comment-header">`);
        parts.push(`${avatarImg(r.user, 24)} <strong>${esc(r.user?.login ?? "Unknown")}</strong> <span class="gh-review-state">${stateLabel}</span> on ${formatDate(r.submittedAt)}`);
        parts.push(`</div>`);
        if (r.body) {
          parts.push(`<div class="gh-comment-body">${simpleMarkdown(r.body)}</div>`);
        }
        parts.push(`</div>`);
      }
    }

    // Comments
    if (comments && comments.length > 0) {
      for (const c of comments) {
        parts.push(commentBox(c.user, c.createdAt, c.body, c.reactions));
      }
    }

    parts.push(`</div>`); // gh-main-col

    // Sidebar
    parts.push(`<div class="gh-sidebar-col">`);

    // Reviewers (deduplicated from reviews)
    if (reviews && reviews.length > 0) {
      const seen = new Set<string>();
      const reviewerHtml = reviews
        .filter((r) => r.user && !seen.has(r.user.login) && (seen.add(r.user.login), true))
        .map((r) => {
          const icon = reviewStateIcon(r.state);
          return `<div class="gh-sidebar-user">${avatarImg(r.user, 20)} ${esc(r.user!.login)} ${icon}</div>`;
        })
        .join("");
      if (reviewerHtml) parts.push(sidebarSection("Reviewers", reviewerHtml));
    }

    parts.push(sidebarSection("Assignees", assignees && assignees.length > 0
      ? assignees.map((a) => `<div class="gh-sidebar-user">${avatarImg(a, 20)} ${esc(a.login)}</div>`).join("")
      : `<span class="gh-sidebar-empty">No one assigned</span>`));

    parts.push(sidebarSection("Labels", entity.tags && entity.tags.length > 0
      ? entity.tags.map((t) => {
          const label = (d.labels as Array<{ name: string; color: string }>)?.find((l) => l.name === t);
          const bg = label ? `#${label.color}` : "var(--bg-tertiary)";
          const fg = label ? contrastColor(label.color) : "var(--text)";
          return `<span class="gh-label" style="background:${bg};color:${fg}">${esc(t)}</span>`;
        }).join(" ")
      : `<span class="gh-sidebar-empty">None</span>`));

    if (d.milestone) {
      parts.push(sidebarSection("Milestone", `<span>${esc(d.milestone as string)}</span>`));
    }

    // Branch info
    parts.push(sidebarSection("Branch",
      `<code>${esc(d.head as string)}</code> &rarr; <code>${esc(d.base as string)}</code>`));

    if (entity.url) {
      parts.push(sidebarSection("", `<a class="gh-sidebar-link" href="${esc(entity.url)}" target="_blank" rel="noopener noreferrer">View on GitHub &rarr;</a>`));
    }

    parts.push(`</div>`); // gh-sidebar-col
    parts.push(`</div>`); // gh-columns
    parts.push(`</div>`); // gh-issue-view

    return parts.join("\n");
  }

  private renderUserHtml(context: ThemeRenderContext): string {
    const { entity } = context;
    const d = entity.data;

    const parts: string[] = [];
    parts.push(`<div class="gh-issue-view">`);

    parts.push(`<div class="gh-header">`);
    parts.push(`<div style="display:flex;align-items:center;gap:16px">`);
    if (d.avatarUrl) {
      parts.push(`<img class="gh-avatar" src="${esc(d.avatarUrl as string)}&amp;size=128" width="64" height="64" alt="${esc(d.login as string)}" style="border-radius:50%" />`);
    }
    parts.push(`<div>`);
    parts.push(`<h1 class="gh-title" style="margin:0">${esc(entity.title)}</h1>`);
    parts.push(`<span class="gh-meta-text">@${esc(d.login as string)}</span>`);
    parts.push(`</div>`);
    parts.push(`</div>`);
    parts.push(`</div>`);

    parts.push(`<div class="gh-columns">`);
    parts.push(`<div class="gh-main-col">`);

    if (d.bio) {
      parts.push(`<div class="gh-comment-box"><div class="gh-comment-body">${simpleMarkdown(d.bio as string)}</div></div>`);
    }

    parts.push(`</div>`);
    parts.push(`<div class="gh-sidebar-col">`);

    if (d.company) parts.push(sidebarSection("Company", `<span>${esc(d.company as string)}</span>`));
    if (d.location) parts.push(sidebarSection("Location", `<span>${esc(d.location as string)}</span>`));
    if (d.blog) parts.push(sidebarSection("Blog", `<a class="gh-sidebar-link" href="${esc(d.blog as string)}" target="_blank" rel="noopener noreferrer">${esc(d.blog as string)}</a>`));

    const stats = [
      `<strong>${d.publicRepos ?? 0}</strong> repos`,
      `<strong>${d.followers ?? 0}</strong> followers`,
      `<strong>${d.following ?? 0}</strong> following`,
    ].join(" &middot; ");
    parts.push(sidebarSection("Stats", `<span>${stats}</span>`));

    if (entity.url) {
      parts.push(sidebarSection("", `<a class="gh-sidebar-link" href="${esc(entity.url)}" target="_blank" rel="noopener noreferrer">View on GitHub &rarr;</a>`));
    }

    parts.push(`</div>`);
    parts.push(`</div>`);
    parts.push(`</div>`);

    return parts.join("\n");
  }

  private extractIssueRefs(body: string | null): string[] {
    if (!body) return [];
    const refs = body.match(/#(\d+)/g);
    if (!refs) return [];
    const seen = new Set<string>();
    const result: string[] = [];
    for (const ref of refs) {
      const num = ref.slice(1);
      if (!seen.has(num)) {
        seen.add(num);
        result.push(num);
      }
    }
    return result;
  }
}
