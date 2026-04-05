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

export function wikilink(target: string, label?: string): string {
  if (label) {
    return `[[${target}|${label}]]`;
  }
  return `[[${target}]]`;
}

export function callout(type: string, title: string, content: string): string {
  const lines = [`> [!${type}] ${title}`];
  for (const line of content.split("\n")) {
    lines.push(`> ${line}`);
  }
  return lines.join("\n");
}

export function embed(path: string): string {
  return `![[${path}]]`;
}
