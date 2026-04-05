import type { Theme, ThemeRenderContext } from "@veecontext/core";
import { frontmatter, wikilink, callout } from "@veecontext/core";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export class GitHubTheme implements Theme {
  connectorType = "github";

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
    if (d.closedAt) fm.closed = d.closedAt;
    if (d.user) fm.author = d.user;
    if (d.milestone) fm.milestone = d.milestone;
    if (entity.tags && entity.tags.length > 0) {
      fm.tags = entity.tags;
    }
    if ((d.assignees as string[])?.length > 0) {
      fm.assignees = d.assignees;
    }
    sections.push(frontmatter(fm));

    // Title
    sections.push(`# ${entity.title}`);

    // Metadata callout
    const metaParts: string[] = [];
    metaParts.push(`**State:** ${d.state}`);
    if (d.user) metaParts.push(`**Author:** ${d.user}`);
    if ((d.assignees as string[])?.length > 0) {
      metaParts.push(`**Assignees:** ${(d.assignees as string[]).join(", ")}`);
    }
    if (d.milestone) metaParts.push(`**Milestone:** ${d.milestone}`);
    if (entity.tags && entity.tags.length > 0) {
      metaParts.push(`**Labels:** ${entity.tags.join(", ")}`);
    }
    sections.push(callout("info", "Metadata", metaParts.join("\n")));

    // Body
    if (d.body) {
      sections.push(d.body as string);
    }

    // Related issues via wikilinks
    const relatedNumbers = this.extractIssueRefs(d.body as string | null);
    if (relatedNumbers.length > 0) {
      const links = relatedNumbers.map((num) =>
        wikilink(`issues/${num}`, `#${num}`),
      );
      sections.push(
        callout("link", "Related Issues", links.join("\n")),
      );
    }

    return sections.join("\n\n");
  }

  private renderPullRequest(context: ThemeRenderContext): string {
    const { entity } = context;
    const d = entity.data;
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
    if (d.user) fm.author = d.user;
    if (d.milestone) fm.milestone = d.milestone;
    if (entity.tags && entity.tags.length > 0) {
      fm.tags = entity.tags;
    }
    if ((d.assignees as string[])?.length > 0) {
      fm.assignees = d.assignees;
    }
    sections.push(frontmatter(fm));

    // Title
    sections.push(`# ${entity.title}`);

    // Metadata callout
    const metaParts: string[] = [];
    metaParts.push(`**State:** ${d.state}`);
    metaParts.push(`**Review Status:** ${reviewStatus}`);
    if (d.user) metaParts.push(`**Author:** ${d.user}`);
    if ((d.assignees as string[])?.length > 0) {
      metaParts.push(`**Assignees:** ${(d.assignees as string[]).join(", ")}`);
    }
    if (d.milestone) metaParts.push(`**Milestone:** ${d.milestone}`);
    if (entity.tags && entity.tags.length > 0) {
      metaParts.push(`**Labels:** ${entity.tags.join(", ")}`);
    }
    sections.push(callout("info", "Metadata", metaParts.join("\n")));

    // Branch info callout
    const branchParts: string[] = [];
    branchParts.push(`**Head:** \`${d.head}\` (${(d.headSha as string)?.slice(0, 7)})`);
    branchParts.push(`**Base:** \`${d.base}\` (${(d.baseSha as string)?.slice(0, 7)})`);
    if (d.merged) branchParts.push(`**Merged at:** ${d.mergedAt}`);
    if (d.reviewComments) branchParts.push(`**Review comments:** ${d.reviewComments}`);
    sections.push(callout("git", "Branch Info", branchParts.join("\n")));

    // Body
    if (d.body) {
      sections.push(d.body as string);
    }

    // Linked issues via wikilinks
    const relatedNumbers = this.extractIssueRefs(d.body as string | null);
    if (relatedNumbers.length > 0) {
      const links = relatedNumbers.map((num) =>
        wikilink(`issues/${num}`, `#${num}`),
      );
      sections.push(
        callout("link", "Linked Issues", links.join("\n")),
      );
    }

    return sections.join("\n\n");
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
