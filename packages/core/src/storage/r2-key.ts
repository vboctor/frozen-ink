/**
 * Map local paths to R2 keys that do not contain traversal-like `..`
 * sequences. Cloudflare's edge WAF blocks those sequences before requests
 * reach the authenticated R2 API. Tildes are escaped first so the mapping is
 * deterministic and collision-free for transformed segments.
 */
export function toR2SafeKey(key: string): string {
  return key
    .split("/")
    .map((segment) => segment.replace(/~/g, "~~").replace(/\.\./g, "~dd~"))
    .join("/");
}
