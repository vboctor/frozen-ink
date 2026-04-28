import type { Theme, ThemeRenderContext } from "@frozenink/core/theme";
import { frontmatter } from "@frozenink/core/theme";
import { encodePathForMarkdown } from "./enml";

/** Tiny slug helper used to build per-notebook folders. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "note";
}


export class EvernoteTheme implements Theme {
  crawlerType = "evernote";

  render(context: ThemeRenderContext): string {
    const data = context.entity.data as Record<string, unknown>;
    const markdown = (data.markdown as string | undefined) ?? "";
    const created = data.created as number | undefined;
    const updated = data.updated as number | undefined;
    const notebookName = data.notebookName as string | undefined;
    const tags = (context.entity.tags ?? []) as string[];
    const allAttachments = (data.attachments as Array<{
      filename: string;
      mimeType: string;
      storagePath: string;
      inline?: boolean;
    }> | undefined) ?? [];
    // Inline attachments are already substituted into the body by the
    // crawler — show them only once. The trailing list is reserved for
    // orphans that the body didn't reference.
    const orphanAttachments = allAttachments.filter((a) => !a.inline);

    const fm = frontmatter({
      title: context.entity.title,
      ...(notebookName ? { notebook: notebookName } : {}),
      ...(created ? { created: new Date(created).toISOString() } : {}),
      ...(updated ? { updated: new Date(updated).toISOString() } : {}),
      ...(tags.length > 0 ? { tags } : {}),
      ...(context.entity.url ? { source: context.entity.url } : {}),
    });

    const heading = `# ${context.entity.title}\n`;

    // Notebook + tags as a structured metadata line above the body. Notebook
    // is shown by its display name (the `label` from Nodes_Notebook),
    // separated from the tag chips so the user sees which notebook the note
    // came from without it polluting the tag set.
    const metaParts: string[] = [];
    if (notebookName) metaParts.push(`📓 **Notebook:** ${notebookName}`);
    if (tags.length > 0) {
      metaParts.push(`🏷 ${tags.map((t) => `#${t.replace(/\s+/g, "_")}`).join(" ")}`);
    }
    const metaLine = metaParts.length > 0 ? `\n${metaParts.join(" &nbsp;·&nbsp; ")}\n` : "";

    // Inline attachments. Images render via standard markdown image syntax;
    // PDFs use the same `![label](path)` shape so the UI's `<img>` override
    // can detect the .pdf extension and swap in an `<embed>` for inline
    // viewing. Other file types degrade to a plain link. URLs are
    // percent-encoded segment-by-segment because Evernote filenames often
    // contain spaces — markdown parsers stop at the first whitespace inside
    // `(...)`, breaking the link entirely.
    const attachmentBlock = orphanAttachments.length > 0
      ? `\n## Attachments\n\n${orphanAttachments
          .map((a) => {
            const url = encodePathForMarkdown(a.storagePath);
            const isImage = a.mimeType.startsWith("image/");
            const isPdf = a.mimeType === "application/pdf" || /\.pdf$/i.test(a.filename);
            if (isImage || isPdf) return `![${a.filename}](${url})`;
            return `[${a.filename}](${url})`;
          })
          .join("\n\n")}\n`
      : "";

    // Defensive cleanup of stale rendered markdown: older sync runs emitted
    // PDF references as plain markdown links `[file.pdf](url)` instead of
    // image-syntax `![file.pdf](url)`, so the UI's `<img>` override never
    // fired and PDFs showed as a clickable filename instead of an inline
    // embed. Rewrite link-shaped PDF refs at render time so the fix takes
    // effect without needing a `--full` re-sync of every entity. Also
    // re-encode any unescaped spaces in the URL since pre-fix runs left
    // those raw too.
    const cleanedBody = repairStaleAttachmentLinks(markdown);
    const body = cleanedBody.trim() ? cleanedBody : "_(no body — Evernote v10 stores note bodies in a binary format that this crawler cannot decode yet)_";
    return `${fm}\n${heading}${metaLine}\n${body}\n${attachmentBlock}`;
  }

  labelFilesWithTitle() {
    return true;
  }

  folderConfigs() {
    return {
      // `notes/` sorts its notebook subfolders DESC by name. Each notebook
      // subfolder inherits `sort: DESC` via subdirConfig so files inside
      // sort newest-first by their `sortKey` (set by the crawler to the
      // note's last-updated timestamp).
      notes: {
        sort: "DESC" as const,
        subdirConfig: { sort: "DESC" as const },
      },
    };
  }

  agentsMarkdown(options: { title: string; description?: string }): string {
    const { title, description } = options;
    return [
      `# ${title}`,
      "",
      description ?? "Notes imported from a local Evernote v10 database.",
      "",
      "## Content",
      "",
      "- `notes/` — one markdown file per note, organised by notebook.",
      "- Attachments live alongside notes and are searchable via OCR text indexed in the FTS `attachment_text` column.",
      "",
    ].join("\n");
  }

  getFilePath(context: ThemeRenderContext): string {
    const data = context.entity.data as Record<string, unknown>;
    const notebookName = (data.notebookName as string | undefined) ?? "default";
    const slug = slugify(context.entity.title);
    const id = context.entity.externalId.slice(0, 8);
    return `notes/${slugify(notebookName)}/${slug}-${id}.md`;
  }
}

/**
 * Heal markdown produced by older sync runs that:
 *   1. Emitted PDF references as `[file.pdf](url)` (link syntax) instead of
 *      `![file.pdf](url)` (image syntax). Without the leading `!`, the UI's
 *      `<img>` override doesn't fire and the PDF shows as a clickable
 *      filename rather than an inline `<object>` embed.
 *   2. Left unescaped spaces in the URL — markdown link parsing stops at
 *      the first whitespace inside `(...)`, breaking the entire link.
 *
 * Both of those are emitted correctly by the current crawler, but stored
 * markdown from previous sync runs persists in `data.markdown` until the
 * note is re-rendered. Repairing at theme-render time makes the fix take
 * effect immediately for every existing note.
 */
function repairStaleAttachmentLinks(md: string): string {
  if (!md) return md;
  // Match plain-link refs into the attachments tree pointing at PDFs (or
  // images) where the URL might have unescaped whitespace or markdown-
  // special chars. We only touch links that target `attachments/...` so
  // user-authored external links are untouched.
  return md.replace(
    /(!?)\[([^\]]+)\]\(((?:\.\.\/)*attachments\/[^)]+?\.(?:pdf|png|jpe?g|gif|webp|bmp|svg))\)/gi,
    (_match, _bang: string, alt: string, url: string) => {
      // Re-encode segment-by-segment so spaces and `*`/`(`/`)` (which break
      // markdown link parsing) get percent-escaped properly.
      const segments = url.split("/").map((seg) => {
        try {
          return decodeURIComponent(seg);
        } catch {
          return seg;
        }
      });
      const cleanUrl = encodePathForMarkdown(segments.join("/"));
      // Force image syntax so the UI's `<img>` override picks the file up.
      return `![${alt}](${cleanUrl})`;
    },
  );
}
