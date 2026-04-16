import { useState, useEffect, useRef, useCallback } from "react";

interface FTSResult {
  collection: string;
  entityId: number;
  externalId: string;
  entityType: string;
  title: string;
  markdownPath: string | null;
  rank: number;
  snippet: string;
}

interface FullTextSearchProps {
  collection: string;
  onClose: () => void;
  onNavigate: (collection: string, markdownPath: string, openNewTab?: boolean) => void;
}

function SnippetDisplay({ html }: { html: string }) {
  return (
    <span
      className="fts-snippet"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 300;

export default function FullTextSearch({ collection, onClose, onNavigate }: FullTextSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FTSResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  // AbortController for the in-flight fetch. A fresh query aborts the prior
  // one so slow responses can't clobber fresh results (the classic
  // search-as-you-type race that made the list flicker).
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const doSearch = useCallback(
    async (q: string) => {
      // Cancel whatever's already in flight before starting a new request.
      abortRef.current?.abort();

      const trimmed = q.trim();
      if (trimmed.length < MIN_QUERY_LENGTH) {
        setResults([]);
        setLoading(false);
        return;
      }

      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      try {
        const params = new URLSearchParams({ q: trimmed, limit: "30" });
        if (collection) params.set("collection", collection);
        const res = await fetch(`/api/search?${params}`, { signal: controller.signal });
        if (res.ok && !controller.signal.aborted) {
          const data: FTSResult[] = await res.json();
          setResults(data);
          setSelectedIndex(0);
        }
      } catch (err) {
        // AbortError is expected when a newer query supersedes this one.
        if ((err as Error)?.name !== "AbortError") {
          // Other failures are silent — surfacing a toast for transient
          // network blips during typing would be more noise than signal.
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [collection],
  );

  const handleChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(value), DEBOUNCE_MS);
  };

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    };
  }, []);

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
      if (result.markdownPath) {
        onNavigate(result.collection, result.markdownPath);
      }
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  return (
    <div className="search-overlay" onClick={onClose}>
      <div className="search-dialog fts-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="search-input-wrapper">
          <svg className="fts-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            className="search-input"
            placeholder="Search content across all pages…"
            value={query}
            onChange={(e) => handleChange(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          {loading && <span className="search-spinner">⏳</span>}
        </div>
        {results.length > 0 && (
          <ul className="search-results" role="listbox" ref={listRef}>
            {results.map((r, i) => (
              <li
                key={`${r.collection}-${r.entityId}`}
                className={`search-result fts-result${i === selectedIndex ? " selected" : ""}`}
                role="option"
                aria-selected={i === selectedIndex}
                onClick={(e) => {
                  if (r.markdownPath) {
                    onNavigate(r.collection, r.markdownPath, e.metaKey || e.ctrlKey);
                  }
                }}
              >
                <span className="search-result-title">{r.title}</span>
                {r.snippet && (
                  <span className="fts-snippet-wrapper">
                    <SnippetDisplay html={r.snippet} />
                  </span>
                )}
                <span className="search-result-meta">
                  {r.entityType}
                  {r.markdownPath && r.markdownPath.includes("/") && (
                    <> · {r.markdownPath.split("/").slice(0, -1).join("/")}</>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        {query.trim().length >= MIN_QUERY_LENGTH && !loading && results.length === 0 && (
          <div className="search-empty">No results found</div>
        )}
        {query.trim().length > 0 && query.trim().length < MIN_QUERY_LENGTH && (
          <div className="search-empty fts-hint">
            Keep typing — minimum {MIN_QUERY_LENGTH} characters
          </div>
        )}
        {!query && (
          <div className="search-empty fts-hint">
            Type to search across all page content
          </div>
        )}
      </div>
    </div>
  );
}
