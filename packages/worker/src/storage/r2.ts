export async function getR2Object(
  bucket: R2Bucket,
  key: string,
): Promise<{ body: ReadableStream; httpMetadata?: R2HTTPMetadata } | null> {
  const object = await bucket.get(key);
  if (!object) return null;
  return {
    body: object.body,
    httpMetadata: object.httpMetadata,
  };
}

export function getMimeType(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    svg: "image/svg+xml",
    webp: "image/webp",
    pdf: "application/pdf",
    json: "application/json",
    md: "text/markdown",
    txt: "text/plain",
    html: "text/html",
    css: "text/css",
    js: "application/javascript",
    xml: "application/xml",
    ico: "image/x-icon",
  };
  return map[ext] || "application/octet-stream";
}
