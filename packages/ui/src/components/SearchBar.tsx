import { useState, useEffect, useRef, useCallback } from "react";
import type { SearchResult } from "../types";

interface SearchBarProps {
  onClose: () => void;
  onNavigate: (collection: string, markdownPath: string | null) => void;
}

export default function SearchBar({ onClose, onNavigate }: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const doSearch = useCallback((q: string) => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    fetch(`/api/search?q=${encodeURIComponent(q)}&limit=20`)
      .then((r) => r.json())
      .then((data: SearchResult[]) => {
        setResults(data);
        setSelectedIndex(0);
      })
      .catch(console.error)
      .finally(() => setSearching(false));
  }, []);

  const handleChange = (value: string) => {
    setQuery(value);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doSearch(value), 200);
  };

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
      onNavigate(result.collection, result.markdownPath);
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
            placeholder="Search across all collections..."
            value={query}
            onChange={(e) => handleChange(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          {searching && <span className="search-spinner">Searching...</span>}
        </div>
        {results.length > 0 && (
          <ul className="search-results" role="listbox">
            {results.map((r, i) => (
              <li
                key={`${r.collection}-${r.entityId}`}
                className={`search-result${i === selectedIndex ? " selected" : ""}`}
                role="option"
                aria-selected={i === selectedIndex}
                onClick={() => onNavigate(r.collection, r.markdownPath)}
              >
                <span className="search-result-title">{r.title}</span>
                <span className="search-result-meta">
                  {r.collection} &middot; {r.entityType}
                </span>
              </li>
            ))}
          </ul>
        )}
        {query && !searching && results.length === 0 && (
          <div className="search-empty">No results found</div>
        )}
      </div>
    </div>
  );
}
