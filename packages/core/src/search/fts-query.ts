/**
 * Build an FTS5 query from raw user input. Whitespace-separated "words" are
 * independent AND clauses; a word with internal punctuation (e.g. "8.4") is
 * expanded to an FTS5 phrase of its sub-tokens so they must appear adjacent
 * in the index — mirroring how FTS5's default unicode61 tokenizer actually
 * stored them at index time.
 *
 * Examples:
 *   "PHP 8.4"       → PHP* "8 4*"
 *   "fix lo"        → fix* lo*
 *   "mantis 1.2.3"  → mantis* "1 2 3*"
 *
 * Every final token gets a trailing `*` so partial typing still matches.
 * The phrase-with-last-prefix form `"a b c*"` is valid FTS5 syntax.
 */
export function buildFtsQuery(raw: string): string {
  const words = raw.trim().split(/\s+/).filter(Boolean);
  const clauses: string[] = [];
  for (const word of words) {
    const sub = word.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    if (sub.length === 0) continue;
    if (sub.length === 1) {
      clauses.push(`${sub[0]}*`);
    } else {
      const head = sub.slice(0, -1).join(" ");
      const tail = sub[sub.length - 1];
      clauses.push(`"${head} ${tail}*"`);
    }
  }
  return clauses.join(" ");
}
