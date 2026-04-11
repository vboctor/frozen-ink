import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { getFrozenInkHome, loadConfig } from "@frozenink/core";
import { TextInput } from "./TextInput.js";

interface Settings {
  syncInterval: number;
  syncConcurrency: number;
  syncRetries: number;
  logLevel: string;
}

const LOG_LEVELS = ["debug", "info", "warn", "error"];

export function SettingsView(): React.ReactElement {
  const config = loadConfig();
  const syncConfig = (config as Record<string, unknown>).sync as Record<string, unknown> | undefined;
  const loggingConfig = (config as Record<string, unknown>).logging as Record<string, unknown> | undefined;

  const [settings, setSettings] = useState<Settings>({
    syncInterval: (syncConfig?.interval as number) ?? 900,
    syncConcurrency: (syncConfig?.concurrency as number) ?? 1,
    syncRetries: (syncConfig?.retries as number) ?? 3,
    logLevel: (loggingConfig?.level as string) ?? "info",
  });

  const [cursor, setCursor] = useState(0);
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [saved, setSaved] = useState(false);

  const fields = [
    { key: "syncInterval", label: "Sync interval (seconds)", value: String(settings.syncInterval) },
    { key: "syncConcurrency", label: "Sync concurrency", value: String(settings.syncConcurrency) },
    { key: "syncRetries", label: "Sync retries", value: String(settings.syncRetries) },
    { key: "logLevel", label: "Log level", value: settings.logLevel },
    { key: "save", label: "Save", value: "" },
  ];

  useInput((input, key) => {
    if (editing) return; // TextInput handles input
    if (key.upArrow) setCursor((c) => Math.max(0, c - 1));
    if (key.downArrow) setCursor((c) => Math.min(fields.length - 1, c + 1));
    if (key.return) {
      const field = fields[cursor];
      if (field.key === "save") {
        saveSettings();
      } else if (field.key === "logLevel") {
        // Cycle through log levels
        const idx = LOG_LEVELS.indexOf(settings.logLevel);
        const next = LOG_LEVELS[(idx + 1) % LOG_LEVELS.length];
        setSettings((s) => ({ ...s, logLevel: next }));
      } else {
        setInputValue(field.value);
        setEditing(true);
      }
    }
  });

  const handleEditSubmit = useCallback(() => {
    const field = fields[cursor];
    const val = inputValue.trim();

    if (field.key === "syncInterval") {
      const n = parseInt(val, 10);
      if (!isNaN(n) && n > 0) setSettings((s) => ({ ...s, syncInterval: n }));
    } else if (field.key === "syncConcurrency") {
      const n = parseInt(val, 10);
      if (!isNaN(n) && n > 0) setSettings((s) => ({ ...s, syncConcurrency: n }));
    } else if (field.key === "syncRetries") {
      const n = parseInt(val, 10);
      if (!isNaN(n) && n >= 0) setSettings((s) => ({ ...s, syncRetries: n }));
    }
    setEditing(false);
  }, [cursor, inputValue, fields]);

  const saveSettings = useCallback(() => {
    const configPath = join(getFrozenInkHome(), "config.json");
    let fileConfig: Record<string, unknown> = {};
    if (existsSync(configPath)) {
      fileConfig = JSON.parse(readFileSync(configPath, "utf-8"));
    }

    if (!fileConfig.sync || typeof fileConfig.sync !== "object") fileConfig.sync = {};
    const sync = fileConfig.sync as Record<string, unknown>;
    sync.interval = settings.syncInterval;
    sync.concurrency = settings.syncConcurrency;
    sync.retries = settings.syncRetries;

    if (!fileConfig.logging || typeof fileConfig.logging !== "object") fileConfig.logging = {};
    const logging = fileConfig.logging as Record<string, unknown>;
    logging.level = settings.logLevel;

    writeFileSync(configPath, JSON.stringify(fileConfig, null, 2));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [settings]);

  return (
    <Box flexDirection="column" paddingY={1}>
      <Text bold>Settings</Text>

      <Box flexDirection="column" marginTop={1}>
        {fields.map((field, i) => {
          if (editing && i === cursor) {
            return (
              <Box key={field.key}>
                <TextInput
                  label={field.label}
                  value={inputValue}
                  onChange={setInputValue}
                  onSubmit={handleEditSubmit}
                />
              </Box>
            );
          }

          const isSave = field.key === "save";
          return (
            <Box key={field.key} gap={1}>
              <Text color={i === cursor ? "cyan" : undefined}>
                {i === cursor ? "❯" : " "}
              </Text>
              {isSave ? (
                <Text bold color={i === cursor ? "green" : undefined}>
                  {saved ? "✓ Saved!" : "Save settings"}
                </Text>
              ) : (
                <>
                  <Text>{field.label}:</Text>
                  <Text bold color="cyan">{field.value}</Text>
                  {field.key === "logLevel" && <Text dimColor>(Enter to cycle)</Text>}
                </>
              )}
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>[↑↓] Navigate [Enter] Edit/Select</Text>
      </Box>
    </Box>
  );
}
