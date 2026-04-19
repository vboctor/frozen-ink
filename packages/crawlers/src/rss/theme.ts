import type { FolderConfig, Theme, ThemeRenderContext } from "@frozenink/core/theme";
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

function imgTagToMarkdown(tag: string): string {
  const src = tag.match(/src="([^"]*)"/i)?.[1] ?? "";
  const alt = tag.match(/alt="([^"]*)"/i)?.[1] ?? "";
  return src ? `\n\n![${alt}](${src})\n\n` : "";
}

/** Replace CDN image src URLs in HTML with local attachment paths where available. */
function substituteLocalAssets(html: string, assets: AssetRef[]): string {
  if (assets.length === 0) return html;
  const byFilename = new Map<string, string>();
  for (const asset of assets) {
    const name = (asset.filename ?? "").toLowerCase();
    byFilename.set(name, toMarkdownAttachmentRef(asset.storagePath));
    // Also index without common size prefixes (medium_, large_, thumb_, xlarge_)
    byFilename.set(name.replace(/^(medium|large|thumb|xlarge|orig)_/, ""), toMarkdownAttachmentRef(asset.storagePath));
  }
  return html.replace(/<img([^>]*)>/gi, (match, attrs: string) => {
    const srcMatch = attrs.match(/src="([^"]*)"/i);
    if (!srcMatch) return match;
    const urlFilename = srcMatch[1].split("/").pop()?.split("?")[0]?.toLowerCase() ?? "";
    const localPath = byFilename.get(urlFilename)
      ?? byFilename.get(urlFilename.replace(/^(medium|large|thumb|xlarge|orig)_/, ""));
    return localPath ? match.replace(srcMatch[0], `src="${localPath}"`) : match;
  });
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
    .replace(/<h[1-6][^>]*>/gi, "\n\n## ")
    .replace(/<img[^>]*\/?>/gi, imgTagToMarkdown);
  return decodeEntities(withStructure.replace(/<[^>]+>/g, ""))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
      typeof d.author === "string" ? `Author: ${d.author}` : undefined,
    ]);
    if (meta) sections.push(meta);

    const assets = ((d.assets as AssetRef[] | undefined) ?? []).filter(
      (a) => typeof a.storagePath === "string" && a.storagePath.startsWith("attachments/"),
    );
    const rawHtml = typeof d.contentHtml === "string" ? d.contentHtml.trim() : "";
    const body = rawHtml
      ? htmlToReadableMarkdown(substituteLocalAssets(rawHtml, assets))
      : (typeof d.contentText === "string" ? d.contentText.trim() : "");
    if (body) sections.push(body);

    // Append any assets not already present inline in the body
    for (const asset of assets) {
      const localRef = toMarkdownAttachmentRef(asset.storagePath);
      if (!body.includes(localRef)) {
        const alt = (asset.filename ?? "image").replace(/\.[^.]+$/, "");
        sections.push(`![${alt}](${localRef})`);
      }
    }

    return sections.join("\n\n");
  }

  renderHtml(context: ThemeRenderContext): string {
    const d = context.entity.data;
    const bodyHtml = typeof d.contentHtml === "string" && d.contentHtml.trim()
      ? stripUnsafeHtml(d.contentHtml)
      : `<p>${(typeof d.contentText === "string" ? d.contentText : "").replace(/</g, "&lt;")}</p>`;

    const publishedDate = typeof d.publishedAt === "string" ? d.publishedAt : null;
    const sourceUrl = context.entity.url;
    const linkIcon = sourceUrl
      ? ` <a href="${sourceUrl}" target="_blank" rel="noopener noreferrer" class="rss-source-link" title="Open source article">` +
        `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>` +
        `</a>`
      : "";
    const subline = joinIf([
      publishedDate ? `Published <time class="rss-date" data-iso="${publishedDate}">${publishedDate}</time>` : undefined,
      typeof d.author === "string" ? `By ${d.author}` : undefined,
    ]) + linkIcon;

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
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .rss-medium .rss-source-link {
          color: var(--text-secondary);
          opacity: 0.6;
          display: inline-flex;
          align-items: center;
        }
        .rss-medium .rss-source-link:hover {
          opacity: 1;
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
      </style>
      <article class="rss-medium">
        <h1>${context.entity.title}</h1>
        ${subline ? `<div class="subline">${subline}</div>` : ""}
        <div class="body">${bodyHtml}</div>
      </article>
    `;
  }

  getFilePath(context: ThemeRenderContext): string {
    const d = context.entity.data;
    const dt = dateParts((d.publishedAt as string | undefined) ?? (d.updatedAt as string | undefined));
    // Slugified filename keeps URLs clean (no spaces / unsafe chars). The
    // display title lives on the entity row, not in the path.
    const slug = slugify(context.entity.title) || slugify(context.entity.externalId) || "post";
    return `${dt.year}/${dt.stamp}-${slug}.md`;
  }

  folderConfigs(): Record<string, FolderConfig> {
    const configs: Record<string, FolderConfig> = {
      assets: { visible: false },
    };
    for (let year = 1970; year <= 2100; year++) {
      configs[String(year)] = { sort: "DESC", expanded: false, created_at_prefix: true };
    }
    return configs;
  }

  rootConfig(): FolderConfig {
    return { sort: "DESC", expandFirstN: 3 };
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
      "### Posts (`YYYY/`)",
      "Each file uses `YYYYMMDD <title>.md` naming for chronological scanning.",
      "Years are sorted newest to oldest; the most recent year is expanded by default.",
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
