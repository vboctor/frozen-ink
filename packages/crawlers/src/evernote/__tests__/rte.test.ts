import { describe, expect, it } from "bun:test";
import { extractRte, extractTextFromRteBlob, rteDatPath } from "../rte";

/**
 * Synthesize a buffer that mimics the v10 binary RTE wire format closely
 * enough for extraction: arbitrary 1-byte control bytes interleaved with
 * length-prefixed UTF-8 strings. The extractor doesn't actually parse the
 * length bytes — it just walks printable runs — so this is a fair stand-in.
 */
function buildBlob(strings: string[]): Buffer {
  const parts: Buffer[] = [];
  for (const s of strings) {
    // Real Yjs streams interleave several non-printable control bytes
    // (typically < 0x20) between strings — use 0x05 as a guaranteed boundary
    // marker so the extractor's printable-run scan terminates between fields.
    parts.push(Buffer.from([0x07, 0x01, 0x05]));
    parts.push(Buffer.from(s, "utf-8"));
  }
  return Buffer.concat(parts);
}

describe("extractTextFromRteBlob", () => {
  it("strips structural keys and recovers body content", () => {
    const blob = buildBlob([
      "content", "en-note", "div", "meta", "schemaVersion",
      "type", "image/png", "hash", "5e47bac687a10827a57aeb600d4f3bbb",
      "Paid on 22nd of Apr 2025",
      "See receipt attached",
    ]);
    const text = extractTextFromRteBlob(blob);
    expect(text).toContain("Paid on 22nd of Apr 2025");
    expect(text).toContain("See receipt attached");
    expect(text).not.toContain("en-note");
    expect(text).not.toContain("schemaVersion");
    expect(text).not.toContain("5e47bac687a10827a57aeb600d4f3bbb");
  });

  it("drops style declarations and GUID-like strings", () => {
    const blob = buildBlob([
      "--en-naturalWidth:2512; --en-naturalHeight:1450;",
      "abc12345-6789-abcd-ef01-23456789abcd",
      "Real body text here",
    ]);
    expect(extractTextFromRteBlob(blob)).toBe("Real body text here");
  });

  it("returns empty string for empty input", () => {
    expect(extractTextFromRteBlob(Buffer.alloc(0))).toBe("");
  });

  it("drops --en- CSS variables and base64 payloads", () => {
    const blob = buildBlob([
      `display:none;--en-chs:"eyJoMSI6eyJmb250RmFtaWx5IjoiaW5oZXJpdCJ9fQ=="`,
      "Real body text",
    ]);
    expect(extractTextFromRteBlob(blob)).toBe("Real body text");
  });

  it("strips field-name+length-byte prefixes from glued values", () => {
    // Real Yjs binary often glues a length byte onto the field name, e.g.
    // `title<2><body>` decodes to `title2<body>` once read as ASCII. We
    // strip the prefix so the actual title text reads cleanly.
    const blob = buildBlob([
      "title220260331 230 Lake Chelan Reclamation District Bill",
    ]);
    expect(extractTextFromRteBlob(blob)).toContain("20260331 230 Lake Chelan Reclamation District Bill");
  });

  it("drops trailing concatenated field runs", () => {
    const blob = buildBlob([
      "Reclamation District Bill colorw 0 fontStylew",
    ]);
    expect(extractTextFromRteBlob(blob)).toBe("Reclamation District Bill");
  });
});

describe("extractRte attachment placeholders", () => {
  it("collects en-media references and appends them after body text", () => {
    const blob = buildBlob([
      "Some body text",
      "en-media",
      "hash",
      "w 5e47bac687a10827a57aeb600d4f3bbb",
      "type",
      "image/png",
      "More body text",
    ]);
    const result = extractRte(blob);
    expect(result.attachmentHashes).toEqual(["5e47bac687a10827a57aeb600d4f3bbb"]);
    // Body lines come first; the placeholder appears after them. The
    // binary's CRDT structure isn't decoded, so we can't match exact
    // inline position — but the common "short body + attached doc" layout
    // matches how Evernote shows these notes.
    const bodyIdx = result.text.indexOf("Some body text");
    const placeholderIdx = result.text.indexOf("[[EVERNOTE_ATTACHMENT:");
    expect(bodyIdx).toBeGreaterThanOrEqual(0);
    expect(bodyIdx).toBeLessThan(placeholderIdx);
  });
});

describe("rteDatPath", () => {
  it("shards the GUID into <first-3>/<last-3>/<guid>.dat", () => {
    expect(rteDatPath("/root", "000a3dfa-86c4-57e0-a72c-dbfa337905ea"))
      .toBe("/root/000/5ea/000a3dfa-86c4-57e0-a72c-dbfa337905ea.dat");
  });
});
