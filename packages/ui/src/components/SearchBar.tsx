import { useState, useEffect, useRef, useMemo } from "react";

interface SearchBarProps {
  files: string[];
  collection: string;
  onClose: () => void;
  onNavigate: (collection: string, markdownPath: string) => void;
}

/** Title from a file path: strip folders and .md extension. */
function titleFromPath(filePath: string): string {
  return filePath.replace(/\.md$/, "").split("/").pop() ?? filePath;
}

interface FuzzyMatch {
  filePath: string;
  title: string;
  indices: number[];
  score: number;
}

/**
 * Fuzzy-match a query against a title. Each query token's characters must
 * appear in order in the title (case-insensitive). Returns matched character
 * indices and a score, or null if no match.
 */
function fuzzyMatch(query: string, title: string): { indices: number[]; score: number } | null {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;

  const titleLower = title.toLowerCase();
  const indices: number[] = [];

  for (const token of tokens) {
    let pos = 0;
    let matched = false;
    const tokenIndices: number[] = [];

    for (let i = 0; i < token.length; i++) {
      const idx = titleLower.indexOf(token[i], pos);
      if (idx === -1) { matched = false; break; }
      tokenIndices.push(idx);
      pos = idx + 1;
      matched = true;
    }

    if (!matched) return null;
    indices.push(...tokenIndices);
  }

  // Score: lower is better.
  // Bonus for consecutive matches, word-boundary matches, and shorter titles.
  let score = 0;
  const sortedIndices = [...new Set(indices)].sort((a, b) => a - b);
  for (let i = 0; i < sortedIndices.length; i++) {
    const idx = sortedIndices[i];
    // Gap penalty: distance from previous match
    if (i > 0) {
      score += (sortedIndices[i] - sortedIndices[i - 1] - 1) * 2;
    } else {
      // Bonus for matching near the start
      score += idx * 3;
    }
    // Bonus for word boundary matches (start of string or after space/separator)
    if (idx === 0 || /[\s\-_/]/.test(titleLower[idx - 1])) {
      score -= 5;
    }
  }
  // Prefer shorter titles
  score += title.length;

  return { indices: sortedIndices, score };
}

function HighlightedTitle({ title, indices }: { title: string; indices: number[] }) {
  const set = new Set(indices);
  const parts: { text: string; highlight: boolean }[] = [];
  let i = 0;
  while (i < title.length) {
    const isHighlight = set.has(i);
    let j = i + 1;
    while (j < title.length && set.has(j) === isHighlight) j++;
    parts.push({ text: title.slice(i, j), highlight: isHighlight });
    i = j;
  }
  return (
    <>
      {parts.map((p, idx) =>
        p.highlight ? (
          <mark key={idx} className="search-highlight">{p.text}</mark>
        ) : (
          <span key={idx}>{p.text}</span>
        ),
      )}
    </>
  );
}

export default function SearchBar({ files, collection, onClose, onNavigate }: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results: FuzzyMatch[] = useMemo(() => {
    const q = query.trim();
    if (!q) return [];
    const matches: FuzzyMatch[] = [];
    for (const filePath of files) {
      const title = titleFromPath(filePath);
      const m = fuzzyMatch(q, title);
      if (m) matches.push({ filePath, title, indices: m.indices, score: m.score });
    }
    matches.sort((a, b) => a.score - b.score);
    return matches.slice(0, 30);
  }, [query, files]);

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [results]);

  // Scroll selected item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const item = list.children[selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results.length > 0) {
      e.preventDefault();
      const result = results[selectedIndex];
      onNavigate(collection, result.filePath);
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  return (
    <div className="search-overlay" onClick={onClose}>
      <div className="search-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="search-input-wrapper">
          <input
            ref={inputRef}
            type="text"
            className="search-input"
            placeholder="Search pages by title..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
        {results.length > 0 && (
          <ul className="search-results" role="listbox" ref={listRef}>
            {results.map((r, i) => (
              <li
                key={r.filePath}
                className={`search-result${i === selectedIndex ? " selected" : ""}`}
                role="option"
                aria-selected={i === selectedIndex}
                onClick={() => onNavigate(collection, r.filePath)}
              >
                <span className="search-result-title">
                  <HighlightedTitle title={r.title} indices={r.indices} />
                </span>
                {r.filePath.includes("/") && (
                  <span className="search-result-meta">
                    {r.filePath.split("/").slice(0, -1).join("/")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {query && results.length === 0 && (
          <div className="search-empty">No results found</div>
        )}
      </div>
    </div>
  );
}
