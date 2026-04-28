import { describe, expect, it } from "bun:test";
import { extractAttachmentText } from "../ocr";

describe("extractAttachmentText OCR cascade", () => {
  it("uses the Evernote-provided recognition XML when available (tier 1)", async () => {
    const text = await extractAttachmentText({
      buffer: Buffer.from([0]),
      mimeType: "image/png",
      filename: "x.png",
      evernoteRecognitionXml: `<recoIndex><item><t w="90">cached</t></item></recoIndex>`,
    });
    expect(text).toBe("cached");
  });

  it("returns empty for non-image / non-PDF attachments without falling through", async () => {
    const text = await extractAttachmentText({
      buffer: Buffer.from("hello"),
      mimeType: "text/plain",
      filename: "x.txt",
    });
    expect(text).toBe("");
  });

  it("respects the maxBytes filter and skips oversized files", async () => {
    const big = Buffer.alloc(10);
    const text = await extractAttachmentText({
      buffer: big,
      mimeType: "image/png",
      filename: "huge.png",
      evernoteRecognitionXml: `<recoIndex><item><t>nope</t></item></recoIndex>`,
      maxBytes: 4,
    });
    expect(text).toBe("");
  });
});
