import type { Theme, ThemeRenderContext } from "@frozenink/core/theme";
import { frontmatter, wikilink, callout } from "@frozenink/core/theme";
import { gemoji } from "gemoji";

// Build emoji shortcode lookup map once
const emojiMap = new Map<string, string>();
for (const g of gemoji) {
  for (const name of g.names) {
    emojiMap.set(name, g.emoji);
  }
}

/** Replace GitHub-style :emoji_name: shortcodes with actual emoji characters */
function emojify(text: string): string {
  return text.replace(/:([a-z0-9_+-]+):/g, (match, name) => {
    return emojiMap.get(name) ?? match;
  });
}

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

interface MappedReviewComment {
  id: number;
  user: MappedUser | null;
  body: string;
  path: string;
  diffHunk: string;
  createdAt: string;
  url: string;
  inReplyToId: number | null;
  reactions: MappedReactions | null;
}

interface MappedReview {
  id: number;
  user: MappedUser | null;
  state: string;
  body: string | null;
  submittedAt: string;
  url: string;
  reviewComments?: MappedReviewComment[];
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

type UserUrlResolver = (login: string) => string;

function makeUserUrlResolver(
  lookup?: (externalId: string) => string | undefined,
): UserUrlResolver {
  return (login: string) => {
    if (lookup) {
      const localPath = lookup(`user-${login}`);
      if (localPath) return `#wikilink/${encodeURIComponent(localPath)}`;
    }
    return `https://github.com/${login}`;
  };
}

function avatarImg(user: MappedUser | null, size: number, resolve?: UserUrlResolver): string {
  if (!user) return "";
  const href = resolve ? resolve(user.login) : esc(user.url);
  const isLocal = href.startsWith("#");
  const target = isLocal ? "" : ` target="_blank" rel="noopener noreferrer"`;
  return `<a href="${href}"${target} class="gh-avatar-link"><img class="gh-avatar" src="${esc(user.avatarUrl)}&amp;size=${size * 2}" width="${size}" height="${size}" alt="${esc(user.login)}" /></a>`;
}

function userLink(user: MappedUser | null, bold = true, resolve?: UserUrlResolver): string {
  if (!user) return "Unknown";
  const name = esc(user.login);
  const tag = bold ? "strong" : "span";
  const href = resolve ? resolve(user.login) : esc(user.url);
  const isLocal = href.startsWith("#");
  const target = isLocal ? "" : ` target="_blank" rel="noopener noreferrer"`;
  return `<a class="gh-user-link" href="${href}"${target}><${tag}>${name}</${tag}></a>`;
}

interface MarkdownOptions {
  resolveUser?: UserUrlResolver;
  /** owner/repo for shortening GitHub URLs (e.g. "microsoft/TypeScript") */
  repo?: string;
  /** Resolve an externalId to a local wikilink path */
  lookupEntityPath?: (externalId: string) => string | undefined;
}

function simpleMarkdown(text: string, opts?: MarkdownOptions): string {
  const resolve = opts?.resolveUser;
  // Normalize line endings, strip HTML comments, convert emoji shortcodes
  let raw = text.replace(/\r\n/g, "\n");
  raw = raw.replace(/<!--[\s\S]*?-->/g, "");
  raw = emojify(raw);

  // Setext-style headers: text followed by === or --- on the next line
  raw = raw.replace(/^(.+)\n={3,}\s*$/gm, "# $1");
  raw = raw.replace(/^(.+)\n-{3,}\s*$/gm, "## $1");

  // Extract HTML anchor tags before escaping (GitHub renders these)
  const htmlLinks: string[] = [];
  raw = raw.replace(/<a\s+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, url, text) => {
    const idx = htmlLinks.length;
    htmlLinks.push(`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>`);
    return `\x00HTMLLINK${idx}\x00`;
  });

  // Extract markdown links before escaping (URLs may contain parens, special chars)
  const links: string[] = [];
  raw = raw.replace(/\[([^\]]+)\]\(([^)]*(?:\([^)]*\))*[^)]*)\)/g, (_m, text, url) => {
    const idx = links.length;
    links.push(`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>`);
    return `\x00LINK${idx}\x00`;
  });

  // Extract code blocks before escaping so their content stays literal
  // Language hint can be "ts", "ts repro", "typescript", etc. — take the first word only.
  const codeBlocks: string[] = [];
  raw = raw.replace(/```([^\n]*)\n([\s\S]*?)```/g, (_m, langLine, code) => {
    const idx = codeBlocks.length;
    const lang = langLine.trim().split(/\s/)[0] || "";
    const escapedCode = esc(code.replace(/\n$/, ""));
    const langClass = lang ? ` class="language-${esc(lang)}"` : "";
    codeBlocks.push(
      `<div class="gh-code-block"><pre><code${langClass}>${escapedCode}</code></pre>` +
      `<button class="gh-copy-btn" onclick="navigator.clipboard.writeText(this.closest('.gh-code-block').querySelector('code').textContent).then(()=>{this.textContent='Copied!';setTimeout(()=>this.textContent='Copy',2000)})" title="Copy code">Copy</button></div>`,
    );
    return `\x00CODEBLOCK${idx}\x00`;
  });

  let html = esc(raw);

  // Restore code blocks, HTML links, and markdown links
  html = html.replace(/\x00CODEBLOCK(\d+)\x00/g, (_m, idx) => codeBlocks[parseInt(idx)]);
  html = html.replace(/\x00HTMLLINK(\d+)\x00/g, (_m, idx) => htmlLinks[parseInt(idx)]);
  html = html.replace(/\x00LINK(\d+)\x00/g, (_m, idx) => links[parseInt(idx)]);

  // Inline code
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  // Italic (not inside words)
  html = html.replace(/(?<!\w)\*(.+?)\*(?!\w)/g, "<em>$1</em>");
  // Shorten GitHub issue/PR URLs to compact #nnn references
  // Matches: https://github.com/owner/repo/issues/123 or .../pull/123 (with optional #fragment)
  html = html.replace(
    /(?<!="|>)https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/(issues|pull)\/(\d+)(#[^\s<]*)?/g,
    (_m, owner, repo, type, num, fragment) => {
      const fullRepo = `${owner}/${repo}`;
      const externalId = type === "pull" ? `pr-${num}` : `issue-${num}`;
      const isSameRepo = opts?.repo && fullRepo === opts.repo;

      // Try local link first (only for same-repo refs)
      if (isSameRepo && opts?.lookupEntityPath) {
        const localPath = opts.lookupEntityPath(externalId);
        if (localPath) {
          return `<a class="gh-issue-ref" href="#wikilink/${encodeURIComponent(localPath)}">#${num}</a>`;
        }
      }

      // Render as compact ref linking to GitHub
      const url = `https://github.com/${owner}/${repo}/${type}/${num}${fragment ?? ""}`;
      const label = isSameRepo ? `#${num}` : `${fullRepo}#${num}`;
      return `<a class="gh-issue-ref" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    },
  );

  // Bare URLs (not already inside an href or anchor)
  html = html.replace(
    /(?<!="|>)(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>',
  );
  // @mentions → link to user page (local if available, otherwise GitHub)
  html = html.replace(
    /(?<![\/\w])@([a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)/g,
    (_m, login) => {
      const href = resolve ? resolve(login) : `https://github.com/${login}`;
      const isLocal = href.startsWith("#");
      const target = isLocal ? "" : ` target="_blank" rel="noopener noreferrer"`;
      return `<a class="gh-mention" href="${href}"${target}>@${esc(login)}</a>`;
    },
  );
  // #nnn issue/PR references → link to local page or GitHub
  // Must come after @mentions and URL shortening. Avoid matching headings (^#) or HTML entities (&#).
  html = html.replace(
    /(?<![&\/\w#])#(\d+)\b/g,
    (_m, num) => {
      // Try issue first, then PR
      if (opts?.lookupEntityPath) {
        const issuePath = opts.lookupEntityPath(`issue-${num}`);
        if (issuePath) return `<a class="gh-issue-ref" href="#wikilink/${encodeURIComponent(issuePath)}">#${num}</a>`;
        const prPath = opts.lookupEntityPath(`pr-${num}`);
        if (prPath) return `<a class="gh-issue-ref" href="#wikilink/${encodeURIComponent(prPath)}">#${num}</a>`;
      }
      // Fallback to GitHub (assume issue — GitHub redirects PRs correctly)
      if (opts?.repo) {
        return `<a class="gh-issue-ref" href="https://github.com/${opts.repo}/issues/${num}" target="_blank" rel="noopener noreferrer">#${num}</a>`;
      }
      return `#${num}`;
    },
  );

  // Headings (### etc)
  html = html.replace(/^(#{1,6})\s+(.+)$/gm, (_m, hashes, text) => {
    const level = hashes.length;
    return `<h${level}>${text}</h${level}>`;
  });
  // Paragraphs — split on blank lines, skip blocks that already have block-level HTML
  html = html.replace(/\n\n+/g, "</p><p>");
  html = `<p>${html}</p>`;
  // Clean up empty paragraphs and paragraphs wrapping block elements
  html = html.replace(/<p>\s*<\/p>/g, "");
  html = html.replace(/<p>\s*(<div|<h[1-6]|<pre)/g, "$1");
  html = html.replace(/(<\/div>|<\/h[1-6]>|<\/pre>)\s*<\/p>/g, "$1");
  return html;
}

function commentBox(
  user: MappedUser | null,
  createdAt: string,
  body: string,
  reactions: MappedReactions | null,
  mdOpts?: MarkdownOptions,
): string {
  const parts: string[] = [];
  parts.push(`<div class="gh-comment-box">`);
  parts.push(`<div class="gh-comment-header">`);
  parts.push(`${avatarImg(user, 32, mdOpts?.resolveUser)} ${userLink(user, true, mdOpts?.resolveUser)} <span class="gh-comment-date">commented on ${formatDate(createdAt)}</span>`);
  parts.push(`</div>`);
  parts.push(`<div class="gh-comment-body">${simpleMarkdown(body, mdOpts)}</div>`);
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

  folderConfigs() {
    return {
      issues: { sort: "DESC" as const },
      "pull-requests": { sort: "DESC" as const },
      assets: { visible: false },
    };
  }

  agentsMarkdown(options: { title: string; description?: string; config?: Record<string, unknown> }): string {
    const { title, description, config } = options;
    const owner = config?.owner as string | undefined;
    const repo = config?.repo as string | undefined;
    const repoRef = owner && repo ? ` **${owner}/${repo}**` : "";

    const lines: string[] = [];
    lines.push(`# ${title}`);
    lines.push("");
    if (description) {
      // Use the user-provided description as-is
      lines.push(description);
    } else {
      // Fall back to a generic description when none is set
      lines.push(`This collection is synced from the GitHub repository${repoRef}.`);
    }
    lines.push("");
    lines.push("## Entity Types");
    lines.push("");
    lines.push("### Issues (`issues/`)");
    lines.push("GitHub Issues representing bugs, feature requests, and tasks. Each issue is stored as a Markdown file named `{number}-{slug}.md`. Files include frontmatter with state, labels, and assignees, the original description, and all comments.");
    lines.push("");
    lines.push("### Pull Requests (`pull-requests/`)");
    lines.push("GitHub Pull Requests representing proposed code changes. Each PR is stored as a Markdown file named `{number}-{slug}.md`. Files include frontmatter with state, base/head branches, and reviewers, the description, review comments, and check run results.");
    lines.push("");
    lines.push("### Users (`users/`)");
    lines.push("GitHub user profiles referenced by issues and pull requests. Each user is stored as `users/{username}.md`.");
    return lines.join("\n") + "\n";
  }

  private renderIssue(context: ThemeRenderContext): string {
    const { entity } = context;
    const d = entity.data;
    const source = this.getFilePath(context);
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

    // Body — shorten GitHub issue/PR URLs to compact refs
    if (d.body) {
      sections.push(this.shortenGitHubRefs(d.body as string, entity.url, context.lookupEntityPath));
    }

    // Related issues via wikilinks
    const relatedNumbers = this.extractIssueRefs(d.body as string | null);
    if (relatedNumbers.length > 0) {
      const links = relatedNumbers.map((num) => {
        const resolved = context.lookupEntityPath?.(`issue-${num}`);
        return wikilink(resolved ?? `issues/${num}`, `#${num}`, source);
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
    const source = this.getFilePath(context);
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

    // Body — shorten GitHub issue/PR URLs to compact refs
    if (d.body) {
      sections.push(this.shortenGitHubRefs(d.body as string, entity.url, context.lookupEntityPath));
    }

    // Linked issues via wikilinks
    const relatedNumbers = this.extractIssueRefs(d.body as string | null);
    if (relatedNumbers.length > 0) {
      const links = relatedNumbers.map((num) => {
        const resolved = context.lookupEntityPath?.(`issue-${num}`);
        return wikilink(resolved ?? `issues/${num}`, `#${num}`, source);
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
    const reviewBlocks = reviews
      .filter((r) => r.body || (r.reviewComments && r.reviewComments.length > 0))
      .map((r) => {
        const stateLabel = reviewStateLabel(r.state);
        const header = `**${formatUserAvatar(r.user)} | ${stateLabel} | ${formatDate(r.submittedAt)}**`;
        const parts = [header];
        if (r.body) parts.push(r.body);

        // Render diff-level review comments
        const reviewComments = r.reviewComments ?? [];
        if (reviewComments.length > 0) {
          const rootComments = reviewComments.filter((rc) => !rc.inReplyToId);
          for (const rc of rootComments) {
            parts.push(`**${rc.path}**`);
            parts.push("```diff\n" + rc.diffHunk + "\n```");
            parts.push(`> **${rc.user?.login ?? "Unknown"}** (${formatDate(rc.createdAt)}):\n> ${rc.body.split("\n").join("\n> ")}`);
            // Threaded replies
            const replies = reviewComments.filter((reply) => reply.inReplyToId === rc.id);
            for (const reply of replies) {
              parts.push(`> **${reply.user?.login ?? "Unknown"}** (${formatDate(reply.createdAt)}):\n> ${reply.body.split("\n").join("\n> ")}`);
            }
          }
        }

        return parts.join("\n\n");
      });
    if (reviewBlocks.length === 0) return "";
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
    const resolve = makeUserUrlResolver(context.lookupEntityPath);
    if (entity.entityType === "pull_request") {
      return this.renderPullRequestHtml(context, resolve);
    }
    if (entity.entityType === "user") {
      return this.renderUserHtml(context);
    }
    return this.renderIssueHtml(context, resolve);
  }

  private renderIssueHtml(context: ThemeRenderContext, resolve: UserUrlResolver): string {
    const { entity } = context;
    const d = entity.data;
    const user = d.user as MappedUser | null;
    const assignees = d.assignees as MappedUser[] | undefined;
    const comments = d.comments as MappedComment[] | undefined;
    const reactions = d.reactions as MappedReactions | null;

    // Build repo slug from entity URL for GitHub ref shortening
    const repoSlug = this.extractRepoSlug(entity.url);
    const mdOpts: MarkdownOptions = { resolveUser: resolve, repo: repoSlug, lookupEntityPath: context.lookupEntityPath };

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
      parts.push(`<span class="gh-meta-text">${avatarImg(user, 28, resolve)} ${userLink(user, true, resolve)} opened this on ${formatDate(d.createdAt as string)}</span>`);
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
      parts.push(commentBox(user, d.createdAt as string, d.body as string, reactions, mdOpts));
    }

    // Comments
    if (comments && comments.length > 0) {
      for (const c of comments) {
        parts.push(commentBox(c.user, c.createdAt, c.body, c.reactions, mdOpts));
      }
    }

    parts.push(`</div>`); // gh-main-col

    // Sidebar
    parts.push(`<div class="gh-sidebar-col">`);
    parts.push(sidebarSection("Assignees", assignees && assignees.length > 0
      ? assignees.map((a) => `<div class="gh-sidebar-user">${avatarImg(a, 24, resolve)} ${userLink(a, false, resolve)}</div>`).join("")
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

  private renderPullRequestHtml(context: ThemeRenderContext, resolve: UserUrlResolver): string {
    const { entity } = context;
    const d = entity.data;
    const user = d.user as MappedUser | null;
    const assignees = d.assignees as MappedUser[] | undefined;
    const comments = d.comments as MappedComment[] | undefined;
    const reviews = d.reviews as MappedReview[] | undefined;
    const repoSlug = this.extractRepoSlug(entity.url);
    const mdOpts: MarkdownOptions = { resolveUser: resolve, repo: repoSlug, lookupEntityPath: context.lookupEntityPath };
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
      parts.push(`<span class="gh-meta-text">${avatarImg(user, 28, resolve)} ${userLink(user, true, resolve)} wants to merge into <code>${esc(d.base as string)}</code> from <code>${esc(d.head as string)}</code></span>`);
    }
    parts.push(`</div>`);
    parts.push(`</div>`);

    // Two-column layout
    parts.push(`<div class="gh-columns">`);

    // Main column
    parts.push(`<div class="gh-main-col">`);

    // Body as first "comment" from author
    if (d.body) {
      parts.push(commentBox(user, d.createdAt as string, d.body as string, reactions, mdOpts));
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

    // Reviews (with diff-level comments)
    if (reviews && reviews.length > 0) {
      for (const r of reviews) {
        const stateLabel = reviewStateLabel(r.state);
        const reviewComments = r.reviewComments ?? [];
        // Skip reviews with no body and no review comments (nothing to show)
        if (!r.body && reviewComments.length === 0) continue;

        parts.push(`<div class="gh-review-box gh-review-${r.state.toLowerCase()}">`);
        parts.push(`<div class="gh-comment-header">`);
        parts.push(`${avatarImg(r.user, 32, resolve)} ${userLink(r.user, true, resolve)} <span class="gh-review-state">${stateLabel}</span> <span class="gh-comment-date">on ${formatDate(r.submittedAt)}</span>`);
        parts.push(`</div>`);
        if (r.body) {
          parts.push(`<div class="gh-comment-body">${simpleMarkdown(r.body, mdOpts)}</div>`);
        }

        // Render diff-level review comments grouped by file
        if (reviewComments.length > 0) {
          // Group by path, preserving order, and thread replies
          const rootComments = reviewComments.filter((rc) => !rc.inReplyToId);
          const repliesByParent = new Map<number, MappedReviewComment[]>();
          for (const rc of reviewComments) {
            if (rc.inReplyToId) {
              const list = repliesByParent.get(rc.inReplyToId) ?? [];
              list.push(rc);
              repliesByParent.set(rc.inReplyToId, list);
            }
          }

          for (const rc of rootComments) {
            parts.push(`<div class="gh-diff-comment">`);
            parts.push(`<div class="gh-diff-file">${esc(rc.path)}</div>`);
            parts.push(`<pre class="gh-diff-hunk"><code>${esc(rc.diffHunk)}</code></pre>`);
            parts.push(`<div class="gh-diff-comment-body">`);
            parts.push(`<div class="gh-diff-comment-header">${avatarImg(rc.user, 24, resolve)} ${userLink(rc.user, true, resolve)} <span class="gh-comment-date">${formatDate(rc.createdAt)}</span></div>`);
            parts.push(`<div class="gh-comment-body">${simpleMarkdown(rc.body, mdOpts)}</div>`);
            parts.push(`</div>`);

            // Render threaded replies
            const replies = repliesByParent.get(rc.id) ?? [];
            for (const reply of replies) {
              parts.push(`<div class="gh-diff-comment-body gh-diff-reply">`);
              parts.push(`<div class="gh-diff-comment-header">${avatarImg(reply.user, 24, resolve)} ${userLink(reply.user, true, resolve)} <span class="gh-comment-date">${formatDate(reply.createdAt)}</span></div>`);
              parts.push(`<div class="gh-comment-body">${simpleMarkdown(reply.body, mdOpts)}</div>`);
              parts.push(`</div>`);
            }

            parts.push(`</div>`);
          }
        }

        parts.push(`</div>`);
      }
    }

    // Comments
    if (comments && comments.length > 0) {
      for (const c of comments) {
        parts.push(commentBox(c.user, c.createdAt, c.body, c.reactions, mdOpts));
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
          return `<div class="gh-sidebar-user">${avatarImg(r.user, 24, resolve)} ${userLink(r.user, false, resolve)} <span class="gh-review-icon">${icon}</span></div>`;
        })
        .join("");
      if (reviewerHtml) parts.push(sidebarSection("Reviewers", reviewerHtml));
    }

    parts.push(sidebarSection("Assignees", assignees && assignees.length > 0
      ? assignees.map((a) => `<div class="gh-sidebar-user">${avatarImg(a, 24, resolve)} ${userLink(a, false, resolve)}</div>`).join("")
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
    const login = esc(d.login as string);

    const parts: string[] = [];
    parts.push(`<div class="gh-issue-view">`);
    parts.push(`<div class="gh-user-card">`);

    // Avatar + name header
    parts.push(`<div class="gh-user-header">`);
    if (d.avatarUrl) {
      parts.push(`<img class="gh-avatar gh-user-avatar-lg" src="${esc(d.avatarUrl as string)}&amp;size=200" width="96" height="96" alt="${login}" />`);
    }
    parts.push(`<div>`);
    if (entity.title !== d.login) {
      parts.push(`<h1 class="gh-user-name">${esc(entity.title)}</h1>`);
      parts.push(`<div class="gh-user-login">${login}</div>`);
    } else {
      parts.push(`<h1 class="gh-user-name">${login}</h1>`);
    }
    parts.push(`</div>`);
    parts.push(`</div>`);

    // Bio
    if (d.bio) {
      parts.push(`<p class="gh-user-bio">${esc(d.bio as string)}</p>`);
    }

    // Meta items
    const meta: string[] = [];
    if (d.company) meta.push(`<span class="gh-user-meta-item">\u{1F3E2} ${esc(d.company as string)}</span>`);
    if (d.location) meta.push(`<span class="gh-user-meta-item">\u{1F4CD} ${esc(d.location as string)}</span>`);
    if (d.blog) {
      const blogUrl = (d.blog as string).startsWith("http") ? d.blog as string : `https://${d.blog as string}`;
      meta.push(`<span class="gh-user-meta-item">\u{1F517} <a class="gh-user-link" href="${esc(blogUrl)}" target="_blank" rel="noopener noreferrer">${esc(d.blog as string)}</a></span>`);
    }
    if (meta.length > 0) {
      parts.push(`<div class="gh-user-meta">${meta.join("")}</div>`);
    }

    // Stats
    const stats: string[] = [];
    stats.push(`<strong>${d.followers ?? 0}</strong> followers`);
    stats.push(`<strong>${d.following ?? 0}</strong> following`);
    stats.push(`<strong>${d.publicRepos ?? 0}</strong> repositories`);
    parts.push(`<div class="gh-user-stats">${stats.join(" &middot; ")}</div>`);

    if (entity.url) {
      parts.push(`<a class="gh-user-link" href="${esc(entity.url)}" target="_blank" rel="noopener noreferrer">View on GitHub &rarr;</a>`);
    }

    parts.push(`</div>`); // gh-user-card
    parts.push(`</div>`); // gh-issue-view

    return parts.join("\n");
  }

  /**
   * Shorten GitHub issue/PR URLs in body text to compact #nnn markdown links.
   * Same-repo refs become [#nnn](url), cross-repo become [owner/repo#nnn](url).
   */
  private shortenGitHubRefs(body: string, entityUrl?: string, lookupEntityPath?: (id: string) => string | undefined): string {
    const repoSlug = this.extractRepoSlug(entityUrl);
    return body.replace(
      /https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/(issues|pull)\/(\d+)(#[^\s)]*)?/g,
      (fullMatch, owner, repo, type, num, fragment) => {
        const fullRepo = `${owner}/${repo}`;
        const isSameRepo = repoSlug && fullRepo === repoSlug;
        const externalId = type === "pull" ? `pr-${num}` : `issue-${num}`;

        // Try local wikilink for same-repo refs
        if (isSameRepo && lookupEntityPath) {
          const localPath = lookupEntityPath(externalId);
          if (localPath) {
            return `[[${localPath}|#${num}]]`;
          }
        }

        const label = isSameRepo ? `#${num}` : `${fullRepo}#${num}`;
        return `[${label}](${fullMatch})`;
      },
    );
  }

  /** Extract "owner/repo" from a GitHub entity URL like https://github.com/owner/repo/issues/123 */
  private extractRepoSlug(url?: string): string | undefined {
    if (!url) return undefined;
    const m = url.match(/github\.com\/([^/]+\/[^/]+)/);
    return m ? m[1] : undefined;
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
