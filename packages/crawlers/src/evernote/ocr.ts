import { spawnSync } from "child_process";
import { writeFileSync, mkdtempSync, rmSync } from "fs";
import { tmpdir, platform } from "os";
import { join } from "path";
import { parseEvernoteRecognitionXml } from "./enml";

/**
 * Three-tier OCR cascade. The first tier that returns non-empty text wins.
 *
 *  1. Evernote-provided `recognition` XML — free, exact, no work.
 *  2. Apple Vision (macOS only) via a small Swift helper invoked through
 *     `child_process.execFile`. Handles images natively; PDFs are rasterized
 *     with `pdftoppm` if it's installed, otherwise skipped at this tier.
 *  3. Tesseract.js (+ pdfjs-dist for PDFs) WASM fallback. These are dynamic
 *     imports — if the modules aren't installed the tier is skipped.
 *
 * The cascade is best-effort: any exception inside a tier collapses to an
 * empty string and falls through to the next tier.
 */
export interface OcrInput {
  /** Raw bytes of the attachment. */
  buffer: Buffer;
  /** MIME type as reported by Evernote (e.g. `image/png`, `application/pdf`). */
  mimeType: string;
  /** Original filename, used as a hint for extension-based heuristics. */
  filename: string;
  /** Optional Evernote-supplied OCR XML for this resource. */
  evernoteRecognitionXml?: string;
  /** Per-attachment cap; oversized files are skipped entirely. */
  maxBytes?: number;
}

export async function extractAttachmentText(input: OcrInput): Promise<string> {
  if (input.maxBytes && input.buffer.length > input.maxBytes) return "";

  const isImage = input.mimeType.startsWith("image/");
  const isPdf =
    input.mimeType === "application/pdf" ||
    input.filename.toLowerCase().endsWith(".pdf");
  if (!isImage && !isPdf) return "";

  // Tier 1 — Evernote recognition.
  if (input.evernoteRecognitionXml) {
    const text = parseEvernoteRecognitionXml(input.evernoteRecognitionXml);
    if (text.trim()) return text;
  }

  // Tier 2 — Apple Vision on macOS. Only attempted when the buffer looks
  // like a real image (magic-byte sniff) so we don't fork/exec for every
  // junk byte sequence we encounter — particularly important in tests.
  if (platform() === "darwin" && looksLikeImage(input.buffer)) {
    try {
      const text = await runAppleVision(input.buffer, input.mimeType, input.filename);
      if (text.trim()) return text;
    } catch {
      // fall through
    }
  }

  // Tier 3 — Tesseract / pdfjs fallback (lazy, optional).
  try {
    const text = await runTesseract(input);
    if (text.trim()) return text;
  } catch {
    // give up
  }
  return "";
}

function looksLikeImage(buf: Buffer): boolean {
  if (buf.length < 8) return false;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
  // GIF: GIF87a / GIF89a
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return true;
  // BMP: BM
  if (buf[0] === 0x42 && buf[1] === 0x4d) return true;
  // WebP: RIFF....WEBP
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) return true;
  return false;
}

async function runAppleVision(
  buffer: Buffer,
  mimeType: string,
  filename: string,
): Promise<string> {
  // The helper writes the input to a temp file then runs a one-shot Swift
  // VNRecognizeTextRequest. Image-only — PDFs need rasterization first.
  if (!mimeType.startsWith("image/")) return "";
  const tmp = mkdtempSync(join(tmpdir(), "frozenink-vision-"));
  const inPath = join(tmp, filename || "img");
  try {
    writeFileSync(inPath, buffer);
    const swift = `
import Foundation
import Vision
import AppKit

let url = URL(fileURLWithPath: CommandLine.arguments[1])
guard let img = NSImage(contentsOf: url),
      let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
  exit(0)
}
let req = VNRecognizeTextRequest()
req.recognitionLevel = .accurate
let handler = VNImageRequestHandler(cgImage: cg, options: [:])
do { try handler.perform([req]) } catch { exit(0) }
let lines = (req.results ?? []).compactMap { $0.topCandidates(1).first?.string }
print(lines.joined(separator: "\\n"))
`;
    const scriptPath = join(tmp, "ocr.swift");
    writeFileSync(scriptPath, swift);
    const res = spawnSync("swift", [scriptPath, inPath], {
      encoding: "utf-8",
      timeout: 30_000,
    });
    if (res.status !== 0) return "";
    return res.stdout?.trim() ?? "";
  } finally {
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

async function runTesseract(input: OcrInput): Promise<string> {
  // Both deps are optional; if they aren't installed we silently no-op so
  // the crawler keeps working without the WASM dependency footprint.
  type TesseractModule = {
    recognize: (img: Buffer | Uint8Array, lang: string) => Promise<{ data: { text: string } }>;
  };
  let tesseract: TesseractModule | null = null;
  try {
    tesseract = (await import(
      /* @vite-ignore */ "tesseract.js" as string
    )) as TesseractModule;
  } catch {
    return "";
  }
  if (!tesseract) return "";
  const recognize = tesseract.recognize;
  const isPdf =
    input.mimeType === "application/pdf" ||
    input.filename.toLowerCase().endsWith(".pdf");

  if (!isPdf) {
    const result = await recognize(input.buffer, "eng");
    return result.data?.text?.trim() ?? "";
  }

  // PDF: try pdfjs-dist first for the embedded text layer; rasterize pages
  // that come back empty and run Tesseract on them.
  let pdfjs: any = null;
  try {
    pdfjs = await import(/* @vite-ignore */ "pdfjs-dist/legacy/build/pdf.mjs" as string);
  } catch {
    return "";
  }
  const doc = await pdfjs.getDocument({ data: new Uint8Array(input.buffer) }).promise;
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    const pageText = (tc.items as Array<{ str: string }>).map((it) => it.str).join(" ").trim();
    if (pageText) out.push(pageText);
  }
  return out.join("\n");
}
