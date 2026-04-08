import type { Theme, ThemeRenderContext } from "@frozenink/core/theme";
import { frontmatter, wikilink, callout } from "@frozenink/core/theme";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function safeBranchName(name: string): string {
  return name.replace(/\//g, "-");
}

function commitFilePath(shortHash: string, subject: string): string {
  const slug = slugify(subject);
  return slug ? `commits/${shortHash}-${slug}` : `commits/${shortHash}`;
}

function statusLabel(status: string): string {
  switch (status) {
    case "A": return "Added";
    case "M": return "Modified";
    case "D": return "Deleted";
    case "R": return "Renamed";
    case "C": return "Copied";
    case "T": return "Type changed";
    default: return status;
  }
}

export class GitTheme implements Theme {
  crawlerType = "git";

  render(context: ThemeRenderContext): string {
    const { entity } = context;
    switch (entity.entityType) {
      case "commit": return this.renderCommit(context);
      case "branch": return this.renderBranch(context);
      case "tag": return this.renderTag(context);
      default: return `# ${entity.title}\n\nUnknown entity type: ${entity.entityType}`;
    }
  }

  getFilePath(context: ThemeRenderContext): string {
    const { entity } = context;
    switch (entity.entityType) {
      case "commit": {
        const slug = slugify(entity.data.subject as string);
        const shortHash = entity.data.shortHash as string;
        return slug
          ? `commits/${shortHash}-${slug}.md`
          : `commits/${shortHash}.md`;
      }
      case "branch":
        return `branches/${safeBranchName(entity.data.name as string)}.md`;
      case "tag":
        return `tags/${safeBranchName(entity.data.name as string)}.md`;
      default:
        return `${entity.entityType}/${entity.externalId}.md`;
    }
  }

  private renderCommit(context: ThemeRenderContext): string {
    const d = context.entity.data;
    const sections: string[] = [];

    // Frontmatter
    const fm: Record<string, unknown> = {
      title: d.subject,
      type: "commit",
      hash: d.hash,
      short_hash: d.shortHash,
      author: d.author,
      date: d.date,
    };
    if ((d.parents as string[])?.length > 0) {
      fm.parents = (d.parents as string[]).map((h: string) => h.slice(0, 7));
    }
    if (context.entity.tags?.length) {
      fm.tags = context.entity.tags;
    }
    sections.push(frontmatter(fm));

    // Title
    sections.push(`# ${d.subject}`);

    // Metadata callout
    const meta: string[] = [];
    meta.push(`**Author:** ${d.author} <${d.authorEmail}>`);
    meta.push(`**Date:** ${d.date}`);
    meta.push(`**Hash:** \`${d.shortHash}\``);

    const parentDetails = d.parentDetails as Array<{
      hash: string; shortHash: string; subject: string;
    }> | undefined;
    if (parentDetails?.length) {
      const parentLinks = parentDetails.map((p) =>
        wikilink(commitFilePath(p.shortHash, p.subject), p.shortHash),
      );
      meta.push(`**Parents:** ${parentLinks.join(", ")}`);
    }
    sections.push(callout("info", "Commit Info", meta.join("\n")));

    // Body
    if (d.body) {
      sections.push(d.body as string);
    }

    // Files changed
    const files = d.files as Array<{
      status: string; path: string; oldPath?: string;
      additions: number; deletions: number; binary: boolean;
    }> | undefined;

    if (files?.length) {
      const fileLines: string[] = [];
      for (const f of files) {
        let line = `**${statusLabel(f.status)}** \`${f.path}\``;
        if (f.oldPath) {
          line = `**${statusLabel(f.status)}** \`${f.oldPath}\` → \`${f.path}\``;
        }
        if (f.binary) {
          line += " *(binary)*";
          // Embed image if it was added/modified and diffs are included
          const ext = f.path.split(".").pop()?.toLowerCase() ?? "";
          if (["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp"].includes(ext) && f.status !== "D") {
            const shortHash = d.shortHash as string;
            const filename = f.path.split("/").pop() ?? f.path;
            line += `\n![[git/${shortHash}/${filename}]]`;
          }
        } else {
          const parts: string[] = [];
          if (f.additions > 0) parts.push(`+${f.additions}`);
          if (f.deletions > 0) parts.push(`-${f.deletions}`);
          if (parts.length) line += ` (${parts.join(", ")})`;
        }
        fileLines.push(line);
      }
      sections.push(callout("note", `Files Changed (${files.length})`, fileLines.join("\n")));
    }

    // Diff
    if (d.diff) {
      sections.push("## Diff\n\n```diff\n" + (d.diff as string) + "\n```");
    }

    return sections.join("\n\n");
  }

  private renderBranch(context: ThemeRenderContext): string {
    const d = context.entity.data;
    const sections: string[] = [];

    // Frontmatter
    sections.push(frontmatter({
      title: d.name,
      type: "branch",
      tip: d.hash,
    }));

    sections.push(`# ${d.name}`);

    // Branch info
    const meta: string[] = [];
    const recentCommits = d.recentCommits as Array<{
      hash: string; shortHash: string; subject: string;
    }> | undefined;

    if (recentCommits?.[0]) {
      const tip = recentCommits[0];
      meta.push(`**Tip:** ${wikilink(commitFilePath(tip.shortHash, tip.subject), tip.shortHash)}`);
    }
    meta.push(`**Type:** ${d.isRemote ? "Remote" : "Local"}`);
    sections.push(callout("info", "Branch Info", meta.join("\n")));

    // Recent commits
    if (recentCommits?.length) {
      const lines = recentCommits.map((c) => {
        const link = wikilink(commitFilePath(c.shortHash, c.subject), c.shortHash);
        return `- ${link} ${c.subject}`;
      });
      sections.push("## Recent Commits\n\n" + lines.join("\n"));
    }

    return sections.join("\n\n");
  }

  private renderTag(context: ThemeRenderContext): string {
    const d = context.entity.data;
    const sections: string[] = [];

    // Frontmatter
    const fm: Record<string, unknown> = {
      title: d.name,
      type: "tag",
      target: d.targetShortHash,
    };
    if (d.annotated) fm.tagger = d.tagger;
    if (d.date) fm.date = d.date;
    sections.push(frontmatter(fm));

    sections.push(`# ${d.name}`);

    // Tag info
    const meta: string[] = [];
    const targetPath = commitFilePath(
      d.targetShortHash as string,
      d.targetSubject as string,
    );
    meta.push(`**Target:** ${wikilink(targetPath, d.targetShortHash as string)}`);
    meta.push(`**Type:** ${d.annotated ? "Annotated" : "Lightweight"}`);
    if (d.tagger) meta.push(`**Tagger:** ${d.tagger}`);
    if (d.date) meta.push(`**Date:** ${d.date}`);
    sections.push(callout("info", "Tag Info", meta.join("\n")));

    // Message
    if (d.subject) {
      sections.push(d.subject as string);
    }

    return sections.join("\n\n");
  }
}
