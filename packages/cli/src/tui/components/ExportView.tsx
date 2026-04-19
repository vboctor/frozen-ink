import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import {
  ensureInitialized,
  listCollections,
  ThemeEngine,
} from "@frozenink/core";
import { exportStaticSite } from "@frozenink/core/export";
import {
  gitHubTheme,
  obsidianTheme,
  gitTheme,
  mantisHubTheme,
  rssTheme,
} from "@frozenink/crawlers";
import { TextInput } from "./TextInput.js";

type Step = "format" | "collections" | "output-dir" | "exporting" | "done" | "error";

export function ExportView({
  collectionName,
  onDone,
}: {
  collectionName?: string;
  onDone?: () => void;
}): React.ReactElement {
  const [step, setStep] = useState<Step>(collectionName ? "format" : "collections");
  const [format, setFormat] = useState<"markdown" | "html">("markdown");
  const [formatCursor, setFormatCursor] = useState(0);
  const [selectedCollections, setSelectedCollections] = useState<Set<string>>(
    collectionName ? new Set([collectionName]) : new Set(),
  );
  const [collCursor, setCollCursor] = useState(0);
  const [outputDir, setOutputDir] = useState("");
  const [progress, setProgress] = useState<string[]>([]);
  const [error, setError] = useState("");

  ensureInitialized();

  const collections = listCollections()
    .filter((c: { enabled: boolean }) => c.enabled)
    .map((c: { name: string }) => c.name);

  const formats = [
    { label: "Markdown", value: "markdown" as const },
    { label: "HTML", value: "html" as const },
  ];

  useInput((input, key) => {
    if (step === "format") {
      if (key.escape && onDone) { onDone(); return; }
      if (key.upArrow || key.downArrow) setFormatCursor((c) => (c === 0 ? 1 : 0));
      if (key.return) {
        setFormat(formats[formatCursor].value);
        setStep(collectionName ? "output-dir" : "collections");
      }
    }
    if (step === "collections") {
      if (key.upArrow) setCollCursor((c) => Math.max(0, c - 1));
      if (key.downArrow) setCollCursor((c) => Math.min(collections.length - 1, c + 1));
      if (input === " ") {
        const name = collections[collCursor];
        setSelectedCollections((prev) => {
          const next = new Set(prev);
          if (next.has(name)) next.delete(name);
          else next.add(name);
          return next;
        });
      }
      if (key.return && selectedCollections.size > 0) {
        setStep("output-dir");
      }
    }
    if (step === "done" || step === "error") {
      if (key.return || key.escape) {
        if (onDone) { onDone(); return; }
        setStep("format");
        setProgress([]);
        setError("");
        setSelectedCollections(new Set());
        setOutputDir("");
      }
    }
  });

  const handleOutputDirSubmit = useCallback(async () => {
    const dir = outputDir.trim();
    if (!dir) return;

    setStep("exporting");
    setProgress([]);

    try {
      let themeEngine: ThemeEngine | undefined;
      if (format === "html") {
        themeEngine = new ThemeEngine();
        themeEngine.register(gitHubTheme);
        themeEngine.register(obsidianTheme);
        themeEngine.register(gitTheme);
        themeEngine.register(mantisHubTheme);
        themeEngine.register(rssTheme);
      }

      await exportStaticSite({
        collections: [...selectedCollections],
        outputDir: dir,
        format,
        themeEngine,
        onProgress: (stepName: string, current: number, total: number) => {
          setProgress((p) => [...p, `${stepName}: ${current}/${total}`]);
        },
      });

      setStep("done");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setStep("error");
    }
  }, [outputDir, selectedCollections, format]);

  return (
    <Box flexDirection="column" paddingY={1}>
      <Text bold>Export{collectionName ? ` "${collectionName}"` : ""}</Text>

      {step === "format" && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>Select export format:</Text>
          {formats.map((f, i) => (
            <Box key={f.value}>
              <Text color={i === formatCursor ? "cyan" : undefined}>
                {i === formatCursor ? "❯ " : "  "}{f.label}
              </Text>
            </Box>
          ))}
        </Box>
      )}

      {step === "collections" && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>
            Format: <Text color="cyan">{format}</Text> — Select collections (space to toggle, enter to continue)
          </Text>
          {collections.map((name: string, i: number) => (
            <Box key={name} gap={1}>
              <Text color={i === collCursor ? "cyan" : undefined}>
                {i === collCursor ? "❯" : " "}
              </Text>
              <Text>{selectedCollections.has(name) ? "[✓]" : "[ ]"}</Text>
              <Text>{name}</Text>
            </Box>
          ))}
        </Box>
      )}

      {step === "output-dir" && (
        <Box marginTop={1}>
          <TextInput
            label="Output directory"
            value={outputDir}
            onChange={setOutputDir}
            onSubmit={handleOutputDirSubmit}
            placeholder="/path/to/export"
          />
        </Box>
      )}

      {step === "exporting" && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="yellow">Exporting...</Text>
          {progress.slice(-10).map((line, i) => (
            <Text key={i} dimColor>{line}</Text>
          ))}
        </Box>
      )}

      {step === "done" && (
        <Box marginTop={1}>
          <Text color="green">Export complete! Press Enter to continue.</Text>
        </Box>
      )}

      {step === "error" && (
        <Box marginTop={1}>
          <Text color="red">Export failed: {error}. Press Enter to go back.</Text>
        </Box>
      )}
    </Box>
  );
}
