// Portable posix path helpers — avoids importing "path" which is unavailable
// in the Cloudflare Worker bundle (esbuild without --platform=node).

function dirname(p: string): string {
  const idx = p.lastIndexOf("/");
  return idx === -1 ? "." : p.slice(0, idx) || ".";
}

function basename(p: string, ext?: string): string {
  const name = p.includes("/") ? p.split("/").pop()! : p;
  if (ext && name.endsWith(ext)) return name.slice(0, -ext.length);
  return name;
}

function normalizeParts(parts: string[]): string[] {
  const out: string[] = [];
  for (const p of parts) {
    if (p === "..") {
      if (out.length > 0 && out[out.length - 1] !== "..") out.pop();
      else out.push("..");
    } else if (p !== "." && p !== "") {
      out.push(p);
    }
  }
  return out;
}

function relativePath(from: string, to: string): string {
  const fromParts = normalizeParts(from.split("/"));
  const toParts = normalizeParts(to.split("/"));
  // Remove common prefix
  let common = 0;
  while (common < fromParts.length && common < toParts.length && fromParts[common] === toParts[common]) {
    common++;
  }
  const ups = fromParts.length - common;
  const result = [...Array(ups).fill(".."), ...toParts.slice(common)];
  return result.join("/") || ".";
}

function serializeYamlValue(value: unknown, indent: number = 0): string {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value === "string") {
    if (
      value === "" ||
      value.includes(":") ||
      value.includes("#") ||
      value.includes("\n") ||
      value.includes('"') ||
      value.includes("'") ||
      value.startsWith(" ") ||
      value.endsWith(" ") ||
      /^(true|false|null|yes|no|on|off)$/i.test(value)
    ) {
      return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const prefix = "  ".repeat(indent);
    return (
      "\n" +
      value.map((v) => `${prefix}  - ${serializeYamlValue(v, indent + 1)}`).join("\n")
    );
  }
  if (typeof value === "object") {
    const prefix = "  ".repeat(indent);
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    return (
      "\n" +
      entries
        .map(([k, v]) => `${prefix}  ${k}: ${serializeYamlValue(v, indent + 1)}`)
        .join("\n")
    );
  }
  return String(value);
}

export function frontmatter(fields: Record<string, unknown>): string {
  const lines: string[] = ["---"];
  for (const [key, value] of Object.entries(fields)) {
    lines.push(`${key}: ${serializeYamlValue(value)}`);
  }
  lines.push("---");
  return lines.join("\n");
}

export function wikilink(target: string, label?: string, sourcePath?: string): string {
  const targetFile = `${target}.md`;
  if (sourcePath) {
    const sourceDir = dirname(sourcePath);
    const relPath = relativePath(sourceDir, targetFile);
    return `[${label ?? target}](${relPath})`;
  }
  return `[${label ?? target}](${targetFile})`;
}

export function callout(type: string, title: string, content: string): string {
  const lines = [`> [!${type}] ${title}`];
  for (const line of content.split("\n")) {
    lines.push(`> ${line}`);
  }
  return lines.join("\n");
}

export function embed(path: string, sourcePath?: string): string {
  const filename = path.split("/").pop() ?? path;
  const alt = filename.replace(/\.[^.]+$/, "");
  if (sourcePath) {
    // Source is under markdown/, attachments is a sibling directory
    const sourceDir = dirname(`markdown/${sourcePath}`);
    const relPath = relativePath(sourceDir, `attachments/${path}`);
    return `![${alt}](${relPath})`;
  }
  return `![${alt}](../../attachments/${path})`;
}

export { basename, dirname, relativePath };
