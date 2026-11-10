import { toR2SafeKey } from "@frozenink/core/storage/r2-key";

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

/** Read new encoded keys while retaining compatibility with existing deployments. */
export async function getR2Asset(bucket: R2Bucket, originalKey: string) {
  const safeKey = toR2SafeKey(originalKey);
  const object = await getR2Object(bucket, safeKey);
  if (object || safeKey === originalKey) return object;
  return getR2Object(bucket, originalKey);
}
