import type { Theme, ThemeRenderContext } from "@veecontext/core";
import { frontmatter, wikilink } from "@veecontext/core";

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

function tableRow(label: string, value: string): string {
  return `| **${label}** | ${value} |`;
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
    return this.renderIssue(context);
  }

  getFilePath(context: ThemeRenderContext): string {
    const d = context.entity.data;
    const id = d.id as number;
    const summary = d.summary as string;
    const slug = slugify(summary);
    return slug
      ? `issues/${padId(id)}-${slug}.md`
      : `issues/${padId(id)}.md`;
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

    // Title: "00042 Issue summary"
    sections.push(`# ${padId(d.id as number)} ${d.summary}`);

    // Details table
    const rows: string[] = [
      "| | |",
      "|---|---|",
      tableRow("Status", status.label),
      tableRow("Resolution", resolution.label),
      tableRow("Priority", priority.label),
      tableRow("Severity", severity.label),
    ];
    if (project) rows.push(tableRow("Project", project.name));
    if (category) rows.push(tableRow("Category", category.name));
    if (reporter) rows.push(tableRow("Reporter", reporter.name));
    if (handler) rows.push(tableRow("Assigned To", handler.name));
    if (reproducibility) rows.push(tableRow("Reproducibility", reproducibility.label));
    rows.push(tableRow("Created", formatDate(d.createdAt as string)));
    rows.push(tableRow("Updated", formatDate(d.updatedAt as string)));
    if (context.entity.url) rows.push(tableRow("URL", context.entity.url));
    sections.push(rows.join("\n"));

    // Issue-level attachments
    const files = d.files as Array<{ filename: string; storagePath?: string }>;
    if (files?.length) {
      const embeds = files
        .filter((f) => f.storagePath)
        .map((f) => `![[${f.storagePath!.replace(/^attachments\//, "")}]]`);
      if (embeds.length) {
        sections.push("## Attachments\n\n" + embeds.join("\n\n"));
      }
    }

    // Description
    if (d.description) {
      sections.push(
        "## Description\n\n" +
          linkifyIssueRefs(d.description as string, lookup),
      );
    }

    // Steps to Reproduce
    if (d.stepsToReproduce) {
      sections.push(
        "## Steps to Reproduce\n\n" +
          linkifyIssueRefs(d.stepsToReproduce as string, lookup),
      );
    }

    // Additional Information
    if (d.additionalInformation) {
      sections.push(
        "## Additional Information\n\n" +
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
      sections.push("## Relationships\n\n" + relLines.join("\n"));
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
      sections.push("## Notes\n\n" + noteBlocks.join("\n\n---\n\n"));
    }

    return sections.join("\n\n");
  }
}
