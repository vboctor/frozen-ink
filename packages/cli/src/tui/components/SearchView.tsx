import React, { useState, useCallback, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { existsSync } from "fs";
import { join } from "path";
import { exec } from "child_process";
import {
  ensureInitialized,
  listCollections,
  getCollectionDb,
  getCollectionDbPath,
  getFrozenInkHome,
  SearchIndexer,
  entities,
  entityMarkdownPath,
} from "@frozenink/core";
import { desc, eq, sql } from "drizzle-orm";

interface SearchResult {
  collection: string;
  entityType: string;
  title: string;
  externalId: string;
  rank: number;
}

function openFile(filePath: string): void {
  const cmd =
    process.platform === "darwin"
      ? `open "${filePath}"`
      : process.platform === "win32"
        ? `start "" "${filePath}"`
        : `xdg-open "${filePath}"`;
  exec(cmd);
}

/**
 * Build a compact prefix for a search result line.
 * - issue/PR: "#00238:" (the type is obvious from the numeric ID)
 * - note: nothing (Obsidian vaults are all notes, showing "note:" is noise)
 * - other types: "user:", "project:", etc.
 */
function formatResultPrefix(entityType: string, externalId: string): string | null {
  const colonIdx = externalId.indexOf(":");
  const rawId = colonIdx !== -1 ? externalId.slice(colonIdx + 1) : "";

  if (entityType === "issue" || entityType === "pull_request") {
    const num = parseInt(rawId, 10);
    if (!isNaN(num)) return `#${String(num).padStart(5, "0")}:`;
  }

  if (entityType === "note") return null;

  if (entityType === "page") {
    // externalId is "page:{projectId}:{pageName}"
    const parts = rawId.split(":");
    const pageName = parts.length >= 2 ? parts.slice(1).join(":") : rawId;
    return `[[${pageName}]]:`;
  }

  return `${entityType}:`;
}

function getMarkdownPath(result: SearchResult): string | null {
  const home = getFrozenInkHome();
  const dbPath = getCollectionDbPath(result.collection);
  if (!existsSync(dbPath)) return null;
  try {
    const colDb = getCollectionDb(dbPath);
    const rows = colDb
      .select({ folder: entities.folder, slug: entities.slug })
      .from(entities)
      .where(eq(entities.externalId, result.externalId))
      .all();
    const rel = entityMarkdownPath(rows[0]?.folder, rows[0]?.slug);
    if (rel) {
      const mdPath = join(home, "collections", result.collection, "content", rel);
      if (existsSync(mdPath)) return mdPath;
    }
  } catch { /* ignore */ }
  return null;
}

/** Fetch all entities (most recently updated first) when query is empty. */
function fetchAllEntities(collectionName?: string): SearchResult[] {
  const collections = collectionName
    ? [{ name: collectionName }]
    : listCollections();
  const allResults: SearchResult[] = [];

  for (const col of collections) {
    const dbPath = getCollectionDbPath(col.name);
    if (!existsSync(dbPath)) continue;
    try {
      const colDb = getCollectionDb(dbPath);
      const rows = colDb
        .select({
          externalId: entities.externalId,
          entityType: entities.entityType,
          title: entities.title,
        })
        .from(entities)
        .orderBy(desc(entities.updatedAt))
        .limit(100)
        .all();
      for (const r of rows) {
        allResults.push({
          collection: col.name,
          entityType: r.entityType,
          title: r.title,
          externalId: r.externalId,
          rank: 0,
        });
      }
    } catch { /* ignore */ }
  }
  return allResults;
}

const PAGE_SIZE = 10;

export function SearchView({
  collectionName,
  onDone,
}: {
  collectionName?: string;
  onDone?: () => void;
}): React.ReactElement {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [resultCursor, setResultCursor] = useState(0);

  ensureInitialized();
  const initialized = true;

  const runSearch = useCallback((q: string) => {
    if (!q.trim()) {
      setResults(fetchAllEntities(collectionName));
      setResultCursor(0);
      return;
    }

    const collections = collectionName
      ? [{ name: collectionName }]
      : listCollections();
    const allResults: SearchResult[] = [];

    for (const col of collections) {
      const dbPath = getCollectionDbPath(col.name);
      if (!existsSync(dbPath)) continue;

      const indexer = new SearchIndexer(dbPath);
      try {
        const hits = indexer.search(q.trim(), { collectionName: col.name });
        for (const r of hits) {
          allResults.push({ ...r, collection: col.name });
        }
      } finally {
        indexer.close();
      }
    }

    allResults.sort((a, b) => a.rank - b.rank);
    setResults(allResults.slice(0, 100));
    setResultCursor(0);
  }, [collectionName]);

  // Run initial search on mount
  useEffect(() => {
    if (initialized) runSearch("");
  }, [initialized]);

  // Handle all keyboard input in one place
  useInput((input, key) => {
    if (key.escape || key.tab) {
      if (onDone) { onDone(); return; }
      return;
    }

    // Navigation keys work alongside typing
    if (key.upArrow) {
      setResultCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.downArrow) {
      setResultCursor((c) => Math.min(results.length - 1, c + 1));
      return;
    }
    if (key.leftArrow) {
      setResultCursor((c) => {
        const prevPageStart = Math.floor(c / PAGE_SIZE) * PAGE_SIZE - PAGE_SIZE;
        return Math.max(0, prevPageStart);
      });
      return;
    }
    if (key.rightArrow) {
      setResultCursor((c) => {
        const nextPageStart = Math.floor(c / PAGE_SIZE) * PAGE_SIZE + PAGE_SIZE;
        return Math.min(results.length - 1, nextPageStart);
      });
      return;
    }

    if (key.return) {
      if (results[resultCursor]) {
        const mdPath = getMarkdownPath(results[resultCursor]);
        if (mdPath) openFile(mdPath);
      }
      return;
    }

    // Text editing
    if (key.backspace || key.delete) {
      const next = query.slice(0, -1);
      setQuery(next);
      runSearch(next);
      return;
    }

    if (!key.ctrl && !key.meta && input) {
      const next = query + input;
      setQuery(next);
      runSearch(next);
    }
  });

  const scoped = !!collectionName;
  const title = scoped ? `Search in "${collectionName}"` : "Search";

  const totalPages = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  const currentPage = Math.floor(resultCursor / PAGE_SIZE);
  const pageStart = currentPage * PAGE_SIZE;
  const pageResults = results.slice(pageStart, pageStart + PAGE_SIZE);

  return (
    <Box flexDirection="column" paddingY={1}>
      <Text bold>{title}</Text>

      <Box marginTop={1}>
        <Text color="cyan">? </Text>
        <Text bold>Find: </Text>
        <Text>{query}</Text>
        <Text color="cyan">█</Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {results.length === 0 ? (
          <Text dimColor>{query ? "No results found." : "No entities yet."}</Text>
        ) : (
          <>
            <Text dimColor>
              {results.length} result(s){query ? ` for "${query}"` : ""}
            </Text>
            <Box flexDirection="column" marginTop={1}>
              {pageResults.map((r, i) => {
                const globalIdx = pageStart + i;
                const prefix = formatResultPrefix(r.entityType, r.externalId);
                return (
                  <Box key={globalIdx} gap={1}>
                    <Text color={globalIdx === resultCursor ? "cyan" : undefined}>
                      {globalIdx === resultCursor ? ">" : " "}
                    </Text>
                    {!scoped && <Text dimColor>[{r.collection}]</Text>}
                    {prefix && <Text color="cyan">{prefix}</Text>}
                    <Text bold={globalIdx === resultCursor}>{r.title}</Text>
                  </Box>
                );
              })}
            </Box>
            <Text dimColor>
              Page {currentPage + 1} of {totalPages} — ↑↓ navigate, ←→ prev/next page, Enter open, ESC back
            </Text>
          </>
        )}
      </Box>
    </Box>
  );
}
