import { posix } from "path";

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
    const sourceDir = posix.dirname(sourcePath);
    const relPath = posix.relative(sourceDir, targetFile);
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
    const sourceDir = posix.dirname(`markdown/${sourcePath}`);
    const relPath = posix.relative(sourceDir, `attachments/${path}`);
    return `![${alt}](${relPath})`;
  }
  return `![${alt}](../../attachments/${path})`;
}
