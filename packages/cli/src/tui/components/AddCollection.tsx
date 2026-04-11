import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { mkdirSync } from "fs";
import { join, resolve } from "path";
import {
  contextExists,
  getFrozenInkHome,
  getCollectionDb,
  getCollectionDbPath,
  getCollection,
  addCollection,
  isValidCollectionKey,
} from "@frozenink/core";
import { createDefaultRegistry } from "@frozenink/crawlers";
import { SelectInput, type SelectItem } from "./SelectInput.js";
import { TextInput } from "./TextInput.js";

type Step =
  | "select-crawler"
  | "name"
  | "title"
  | "github-token"
  | "github-repo"
  | "github-open-only"
  | "github-max-issues"
  | "github-max-prs"
  | "obsidian-path"
  | "git-path"
  | "git-include-diffs"
  | "mantisbt-url"
  | "mantisbt-token"
  | "mantisbt-project-id"
  | "mantisbt-max"
  | "confirm"
  | "validating"
  | "done"
  | "error";

interface FormData {
  crawlerType: string;
  name: string;
  title: string;
  config: Record<string, unknown>;
  credentials: Record<string, unknown>;
}

function getStepsForCrawler(type: string): Step[] {
  const base: Step[] = ["select-crawler", "name", "title"];
  switch (type) {
    case "github":
      return [...base, "github-token", "github-repo", "github-open-only", "github-max-issues", "github-max-prs", "confirm"];
    case "obsidian":
      return [...base, "obsidian-path", "confirm"];
    case "git":
      return [...base, "git-path", "git-include-diffs", "confirm"];
    case "mantisbt":
      return [...base, "mantisbt-url", "mantisbt-token", "mantisbt-project-id", "mantisbt-max", "confirm"];
    default:
      return [...base, "confirm"];
  }
}

export function AddCollection({
  onDone,
}: {
  onDone: () => void;
}): React.ReactElement {
  const [step, setStep] = useState<Step>("select-crawler");
  const [data, setData] = useState<FormData>({
    crawlerType: "",
    name: "",
    title: "",
    config: {},
    credentials: {},
  });
  const [inputValue, setInputValue] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const registry = createDefaultRegistry();
  const crawlerTypes = registry.getRegisteredTypes();

  const nextStep = useCallback(() => {
    if (!data.crawlerType) return;
    const steps = getStepsForCrawler(data.crawlerType);
    const currentIdx = steps.indexOf(step);
    if (currentIdx < steps.length - 1) {
      setStep(steps[currentIdx + 1]);
      setInputValue("");
      setError("");
    }
  }, [step, data.crawlerType]);

  const handleCrawlerSelect = useCallback(
    (item: SelectItem) => {
      setData((d) => ({ ...d, crawlerType: item.value }));
      setStep("name");
      setInputValue("");
    },
    [],
  );

  const handleTextSubmit = useCallback(() => {
    const val = inputValue.trim();

    switch (step) {
      case "name": {
        if (!val) { setError("Name is required"); return; }
        if (!isValidCollectionKey(val)) { setError("Only letters, numbers, dashes, underscores"); return; }
        if (getCollection(val)) { setError(`"${val}" already exists`); return; }
        setData((d) => ({ ...d, name: val }));
        nextStep();
        break;
      }
      case "title":
        setData((d) => ({ ...d, title: val }));
        nextStep();
        break;
      case "github-token":
        if (!val) { setError("Token is required"); return; }
        setData((d) => ({ ...d, credentials: { ...d.credentials, token: val } }));
        nextStep();
        break;
      case "github-repo": {
        if (!val) { setError("Repo is required (owner/repo)"); return; }
        const parts = val.split("/");
        if (parts.length !== 2 || !parts[0] || !parts[1]) { setError("Format: owner/repo"); return; }
        setData((d) => ({
          ...d,
          config: { ...d.config, owner: parts[0], repo: parts[1] },
          credentials: { ...d.credentials, owner: parts[0], repo: parts[1] },
        }));
        nextStep();
        break;
      }
      case "github-open-only":
        if (val.toLowerCase() === "y" || val.toLowerCase() === "yes") {
          setData((d) => ({ ...d, config: { ...d.config, openOnly: true } }));
        }
        nextStep();
        break;
      case "github-max-issues": {
        if (val) {
          const n = parseInt(val, 10);
          if (isNaN(n) || n < 1) { setError("Enter a positive number or leave blank"); return; }
          setData((d) => ({ ...d, config: { ...d.config, maxIssues: n } }));
        }
        nextStep();
        break;
      }
      case "github-max-prs": {
        if (val) {
          const n = parseInt(val, 10);
          if (isNaN(n) || n < 1) { setError("Enter a positive number or leave blank"); return; }
          setData((d) => ({ ...d, config: { ...d.config, maxPullRequests: n } }));
        }
        nextStep();
        break;
      }
      case "obsidian-path":
        if (!val) { setError("Path is required"); return; }
        setData((d) => ({
          ...d,
          config: { ...d.config, vaultPath: resolve(val) },
          credentials: { ...d.credentials, vaultPath: resolve(val) },
        }));
        nextStep();
        break;
      case "git-path":
        if (!val) { setError("Path is required"); return; }
        setData((d) => ({
          ...d,
          config: { ...d.config, repoPath: resolve(val) },
          credentials: { ...d.credentials, repoPath: resolve(val) },
        }));
        nextStep();
        break;
      case "git-include-diffs":
        if (val.toLowerCase() === "y" || val.toLowerCase() === "yes") {
          setData((d) => ({ ...d, config: { ...d.config, includeDiffs: true } }));
        }
        nextStep();
        break;
      case "mantisbt-url":
        if (!val) { setError("URL is required"); return; }
        setData((d) => ({
          ...d,
          config: { ...d.config, baseUrl: val },
          credentials: { ...d.credentials, baseUrl: val },
        }));
        nextStep();
        break;
      case "mantisbt-token":
        setData((d) => ({ ...d, credentials: { ...d.credentials, token: val || "" } }));
        nextStep();
        break;
      case "mantisbt-project-id": {
        if (val) {
          const n = parseInt(val, 10);
          if (isNaN(n) || n < 1) { setError("Enter a positive number or leave blank"); return; }
          setData((d) => ({ ...d, config: { ...d.config, projectId: n } }));
        }
        nextStep();
        break;
      }
      case "mantisbt-max": {
        if (val) {
          const n = parseInt(val, 10);
          if (isNaN(n) || n < 1) { setError("Enter a positive number or leave blank"); return; }
          setData((d) => ({ ...d, config: { ...d.config, maxEntities: n } }));
        }
        nextStep();
        break;
      }
    }
  }, [step, inputValue, nextStep]);

  const handleConfirm = useCallback(async () => {
    setStep("validating");
    try {
      const factory = registry.get(data.crawlerType);
      if (!factory) { setError("Unknown crawler"); setStep("error"); return; }
      const crawler = factory();
      const valid = await crawler.validateCredentials(data.credentials);
      if (!valid) { setError("Credential validation failed"); setStep("error"); return; }

      const home = getFrozenInkHome();
      const dir = join(home, "collections", data.name);
      mkdirSync(dir, { recursive: true });
      getCollectionDb(getCollectionDbPath(data.name));
      mkdirSync(join(dir, "markdown"), { recursive: true });

      addCollection(data.name, {
        title: data.title || undefined,
        crawler: data.crawlerType,
        config: data.config,
        credentials: data.credentials,
      });

      setMessage(`Collection "${data.name}" created!`);
      setStep("done");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setStep("error");
    }
  }, [data, registry]);

  useInput((input, key) => {
    if (step === "confirm") {
      if (input === "y") handleConfirm();
      if (input === "n" || key.escape) onDone();
    }
    if (step === "done" || step === "error") {
      if (key.return || key.escape) onDone();
    }
  });

  return (
    <Box flexDirection="column" paddingY={1}>
      <Text bold>Add Collection</Text>
      <Box marginTop={1} flexDirection="column">
        {step === "select-crawler" && (
          <SelectInput
            label="Select crawler type"
            items={crawlerTypes.map((t: string) => ({ label: t, value: t }))}
            onSelect={handleCrawlerSelect}
          />
        )}

        {step === "name" && (
          <TextInput label="Collection name" value={inputValue} onChange={setInputValue} onSubmit={handleTextSubmit} placeholder="my-collection" />
        )}
        {step === "title" && (
          <TextInput label="Display title (optional)" value={inputValue} onChange={setInputValue} onSubmit={handleTextSubmit} placeholder="My Collection" />
        )}
        {step === "github-token" && (
          <TextInput label="GitHub token" value={inputValue} onChange={setInputValue} onSubmit={handleTextSubmit} mask />
        )}
        {step === "github-repo" && (
          <TextInput label="Repository (owner/repo)" value={inputValue} onChange={setInputValue} onSubmit={handleTextSubmit} placeholder="owner/repo" />
        )}
        {step === "github-open-only" && (
          <TextInput label="Only sync open issues/PRs? (y/N)" value={inputValue} onChange={setInputValue} onSubmit={handleTextSubmit} />
        )}
        {step === "github-max-issues" && (
          <TextInput label="Max issues (blank for unlimited)" value={inputValue} onChange={setInputValue} onSubmit={handleTextSubmit} />
        )}
        {step === "github-max-prs" && (
          <TextInput label="Max PRs (blank for unlimited)" value={inputValue} onChange={setInputValue} onSubmit={handleTextSubmit} />
        )}
        {step === "obsidian-path" && (
          <TextInput label="Vault path" value={inputValue} onChange={setInputValue} onSubmit={handleTextSubmit} placeholder="/path/to/vault" />
        )}
        {step === "git-path" && (
          <TextInput label="Repository path" value={inputValue} onChange={setInputValue} onSubmit={handleTextSubmit} placeholder="/path/to/repo" />
        )}
        {step === "git-include-diffs" && (
          <TextInput label="Include commit diffs? (y/N)" value={inputValue} onChange={setInputValue} onSubmit={handleTextSubmit} />
        )}
        {step === "mantisbt-url" && (
          <TextInput label="MantisBT base URL" value={inputValue} onChange={setInputValue} onSubmit={handleTextSubmit} placeholder="https://mantis.example.com" />
        )}
        {step === "mantisbt-token" && (
          <TextInput label="API token (optional)" value={inputValue} onChange={setInputValue} onSubmit={handleTextSubmit} />
        )}
        {step === "mantisbt-project-id" && (
          <TextInput label="Project ID (blank for all)" value={inputValue} onChange={setInputValue} onSubmit={handleTextSubmit} />
        )}
        {step === "mantisbt-max" && (
          <TextInput label="Max entities (blank for unlimited)" value={inputValue} onChange={setInputValue} onSubmit={handleTextSubmit} />
        )}

        {step === "confirm" && (
          <Box flexDirection="column">
            <Text bold>Summary</Text>
            <Text>  Crawler: <Text color="cyan">{data.crawlerType}</Text></Text>
            <Text>  Name:    <Text color="cyan">{data.name}</Text></Text>
            {data.title && <Text>  Title:   <Text color="cyan">{data.title}</Text></Text>}
            <Box marginTop={1}>
              <Text>Create this collection? (y/n)</Text>
            </Box>
          </Box>
        )}

        {step === "validating" && <Text color="yellow">Validating credentials...</Text>}
        {step === "done" && <Text color="green">{message} Press Enter to continue.</Text>}
        {step === "error" && <Text color="red">Error: {error}. Press Enter to go back.</Text>}
        {error && !["error", "done"].includes(step) && <Text color="red">{error}</Text>}
      </Box>
    </Box>
  );
}
