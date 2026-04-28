/**
 * Convert ENML (Evernote's XHTML-ish note format) into Markdown.
 *
 * ENML wraps note content in `<en-note>…</en-note>` and uses three custom
 * elements:
 *   <en-media hash="..." type="image/png"/>     — embedded resources
 *   <en-todo checked="true|false"/>             — checklist items
 *   <en-crypt>...</en-crypt>                    — encrypted blocks
 *
 * Beyond those, ENML is roughly a subset of XHTML. We do a single-pass
 * tag-aware transform without pulling in a full HTML parser, which keeps
 * the conversion deterministic and trivially testable. For unknown tags we
 * strip the markup but keep the inner text.
 */

export interface EnmlConvertOptions {
  /**
   * Map from resource hash → asset path used in the rendered markdown.
   * Used to convert `<en-media hash="abc">` into `![](attachments/.../foo.png)`
   * or `[foo.pdf](attachments/.../foo.pdf)` depending on MIME type.
   */
  resourceByHash: Record<
    string,
    { filename: string; mimeType: string; assetPath: string }
  >;
}

export function enmlToMarkdown(enml: string, opts: EnmlConvertOptions): string {
  // 1. Strip XML/DOCTYPE preamble and <en-note> wrapper.
  let body = enml.replace(/<\?xml[\s\S]*?\?>/g, "");
  body = body.replace(/<!DOCTYPE[\s\S]*?>/g, "");
  body = body.replace(/<en-note[^>]*>/i, "").replace(/<\/en-note>/i, "");

  // 2. <en-crypt> — emit a placeholder; we cannot decrypt without the password.
  body = body.replace(
    /<en-crypt[\s\S]*?<\/en-crypt>/gi,
    "*[encrypted content]*",
  );

  // 3. <en-todo> — render as a GFM checkbox.
  body = body.replace(
    /<en-todo([^>]*)\/?>(?:<\/en-todo>)?/gi,
    (_match, attrs: string) => {
      const checked = /checked\s*=\s*["']true["']/i.test(attrs);
      return checked ? "- [x] " : "- [ ] ";
    },
  );

  // 4. <en-media> — replace with an inline reference. Images and PDFs use
  // the `![label](url)` image syntax so the UI's `<img>` override can pick
  // them up: PDFs become an inline `<object>` viewer; everything else
  // renders as a normal `<img>`. URLs are percent-encoded segment-by-
  // segment because Evernote filenames frequently contain spaces, which
  // would otherwise break markdown link parsing.
  body = body.replace(/<en-media([^>]*)\/?>(?:<\/en-media>)?/gi, (_m, attrs: string) => {
    const hash = matchAttr(attrs, "hash");
    const declaredMime = matchAttr(attrs, "type") ?? "";
    if (!hash) return "";
    const res = opts.resourceByHash[hash];
    if (!res) return "";
    const url = encodePathForMarkdown(res.assetPath);
    const mime = res.mimeType || declaredMime;
    const isImage = mime.startsWith("image/");
    const isPdf = mime === "application/pdf" || /\.pdf$/i.test(res.filename);
    if (isImage || isPdf) {
      // Surround with blank lines so the embed/img isn't rendered inside an
      // inline paragraph (which suppresses block-level styling like the
      // full-width PDF viewer).
      return `\n\n![${res.filename}](${url})\n\n`;
    }
    return `[${res.filename}](${url})`;
  });

  // 5. Block-level constructs. Order matters: process tables/lists/headings
  //    before the generic tag stripper.
  body = body.replace(/<br\s*\/?>(?!\n)/gi, "\n");
  body = body.replace(/<p[^>]*>/gi, "").replace(/<\/p>/gi, "\n\n");
  // <div> is the default block wrapper Evernote v10 uses for paragraphs.
  // Treat the opening tag as a hint to start a block and the closing tag
  // as a paragraph break so adjacent <div>...<en-media>...<div> chains
  // don't run together on a single line.
  body = body.replace(/<div[^>]*>/gi, "\n").replace(/<\/div>/gi, "\n");

  for (let level = 6; level >= 1; level--) {
    const re = new RegExp(`<h${level}[^>]*>([\\s\\S]*?)<\\/h${level}>`, "gi");
    const hashes = "#".repeat(level);
    body = body.replace(re, (_m, inner: string) => `\n\n${hashes} ${stripTags(inner).trim()}\n\n`);
  }

  body = body.replace(/<strong>([\s\S]*?)<\/strong>/gi, "**$1**");
  body = body.replace(/<b>([\s\S]*?)<\/b>/gi, "**$1**");
  body = body.replace(/<em>([\s\S]*?)<\/em>/gi, "*$1*");
  body = body.replace(/<i>([\s\S]*?)<\/i>/gi, "*$1*");
  body = body.replace(/<code>([\s\S]*?)<\/code>/gi, "`$1`");
  body = body.replace(/<a([^>]*)>([\s\S]*?)<\/a>/gi, (_m, attrs: string, inner: string) => {
    const href = matchAttr(attrs, "href");
    const label = stripTags(inner).trim();
    if (!href) return label;
    return `[${label || href}](${href})`;
  });

  // Lists — ENML uses standard <ul>/<ol>/<li>.
  body = body.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, inner: string) => {
    return `- ${stripTags(inner).trim()}\n`;
  });
  body = body.replace(/<\/?(?:ul|ol)[^>]*>/gi, "\n");

  // Tables — collapse rows to pipe-delimited markdown rows; not perfect but
  // searchable.
  body = body.replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, (_m, inner: string) => {
    const cells = Array.from(inner.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)).map(
      (c) => stripTags(c[1]).trim(),
    );
    if (cells.length === 0) return "";
    return `| ${cells.join(" | ")} |\n`;
  });
  body = body.replace(/<\/?(?:table|thead|tbody|tfoot)[^>]*>/gi, "");

  // 6. Strip remaining tags but keep their text content.
  body = stripTags(body);

  // 7. Decode core HTML entities.
  body = decodeEntities(body);

  // 8. Collapse runs of blank lines.
  body = body.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return body + (body.endsWith("\n") ? "" : "\n");
}

function matchAttr(attrs: string, name: string): string | undefined {
  const m = attrs.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i"));
  return m ? m[1] : undefined;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)));
}

/**
 * Parse the OCR `<recoIndex>` blob Evernote stores for an image resource.
 * The XML looks like
 *   <recoIndex …><item …><t w="80">Hello</t><t w="60">World</t></item>…</recoIndex>
 * We pick the highest-confidence token (`w` weight) per `<item>` and
 * concatenate. Returns an empty string if the blob is empty or unparseable.
 */
export function parseEvernoteRecognitionXml(xml: string): string {
  if (!xml || !xml.includes("<t")) return "";
  const tokens: string[] = [];
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let item: RegExpExecArray | null;
  while ((item = itemRegex.exec(xml)) !== null) {
    const inner = item[1];
    let best = { weight: -1, text: "" };
    const tRegex = /<t(?:\s+w=["'](\d+)["'])?[^>]*>([\s\S]*?)<\/t>/gi;
    let t: RegExpExecArray | null;
    while ((t = tRegex.exec(inner)) !== null) {
      const weight = t[1] ? Number(t[1]) : 0;
      const text = decodeEntities(t[2]).trim();
      if (text && weight > best.weight) best = { weight, text };
    }
    if (best.text) tokens.push(best.text);
  }
  return tokens.join(" ");
}

/**
 * Percent-encode a path segment-by-segment for use inside a markdown
 * `[label](url)` or `![label](url)` link. `encodeURIComponent` leaves a few
 * unreserved characters alone (`!*'()`) — three of those (`*`, `(`, `)`)
 * are markdown special characters that wreck link parsing when they
 * appear in the URL portion. Encode them too so filenames like
 * `11292025_*000779*…` don't get mis-parsed as italic markers mid-URL.
 */
export function encodePathForMarkdown(path: string): string {
  return path
    .split("/")
    .map((seg) => encodeURIComponent(seg).replace(
      /[!*'()]/g,
      (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
    ))
    .join("/");
}
