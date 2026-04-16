import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { mkdirSync } from "fs";
import { join, resolve } from "path";
import {
  ensureInitialized,
  getFrozenInkHome,
  getCollectionDb,
  getCollectionDbPath,
  getCollection,
  addCollection,
  isValidCollectionKey,
  resolveCredentials,
} from "@frozenink/core";
import { createDefaultRegistry, MantisHubCrawler } from "@frozenink/crawlers";
import { SelectInput, type SelectItem } from "./SelectInput.js";
import { TextInput } from "./TextInput.js";
import { MultiSelectInput } from "./MultiSelectInput.js";

type Step =
  | "select-crawler"
  | "name"
  | "title"
  | "description"
  | "github-token"
  | "github-repo"
  | "github-open-only"
  | "github-max-issues"
  | "github-max-prs"
  | "obsidian-path"
  | "git-path"
  | "git-include-diffs"
  | "mantishub-url"
  | "mantishub-token"
  | "mantishub-sync-entities"
  | "mantishub-project-name"
  | "mantishub-max"
  | "confirm"
  | "validating"
  | "sync-prompt"
  | "done"
  | "error";

interface FormData {
  crawlerType: string;
  name: string;
  title: string;
  description: string;
  config: Record<string, unknown>;
  credentials: Record<string, unknown>;
}

function getStepsForCrawler(type: string): Step[] {
  const base: Step[] = ["select-crawler", "name", "title", "description"];
  switch (type) {
    case "github":
      return [...base, "github-token", "github-repo", "github-open-only", "github-max-issues", "github-max-prs", "confirm"];
    case "obsidian":
      return [...base, "obsidian-path", "confirm"];
    case "git":
      return [...base, "git-path", "git-include-diffs", "confirm"];
    case "mantishub":
      return [...base, "mantishub-url", "mantishub-token", "mantishub-sync-entities", "mantishub-project-name", "mantishub-max", "confirm"];
    default:
      return [...base, "confirm"];
  }
}

export function AddCollection({
  onDone,
  onSync,
}: {
  onDone: () => void;
  onSync?: (collectionName: string) => void;
}): React.ReactElement {
  const [step, setStep] = useState<Step>("select-crawler");
  const [data, setData] = useState<FormData>({
    crawlerType: "",
    name: "",
    title: "",
    description: "",
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
      case "description":
        setData((d) => ({ ...d, description: val }));
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
      case "mantishub-url":
        if (!val) { setError("URL is required"); return; }
        setData((d) => ({
          ...d,
          config: { ...d.config, url: val },
          credentials: { ...d.credentials, url: val, token: d.credentials.token ?? "" },
        }));
        nextStep();
        break;
      case "mantishub-token":
        setData((d) => ({ ...d, credentials: { ...d.credentials, token: val || "" } }));
        nextStep();
        break;
      case "mantishub-project-name": {
        if (val) {
          setData((d) => ({ ...d, config: { ...d.config, project: { name: val } } }));
        }
        nextStep();
        break;
      }
      case "mantishub-max": {
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

  const isMantisHubUrl = (data.config.url as string || "").includes(".mantishub.");

  const handleSyncEntitiesSubmit = useCallback(
    (selected: string[]) => {
      setData((d) => ({ ...d, config: { ...d.config, entities: selected } }));
      nextStep();
    },
    [nextStep],
  );

  const handleConfirm = useCallback(async () => {
    setStep("validating");
    try {
      const factory = registry.get(data.crawlerType);
      if (!factory) { setError("Unknown crawler"); setStep("error"); return; }
      const crawler = factory();
      const valid = await crawler.validateCredentials(data.credentials);
      if (!valid) { setError("Credential validation failed"); setStep("error"); return; }

      // Resolve MantisHub project name → ID and persist both
      const project = data.config.project as { id?: number; name?: string } | undefined;
      if (data.crawlerType === "mantishub" && project?.name) {
        await crawler.initialize(data.config, data.credentials);
        const resolved = await (crawler as MantisHubCrawler).resolveProjectName(project.name);
        data.config.project = { id: resolved.id, name: resolved.name };
      }

      const home = getFrozenInkHome();
      const dir = join(home, "collections", data.name);
      mkdirSync(dir, { recursive: true });
      getCollectionDb(getCollectionDbPath(data.name));
      mkdirSync(join(dir, "content"), { recursive: true });

      // For MantisHub, don't store url in credentials (it's already in config)
      const creds = { ...data.credentials };
      if (data.crawlerType === "mantishub") {
        delete creds.url;
        delete creds.baseUrl;
      }

      addCollection(data.name, {
        title: data.title || undefined,
        description: data.description || undefined,
        crawler: data.crawlerType,
        config: data.config,
        credentials: creds,
      });

      setMessage(`Collection "${data.name}" created!`);
      setStep("sync-prompt");
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
    if (step === "sync-prompt") {
      if (input === "y") {
        if (onSync) {
          onSync(data.name);
        }
        onDone();
      }
      if (input === "n" || key.escape || key.return) onDone();
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
        {step === "description" && (
          <TextInput label="Description (optional — helps AI know when to search this collection)" value={inputValue} onChange={setInputValue} onSubmit={handleTextSubmit} placeholder="e.g. GitHub issues and PRs for the acme/backend repo" />
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
        {step === "mantishub-url" && (
          <TextInput label="MantisHub base URL" value={inputValue} onChange={setInputValue} onSubmit={handleTextSubmit} placeholder="https://mantis.example.com" />
        )}
        {step === "mantishub-token" && (
          <TextInput label="API token (optional)" value={inputValue} onChange={setInputValue} onSubmit={handleTextSubmit} />
        )}
        {step === "mantishub-sync-entities" && (
          <MultiSelectInput
            label="Entity types to sync"
            items={[
              { label: "Issues", value: "issues" },
              { label: "Pages (wiki)", value: "pages", enabled: isMantisHubUrl },
              { label: "Users", value: "users" },
            ]}
            onSubmit={handleSyncEntitiesSubmit}
          />
        )}
        {step === "mantishub-project-name" && (
          <TextInput label="Project name (blank for all)" value={inputValue} onChange={setInputValue} onSubmit={handleTextSubmit} />
        )}
        {step === "mantishub-max" && (
          <TextInput label="Max entities (blank for unlimited)" value={inputValue} onChange={setInputValue} onSubmit={handleTextSubmit} />
        )}

        {step === "confirm" && (
          <Box flexDirection="column">
            <Text bold>Summary</Text>
            <Text>  Crawler: <Text color="cyan">{data.crawlerType}</Text></Text>
            {data.crawlerType === "mantishub" && !!data.config.url && (
              <Text>  URL:     <Text color="cyan">{String(data.config.url)}</Text></Text>
            )}
            <Text>  Name:    <Text color="cyan">{data.name}</Text></Text>
            {data.title && <Text>  Title:   <Text color="cyan">{data.title}</Text></Text>}
            {data.description && <Text>  Desc:    <Text color="cyan">{data.description}</Text></Text>}
            {Array.isArray(data.config.entities) && (
              <Text>  Sync:    <Text color="cyan">{(data.config.entities as string[]).join(", ")}</Text></Text>
            )}
            <Box marginTop={1}>
              <Text>Create this collection? (y/n)</Text>
            </Box>
          </Box>
        )}

        {step === "validating" && <Text color="yellow">Validating credentials...</Text>}
        {step === "sync-prompt" && (
          <Box flexDirection="column">
            <Text color="green">{message}</Text>
            <Box marginTop={1}>
              <Text>Run initial sync now? (y/n)</Text>
            </Box>
          </Box>
        )}
        {step === "done" && <Text color="green">{message} Press Enter to continue.</Text>}
        {step === "error" && <Text color="red">Error: {error}. Press Enter to go back.</Text>}
        {error && !["error", "done"].includes(step) && <Text color="red">{error}</Text>}
      </Box>
    </Box>
  );
}
