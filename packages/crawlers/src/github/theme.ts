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

export class GitHubTheme implements Theme {
  crawlerType = "github";

  render(context: ThemeRenderContext): string {
    const { entity } = context;
    if (entity.entityType === "pull_request") {
      return this.renderPullRequest(context);
    }
    return this.renderIssue(context);
  }

  getFilePath(context: ThemeRenderContext): string {
    const { entity } = context;
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
      const stateLabel = this.reviewStateLabel(r.state);
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

  private reviewStateLabel(state: string): string {
    switch (state) {
      case "APPROVED": return "\u2705 Approved";
      case "CHANGES_REQUESTED": return "\u{1F534} Changes Requested";
      case "COMMENTED": return "\u{1F4AC} Commented";
      case "DISMISSED": return "\u{1F6AB} Dismissed";
      case "PENDING": return "\u23F3 Pending";
      default: return state;
    }
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
