import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { existsSync } from "fs";
import { join } from "path";
import { exec } from "child_process";
import {
  contextExists,
  listCollections,
  getCollectionDb,
  getCollectionDbPath,
  getFrozenInkHome,
  SearchIndexer,
  entities,
} from "@frozenink/core";
import { eq } from "drizzle-orm";
import { TextInput } from "./TextInput.js";

interface SearchResult {
  collection: string;
  entityType: string;
  title: string;
  externalId: string;
  rank: number;
}

type Mode = "input" | "results";

function openFile(filePath: string): void {
  const cmd =
    process.platform === "darwin"
      ? `open "${filePath}"`
      : process.platform === "win32"
        ? `start "" "${filePath}"`
        : `xdg-open "${filePath}"`;
  exec(cmd);
}

function getMarkdownPath(result: SearchResult): string | null {
  const home = getFrozenInkHome();
  const dbPath = getCollectionDbPath(result.collection);
  if (!existsSync(dbPath)) return null;
  try {
    const colDb = getCollectionDb(dbPath);
    const rows = colDb
      .select()
      .from(entities)
      .where(eq(entities.externalId, result.externalId))
      .all();
    if (rows.length > 0 && rows[0].markdownPath) {
      const mdPath = join(home, "collections", result.collection, rows[0].markdownPath);
      if (existsSync(mdPath)) return mdPath;
    }
  } catch { /* ignore */ }
  return null;
}

export function SearchView({
  collectionName,
  onDone,
}: {
  collectionName?: string;
  onDone?: () => void;
}): React.ReactElement {
  // All hooks before any conditional returns
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [mode, setMode] = useState<Mode>("input");
  const [resultCursor, setResultCursor] = useState(0);

  const initialized = contextExists();

  const doSearch = useCallback(() => {
    if (!query.trim()) return;

    const collections = collectionName
      ? [{ name: collectionName }]
      : listCollections();
    const allResults: SearchResult[] = [];

    for (const col of collections) {
      const dbPath = getCollectionDbPath(col.name);
      if (!existsSync(dbPath)) continue;

      const indexer = new SearchIndexer(dbPath);
      try {
        const hits = indexer.search(query.trim(), { collectionName: col.name });
        for (const r of hits) {
          allResults.push({ ...r, collection: col.name });
        }
      } finally {
        indexer.close();
      }
    }

    allResults.sort((a, b) => a.rank - b.rank);
    setResults(allResults.slice(0, 30));
    setSearched(true);
    setResultCursor(0);
    if (allResults.length > 0) {
      setMode("results");
    }
  }, [query, collectionName]);

  useInput((input, key) => {
    if (mode === "results") {
      if (key.upArrow) setResultCursor((c) => Math.max(0, c - 1));
      if (key.downArrow) setResultCursor((c) => Math.min(results.length - 1, c + 1));
      if (key.return && results[resultCursor]) {
        const mdPath = getMarkdownPath(results[resultCursor]);
        if (mdPath) openFile(mdPath);
      }
      if (key.escape || key.tab) {
        if (onDone) { onDone(); return; }
        setMode("input");
        setQuery("");
        setSearched(false);
      }
    }
  });

  // All hooks above — safe to do conditional returns now

  if (!initialized) {
    return <Text color="yellow">Not initialized.</Text>;
  }

  const scoped = !!collectionName;
  const title = scoped ? `Search in "${collectionName}"` : "Search";
  const description = scoped
    ? `Search within "${collectionName}". Type a query and press Enter.`
    : "Full-text search across all collections. Type a query and press Enter.";
  const inputLabel = scoped ? `Search ${collectionName}` : "Search all";

  return (
    <Box flexDirection="column" paddingY={1}>
      <Text bold>{title}</Text>
      <Text dimColor>{description}</Text>

      {mode === "input" && (
        <Box marginTop={1}>
          <TextInput
            label={inputLabel}
            value={query}
            onChange={setQuery}
            onSubmit={doSearch}
            placeholder="Enter search terms..."
          />
        </Box>
      )}

      {mode === "results" && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>
            {results.length} result(s) for "{query}" — ↑↓ navigate, Enter to open, ESC back
          </Text>
          <Box flexDirection="column" marginTop={1}>
            {results.length === 0 ? (
              <Text dimColor>No results found.</Text>
            ) : (
              results.map((r, i) => (
                <Box key={i} gap={1}>
                  <Text color={i === resultCursor ? "cyan" : undefined}>
                    {i === resultCursor ? "❯" : " "}
                  </Text>
                  {!scoped && <Text dimColor>[{r.collection}]</Text>}
                  <Text color="cyan">{r.entityType}:</Text>
                  <Text bold={i === resultCursor}>{r.title}</Text>
                </Box>
              ))
            )}
          </Box>
        </Box>
      )}

      {mode === "input" && searched && results.length === 0 && (
        <Box marginTop={1}>
          <Text dimColor>No results found.</Text>
        </Box>
      )}
    </Box>
  );
}
