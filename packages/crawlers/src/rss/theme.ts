import type { Theme, ThemeRenderContext } from "@frozenink/core/theme";
import { frontmatter } from "@frozenink/core/theme";

interface AssetRef {
  storagePath: string;
  filename?: string;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function safeFilenameTitle(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dateParts(value: string | undefined): { year: string; stamp: string } {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) {
    return { year: "undated", stamp: "00000000" };
  }
  const year = String(d.getUTCFullYear());
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return { year, stamp: `${year}${month}${day}` };
}

function stripUnsafeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function htmlToReadableMarkdown(html: string): string {
  const sanitized = stripUnsafeHtml(html);
  const withStructure = sanitized
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p[^>]*>/gi, "\n\n")
    .replace(/<p[^>]*>/gi, "")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/li>/gi, "")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<h[1-6][^>]*>/gi, "\n\n## ");
  return decodeEntities(withStructure.replace(/<[^>]+>/g, ""))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function toAttachmentApiUrl(collectionName: string, storagePath: string): string {
  const filePath = storagePath.replace(/^attachments\//, "");
  return `/api/attachments/${encodeURIComponent(collectionName)}/${filePath}`;
}

function toMarkdownAttachmentRef(storagePath: string): string {
  return storagePath.replace(/^attachments\//, "../../attachments/");
}

function joinIf(values: Array<string | undefined>): string {
  return values.filter((v): v is string => !!v && v.trim().length > 0).join(" · ");
}

export class RssTheme implements Theme {
  crawlerType = "rss";

  render(context: ThemeRenderContext): string {
    const d = context.entity.data;
    const tags = (context.entity.tags ?? []).filter(Boolean);
    const fm: Record<string, unknown> = {
      title: context.entity.title,
      type: "rss_post",
      link: context.entity.url,
      published: d.publishedAt,
      updated: d.updatedAt,
      author: d.author,
      tags,
    };

    const sections: string[] = [];
    sections.push(frontmatter(fm));
    sections.push(`# ${context.entity.title}`);

    const meta = joinIf([
      typeof d.publishedAt === "string" ? `Published: ${d.publishedAt}` : undefined,
      typeof d.updatedAt === "string" ? `Updated: ${d.updatedAt}` : undefined,
      typeof d.author === "string" ? `Author: ${d.author}` : undefined,
    ]);
    if (meta) sections.push(meta);

    const body = typeof d.contentHtml === "string" && d.contentHtml.trim()
      ? htmlToReadableMarkdown(d.contentHtml)
      : (typeof d.contentText === "string" ? d.contentText.trim() : "");
    if (body) sections.push(body);

    const assets = ((d.assets as AssetRef[] | undefined) ?? []).filter(
      (a) => typeof a.storagePath === "string" && a.storagePath.startsWith("attachments/"),
    );
    if (assets.length > 0) {
      sections.push("## Images");
      for (const asset of assets) {
        const alt = (asset.filename || "image").replace(/\.[^.]+$/, "");
        sections.push(`![${alt}](${toMarkdownAttachmentRef(asset.storagePath)})`);
      }
    }

    return sections.join("\n\n");
  }

  renderHtml(context: ThemeRenderContext): string {
    const d = context.entity.data;
    const bodyHtml = typeof d.contentHtml === "string" && d.contentHtml.trim()
      ? stripUnsafeHtml(d.contentHtml)
      : `<p>${(typeof d.contentText === "string" ? d.contentText : "").replace(/</g, "&lt;")}</p>`;

    const assets = ((d.assets as AssetRef[] | undefined) ?? []).filter(
      (a) => typeof a.storagePath === "string" && a.storagePath.startsWith("attachments/"),
    );
    const gallery = assets.length === 0
      ? ""
      : `
        <div class="rss-medium-gallery">
          ${assets
            .map((a) => {
              const alt = (a.filename || "image").replace(/\.[^.]+$/, "");
              const src = toAttachmentApiUrl(context.collectionName, a.storagePath);
              return `<figure><img src="${src}" alt="${alt}" /><figcaption>${alt}</figcaption></figure>`;
            })
            .join("")}
        </div>
      `;

    const subline = joinIf([
      typeof d.publishedAt === "string" ? `Published ${d.publishedAt}` : undefined,
      typeof d.author === "string" ? `By ${d.author}` : undefined,
    ]);

    return `
      <style>
        .rss-medium {
          max-width: 760px;
          margin: 0 auto;
          padding: 24px 8px 48px;
          color: var(--text);
        }
        .rss-medium h1 {
          font-size: 2.3rem;
          line-height: 1.2;
          margin: 0 0 8px;
          letter-spacing: -0.01em;
          font-family: Georgia, "Times New Roman", serif;
        }
        .rss-medium .subline {
          color: var(--text-secondary);
          margin: 0 0 26px;
          font-size: 0.95rem;
        }
        .rss-medium .body {
          font-family: Georgia, "Times New Roman", serif;
          font-size: 1.18rem;
          line-height: 1.9;
        }
        .rss-medium .body p { margin: 0 0 1.2em; }
        .rss-medium .body h2, .rss-medium .body h3, .rss-medium .body h4 {
          margin: 1.6em 0 0.6em;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
          line-height: 1.35;
        }
        .rss-medium .body img {
          display: block;
          max-width: 100%;
          margin: 1.2em auto;
          border-radius: 6px;
        }
        .rss-medium-gallery {
          margin-top: 2.5rem;
          display: grid;
          gap: 1.4rem;
        }
        .rss-medium-gallery figure { margin: 0; }
        .rss-medium-gallery figcaption {
          margin-top: 0.45rem;
          color: var(--text-secondary);
          font-size: 0.9rem;
        }
      </style>
      <article class="rss-medium">
        <h1>${context.entity.title}</h1>
        ${subline ? `<div class="subline">${subline}</div>` : ""}
        <div class="body">${bodyHtml}</div>
        ${gallery}
      </article>
    `;
  }

  getFilePath(context: ThemeRenderContext): string {
    const d = context.entity.data;
    const dt = dateParts((d.publishedAt as string | undefined) ?? (d.updatedAt as string | undefined));
    const title = safeFilenameTitle(context.entity.title) || slugify(context.entity.externalId) || "post";
    return `posts/${dt.year}/${dt.stamp} ${title}.md`;
  }

  folderConfigs() {
    const configs: Record<string, { sort?: "ASC" | "DESC"; visible?: boolean }> = {
      posts: { sort: "DESC" },
      assets: { visible: false },
    };
    for (let year = 1970; year <= 2100; year++) {
      configs[String(year)] = { sort: "DESC" };
    }
    return configs;
  }

  agentsMarkdown(options: { title: string; description?: string }): string {
    const desc = options.description || "This collection contains posts synced from RSS/Atom feeds.";
    return [
      `# ${options.title}`,
      "",
      desc,
      "",
      "## Entity Types",
      "",
      "### Posts (`posts/YYYY/`)",
      "Each file uses `YYYYMMDD <title>.md` naming for chronological scanning.",
      "",
      "### Images (`attachments/rss/YYYY/`)",
      "Downloaded image assets referenced by feed posts.",
      "",
    ].join("\n");
  }

  getTitle(context: ThemeRenderContext): string | undefined {
    const title = context.entity.data.title;
    if (typeof title === "string" && title.trim()) return title;
    return context.entity.title;
  }
}
