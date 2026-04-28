/**
 * Decoder for Evernote v10's binary RTE (`*.dat`) files.
 *
 * v10 stores note bodies under
 * `<app-support>/conduit-fs/.../rte/Note/internal_rteDoc/<aaa>/<bbb>/<noteGuid>.dat`
 * as Yjs CRDT updates. The document is a Y.Doc with shared types named
 * `content` (Y.XmlFragment with the ENML tree), `title` (Y.Text),
 * `customNoteStyles` / `meta` / `resources` (Y.Map metadata). Decoding via
 * the `yjs` library reconstructs the full XML tree in document order, so
 * the body comes back as proper ENML — text, `<en-media>` references,
 * checklists, and tables all in their original positions.
 *
 * A best-effort byte-walking fallback (`extractRte`) is kept for cases
 * where Yjs decoding fails (corrupted file, unknown variant, etc.).
 */
import * as Y from "yjs";

const MIN_STRING_LEN = 2;
const MAX_STRING_LEN = 4096;

/** Document-structure keys, tag names, and CSS-style values that are not body content. */
const STRUCTURAL_TOKENS = new Set([
  "content", "en-note", "en-media", "en-todo", "en-crypt", "en-codeblock",
  "div", "span", "p", "br", "hr", "ul", "ol", "li", "table", "tr", "td", "th",
  "tbody", "thead", "tfoot", "h1", "h2", "h3", "h4", "h5", "h6",
  "strong", "b", "em", "i", "u", "s", "code", "a", "img",
  "hash", "type", "style", "title", "alt", "src", "href", "width", "height",
  "meta", "resources", "customNoteStyles", "headingStyles",
  "taskGroupOrder", "calendarEventIds", "lastENMLNormalizationVersion",
  "schemaVersion", "taskIdClocksMap",
  "checked", "true", "false",
  // Common style-attribute *values* the Yjs document carries inline. Each of
  // these surfaces as its own length-prefixed string in the binary stream
  // and would otherwise leak into the body as e.g.
  // "isEmpty fontFamilyw inherit colorw 0 fontStylew".
  "isEmpty", "inherit", "initial", "unset", "normal", "auto", "none",
  "default", "bold", "italic", "underline", "transparent", "left", "right",
  "center", "justify",
  // Common field names — also enumerated in KNOWN_FIELD_PREFIXES below for
  // the prefix-stripping pass. Listing them here as well makes
  // startsWithStructuralKey pick up `colorw`, `paddingw`, etc. — field
  // names with a leaked single-char length byte glued to the end.
  "color", "background", "padding", "margin", "border",
  "fontFamily", "fontSize", "fontWeight", "fontStyle", "textDecoration",
  "image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml",
  "application/pdf", "application/octet-stream",
]);

/**
 * Walk the buffer and pull out every plausible string. Strings are runs of
 * printable ASCII bytes (0x20–0x7E plus tab/LF/CR); high bytes (>= 0x80)
 * are treated as separators because Yjs uses them for varint length
 * continuations and CRDT identifiers — not as UTF-8 multi-byte content
 * (real Evernote notes are overwhelmingly ASCII; the few notes with true
 * non-ASCII characters lose those characters but stay searchable in the
 * surrounding ASCII).
 */
function* extractStrings(buf: Buffer): Generator<string> {
  let i = 0;
  while (i < buf.length) {
    while (i < buf.length && !isPrintableAscii(buf[i])) i++;
    const start = i;
    while (i < buf.length && isPrintableAscii(buf[i])) i++;
    if (i - start < MIN_STRING_LEN) continue;
    const len = Math.min(i - start, MAX_STRING_LEN);
    yield buf.subarray(start, start + len).toString("ascii");
  }
}

function isPrintableAscii(b: number): boolean {
  if (b === 0x09 || b === 0x0a || b === 0x0d) return true;
  return b >= 0x20 && b <= 0x7e;
}

/**
 * True when a string looks like a content-addressable hash. We accept 16+
 * hex chars because varint length bytes often chop a leading character off
 * a 32-byte hash, leaving 30/31-char fragments. Body text rarely contains
 * hex runs that long without intervening spaces or vowels.
 */
function isHashLike(s: string): boolean {
  const trimmed = s.replace(/^[^a-f0-9]+|[^a-f0-9]+$/gi, "");
  return /^[a-f0-9]{16,}$/i.test(trimmed);
}

/**
 * True when the string starts with a known structural key, even if extra
 * characters are concatenated to the end (e.g. `customNoteStylesheadingStyles`,
 * which Yjs sometimes emits as a single run).
 */
function startsWithStructuralKey(s: string): boolean {
  for (const k of STRUCTURAL_TOKENS) {
    if (!s.startsWith(k)) continue;
    if (s.length === k.length) return true;
    const next = s[k.length];
    if (next === next.toUpperCase() && /[A-Z]/.test(next)) return true; // CamelCase concat
    if (/[\W]/.test(next)) return true;
    // Field name + single trailing character — almost always a length byte
    // (e.g. `colorw`, `paddingw`, `titleq`). Real body text doesn't end
    // mid-field-name plus one stray letter.
    if (s.length === k.length + 1) return true;
  }
  return false;
}

/** True when a string is obviously a CSS style declaration block, not body text. */
function isStyleLike(s: string): boolean {
  if (s.includes("--en-")) return true;
  if (s.startsWith("--")) return true;
  // Anything starting with a CSS property declaration (`display:none;…`,
  // `font-family:foo;`). The block can carry a `--en-chs:"<base64>"` payload
  // afterwards, which the original regex missed because it required the
  // *entire* string to be CSS-shaped.
  if (/^[a-z-]+\s*:\s*[^;]+;/i.test(s)) return true;
  return /^(?:[a-z-]+\s*:\s*[^;]+;\s*)+$/i.test(s);
}

/**
 * True when the string contains a long unbroken alphanumeric/base64 run
 * (60+ chars). Evernote serialises per-heading style configs as
 * `--en-chs:"<base64-encoded JSON>"` and the base64 payload is several
 * hundred characters of pure noise from the user's perspective.
 */
function containsLongOpaqueRun(s: string): boolean {
  return /[A-Za-z0-9+/=]{60,}/.test(s);
}

/**
 * Field-name prefixes that the binary stream often pastes onto the front
 * of the field's value when the length byte happens to be printable ASCII.
 * `title<2><body>` becomes `title2<body>` once decoded as plain text.
 * Strip the prefix so the actual value reads cleanly.
 */
const KNOWN_FIELD_PREFIXES = [
  "title", "color", "alt", "src", "href", "type", "hash", "width", "height",
  "fontFamily", "fontSize", "fontWeight", "fontStyle", "textDecoration",
  "background", "padding", "margin", "border",
];

/**
 * Strings that contain a known field-name as a *suffix* are usually the
 * remnant of two concatenated fields; trim everything from the field-name
 * onward. e.g. `Reclamation District Bill colorw 0 fontStylew` becomes
 * `Reclamation District Bill`.
 */
function stripTrailingFieldRun(s: string): string {
  const re = new RegExp(
    `\\s+(?:${KNOWN_FIELD_PREFIXES.join("|")})[a-zA-Z]?\\b.*$`,
  );
  return s.replace(re, "");
}

/**
 * True when a string is a single camelCase identifier (no whitespace, no
 * punctuation) — overwhelmingly a Yjs/CRDT field name like `fontFamily`,
 * `textDecoration`, `fontWeightw` (with a leaked length byte). Real body
 * text contains spaces, sentences, or punctuation; legitimate single
 * identifiers in note bodies are rare enough to accept the trade-off.
 */
function isCamelCaseIdentifier(s: string): boolean {
  if (s.length > 40) return false;
  return /^[a-z][a-z0-9]*[A-Z][a-zA-Z0-9]*$/.test(s);
}

/**
 * Yjs frequently emits short noise tokens like `w 5e47…` (a 1-char field
 * key followed by a hex resource id) immediately before each en-media
 * reference. Strip those — they're never user-authored content.
 */
function isResourceRefLike(s: string): boolean {
  return /^[a-z][\s\W]+[a-f0-9]{16,}\b/i.test(s);
}

/**
 * Some short fragments are pure protocol noise: a single ASCII byte plus
 * a separator, two-letter tags, etc. Drop them.
 */
function isLikelyNoise(s: string): boolean {
  if (s.length <= 2) return true;
  // Standalone CSS-ish leftovers like ");" or "}; "
  if (/^[\s\W]+$/.test(s)) return true;
  // CSS dimension values — `25px`, `16em`, `100%`, `2rem`, etc. show up as
  // their own length-prefixed entries when style attributes get serialised.
  if (/^\d+(\.\d+)?(px|em|rem|pt|pc|%|vh|vw|deg)$/i.test(s)) return true;
  // High punctuation density usually means a binary stub leaked through.
  const wordChars = (s.match(/[a-zA-Z]/g) ?? []).length;
  if (wordChars < 2) return true;
  if (wordChars / s.length < 0.3) return true;
  return false;
}

/**
 * Strip a single leading "key character" followed by whitespace, e.g.
 * `w foo` → `foo`, `( bar` → `bar`. Yjs leaves these markers in front of
 * many strings; trimming them keeps the body clean.
 */
function trimLeadingNoise(s: string): string {
  let out = s;
  // Strip a known field-name + length-byte prefix when the value is glued
  // onto the field key (e.g. `title220260331 230 Lake…` →
  // `20260331 230 Lake…`). Length bytes that are printable ASCII letters
  // get absorbed too — match up to two trailing characters between the
  // field name and the value.
  // Length bytes are exactly one byte; when they fall in the printable
  // range they get pasted onto the field name as a single character.
  // Match at most one trailing char so we don't eat into the actual value.
  const fieldPrefixRe = new RegExp(`^(?:${KNOWN_FIELD_PREFIXES.join("|")})[a-zA-Z0-9]?(?=[A-Z0-9"'])`);
  out = out.replace(fieldPrefixRe, "");
  // Strip a single ASCII byte (letter, digit, or symbol) followed by space
  // — Yjs leaves a 1-char field key in front of many strings.
  out = out.replace(/^[A-Za-z0-9\W]\s+/, "");
  // Strip leading single non-letter, non-digit, non-quote bytes that
  // aren't separated by whitespace (e.g. "(hello"). Digits are preserved
  // here so legitimate leading dates like `20260331 …` survive — `0--en-…`
  // junk is caught later by isStyleLike's `--en-` includes check.
  while (/^[^a-zA-Z0-9"'\s]\S/.test(out)) out = out.slice(1);
  // Strip trailing field-separator bytes like `(`, `'`, `"`.
  out = out.replace(/[\s(){}\[\]'"`]+$/, "");
  // Strip a single trailing uppercase letter that immediately follows a
  // lowercase letter (e.g. `Bulk Create IssuesG`). That's almost always
  // the next field's length-byte leaking — real English text doesn't end
  // mid-camelcase. Repeat to handle `…PageGn` style two-byte tails.
  while (/[a-z][A-Z]$/.test(out)) out = out.slice(0, -1);
  // Cut off concatenated trailing field runs.
  out = stripTrailingFieldRun(out);
  return out.trim();
}

/** Placeholder emitted in the body where an en-media reference appears. */
export const ATTACHMENT_PLACEHOLDER_PREFIX = "[[EVERNOTE_ATTACHMENT:";
export const ATTACHMENT_PLACEHOLDER_SUFFIX = "]]";

export interface YjsDecodeResult {
  /** Raw ENML reconstructed from the Yjs document, in original order. */
  enml: string;
  /** Hashes of every `<en-media>` reference inside the body, in order. */
  attachmentHashes: string[];
  /** Title stored on the document (separate Y.Text shared type). */
  title?: string;
}

/**
 * Decode the binary RTE blob via the Yjs library. Returns full ENML in
 * the document's original order, which `enmlToMarkdown` can then convert
 * to clean markdown. Returns null on any decode error so callers can fall
 * back to the byte-walking extractor.
 */
export function decodeRteBlob(buf: Buffer): YjsDecodeResult | null {
  let doc: Y.Doc;
  try {
    doc = new Y.Doc();
    Y.applyUpdate(doc, new Uint8Array(buf));
  } catch {
    return null;
  }

  let enml: string;
  try {
    enml = doc.getXmlFragment("content").toString();
  } catch {
    return null;
  }
  if (!enml || !enml.includes("<en-note")) return null;

  // Walk for ordered en-media hashes — useful so the crawler knows which
  // attachments were referenced inline (vs. orphans to dump at the end).
  const attachmentHashes: string[] = [];
  const seen = new Set<string>();
  const re = /<en-media[^>]*\bhash\s*=\s*"([a-f0-9]{16,})"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(enml)) !== null) {
    const hash = m[1].toLowerCase();
    if (!seen.has(hash)) {
      seen.add(hash);
      attachmentHashes.push(hash);
    }
  }

  let title: string | undefined;
  try {
    const t = doc.getText("title").toString();
    if (t) title = t;
  } catch {
    // optional
  }

  return { enml, attachmentHashes, title };
}

export interface RteExtractResult {
  /**
   * Recovered body text. May contain inline placeholders of the form
   * `[[EVERNOTE_ATTACHMENT:<hash>]]` at the positions where an `en-media`
   * marker appeared in the binary stream — callers substitute these for
   * the matching attachment ref so images/PDFs render at their original
   * location instead of being grouped at the bottom of the note.
   */
  text: string;
  /** Distinct attachment hashes encountered in the binary, in order. */
  attachmentHashes: string[];
}

/**
 * Extract a plain-text body plus a list of inline attachment hashes from a
 * note's `.dat` file. Returns an empty result for empty or unrecognised
 * files.
 *
 * Ordering: en-media blocks live at the top of the binary in the document's
 * structural metadata, while the body text appears later. The CRDT tree
 * that defines where each attachment renders within the body isn't
 * decoded — we don't have a Yjs parser. The pragmatic compromise is to
 * emit body text first, then append attachment placeholders. This matches
 * the common Evernote pattern of "short note body + attached document(s)
 * below" and renders the way the user's screenshots show: Evernote-style
 * note opens with text, PDFs follow.
 */
export function extractRte(buf: Buffer): RteExtractResult {
  const bodyParts: string[] = [];
  const seenText = new Set<string>();
  const attachmentHashes: string[] = [];
  const seenAttachment = new Set<string>();

  const stringList = [...extractStrings(buf)];

  for (let i = 0; i < stringList.length; i++) {
    const raw = stringList[i];
    const trimmed = raw.trim();

    // en-media boundary: scan ahead for the resource hash that follows.
    if (trimmed === "en-media" || /^en-media\b/.test(trimmed)) {
      const hash = findHashNear(stringList, i + 1);
      if (hash && !seenAttachment.has(hash)) {
        seenAttachment.add(hash);
        attachmentHashes.push(hash);
      }
      continue;
    }

    const s = trimLeadingNoise(trimmed);
    if (s.length < MIN_STRING_LEN) continue;
    if (STRUCTURAL_TOKENS.has(s)) continue;
    if (startsWithStructuralKey(s)) continue;
    if (isHashLike(s)) continue;
    if (isStyleLike(s)) continue;
    if (containsLongOpaqueRun(s)) continue;
    if (isResourceRefLike(s)) continue;
    if (isCamelCaseIdentifier(s)) continue;
    if (isLikelyNoise(s)) continue;
    if (/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(s)) continue;
    if (seenText.has(s)) continue;
    seenText.add(s);
    bodyParts.push(s);
  }

  const placeholders = attachmentHashes.map(
    (hash) => `${ATTACHMENT_PLACEHOLDER_PREFIX}${hash}${ATTACHMENT_PLACEHOLDER_SUFFIX}`,
  );
  const text = [bodyParts.join("\n"), placeholders.join("\n")]
    .filter((p) => p.length > 0)
    .join("\n\n")
    .trim();

  return { text, attachmentHashes };
}

/** Find the next 30–32-char hex run in the next few strings; returns lowercase normalised hash. */
function findHashNear(strings: string[], from: number): string | null {
  for (let j = from; j < Math.min(from + 6, strings.length); j++) {
    const m = strings[j].match(/[a-f0-9]{30,32}/i);
    if (!m) continue;
    let hash = m[0].toLowerCase();
    // Length bytes occasionally chop the leading hex char off a 32-byte
    // hash — keep the tail and let the crawler match it loosely.
    if (hash.length === 32) return hash;
    return hash;
  }
  return null;
}

/** Backwards-compatible wrapper that returns just the text body. */
export function extractTextFromRteBlob(buf: Buffer): string {
  return extractRte(buf).text;
}

/**
 * Resolve the on-disk path to a note's `.dat` file given the conduit-fs
 * root and the note's GUID. Returns null if no matching file is found.
 *
 * The path layout is sharded by GUID:
 *   `<rteRoot>/<first-3-hex>/<last-3-hex>/<guid>.dat`
 * where first-3 / last-3 are taken from the un-hyphenated GUID's first and
 * last three characters (NOT bytes — characters of the original guid).
 */
export function rteDatPath(rteRoot: string, noteGuid: string): string {
  const first = noteGuid.slice(0, 3);
  const last = noteGuid.slice(-3);
  // join() lives in node:path but importers may not have it; do it by hand
  // to keep this module dependency-free for downstream tests.
  return `${rteRoot}/${first}/${last}/${noteGuid}.dat`;
}
