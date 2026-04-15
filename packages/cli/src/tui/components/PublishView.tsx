import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { existsSync, statSync, readdirSync } from "fs";
import { join } from "path";
import { exec } from "child_process";
import {
  ensureInitialized,
  listCollections,
  listSites,
  getSite,
  getCollection,
  getCollectionDb,
  getCollectionDbPath,
  getFrozenInkHome,
  entities,
} from "@frozenink/core";
import { sql } from "drizzle-orm";
import { publishCollections, type PublishOptions } from "../../commands/publish.js";
import { unpublishDeployment } from "../../commands/unpublish.js";
import { TextInput } from "./TextInput.js";

type View = "deployments" | "publish-wizard";
type WizardStep = "select-mode" | "select-collections" | "worker-name" | "password" | "confirm" | "publishing" | "done" | "error";
type DeploymentMode = "list" | "confirm-delete" | "deleting" | "done-delete" | "error-delete";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getDirectorySize(dirPath: string): number {
  if (!existsSync(dirPath)) return 0;
  let total = 0;
  try {
    for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
      const full = join(dirPath, entry.name);
      if (entry.isDirectory()) total += getDirectorySize(full);
      else try { total += statSync(full).size; } catch {}
    }
  } catch {}
  return total;
}

function getCollectionStats(name: string): { entityCount: number; diskSize: number; lastSyncAt: string | null } {
  const dbPath = getCollectionDbPath(name);
  let entityCount = 0;
  let diskSize = 0;
  let lastSyncAt: string | null = null;
  if (existsSync(dbPath)) {
    try {
      const colDb = getCollectionDb(dbPath);
      const [{ total }] = colDb.select({ total: sql<number>`count(*)` }).from(entities).all();
      entityCount = total;
    } catch {}
    try { diskSize += statSync(dbPath).size; } catch {}
  }
  lastSyncAt = getCollection(name)?.lastSyncAt ?? null;
  const home = getFrozenInkHome();
  const colDir = join(home, "collections", name);
  diskSize += getDirectorySize(join(colDir, "markdown"));
  diskSize += getDirectorySize(join(colDir, "attachments"));
  return { entityCount, diskSize, lastSyncAt };
}

function formatRelative(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

export function PublishView({
  onDone,
}: {
  onDone: () => void;
}): React.ReactElement {
  const [view, setView] = useState<View>("deployments");

  // --- Deployment list state ---
  const [depCursor, setDepCursor] = useState(0);
  const [depMode, setDepMode] = useState<DeploymentMode>("list");
  const [depProgress, setDepProgress] = useState<string[]>([]);
  const [depError, setDepError] = useState("");
  const [depMessage, setDepMessage] = useState("");
  const [depRefresh, setDepRefresh] = useState(0);

  // --- Publish wizard state ---
  const [wizStep, setWizStep] = useState<WizardStep>("select-mode");
  const [modeCursor, setModeCursor] = useState(0);
  const [selectedCollections, setSelectedCollections] = useState<Set<string>>(new Set());
  const [collCursor, setCollCursor] = useState(0);
  const [workerName, setWorkerName] = useState("");
  const [password, setPassword] = useState("");
  const [workerOnly, setWorkerOnly] = useState(false);
  const [pubProgress, setPubProgress] = useState<string[]>([]);
  const [pubError, setPubError] = useState("");
  const [pubResult, setPubResult] = useState<{ workerUrl: string; mcpUrl: string } | null>(null);
  const [inputValue, setInputValue] = useState("");

  ensureInitialized();

  const collections = listCollections().filter((c: { enabled: boolean }) => c.enabled).map((c: { name: string }) => c.name);
  const deployments = listSites();
  const depNames = deployments.map((d: { name: string }) => d.name);
  const currentDep = deployments[depCursor];

  // Stats for selected deployment
  let totalEntities = 0;
  let totalSize = 0;
  let isOutdated = false;
  const collectionDetails: Array<{ name: string; entityCount: number; diskSize: number; lastSyncAt: string | null; syncedAfterPublish: boolean }> = [];
  if (currentDep && view === "deployments") {
    const publishedAt = currentDep.publishedAt ? new Date(currentDep.publishedAt) : null;
    for (const cn of currentDep.collections) {
      const s = getCollectionStats(cn);
      const syncDate = s.lastSyncAt ? new Date(s.lastSyncAt + "Z") : null;
      const syncedAfterPublish = !!(syncDate && publishedAt && syncDate > publishedAt);
      if (syncedAfterPublish) isOutdated = true;
      collectionDetails.push({ name: cn, entityCount: s.entityCount, diskSize: s.diskSize, lastSyncAt: s.lastSyncAt, syncedAfterPublish });
      totalEntities += s.entityCount;
      totalSize += s.diskSize;
    }
  }

  // Publish wizard modes
  const publishModes = [
    { label: "New deployment", value: "new" },
    ...(depNames.length > 0 ? [
      { label: "Update existing deployment", value: "update" },
      { label: "Re-deploy worker code only", value: "worker-only" },
    ] : []),
  ];

  // --- Unpublish ---
  const doUnpublish = useCallback(async () => {
    if (!currentDep) return;
    setDepMode("deleting");
    setDepProgress([]);
    try {
      const dep = getSite(currentDep.name);
      if (!dep) { setDepError("Deployment not found"); setDepMode("error-delete"); return; }
      await unpublishDeployment(dep, (step, detail) => setDepProgress((p) => [...p, `[${step}] ${detail}`]));
      setDepMessage(`Deployment "${currentDep.name}" removed.`);
      setDepMode("done-delete");
    } catch (err: unknown) {
      setDepError(err instanceof Error ? err.message : String(err));
      setDepMode("error-delete");
    }
  }, [currentDep]);

  // --- Publish ---
  const handleWorkerNameSubmit = useCallback(() => {
    setWorkerName(inputValue.trim() || workerName);
    setInputValue("");
    setWizStep("password");
  }, [inputValue, workerName]);

  const handlePasswordSubmit = useCallback(() => {
    setPassword(inputValue.trim());
    setInputValue("");
    setWizStep("confirm");
  }, [inputValue]);

  const doPublish = useCallback(async () => {
    setWizStep("publishing");
    setPubProgress([]);
    try {
      const opts: PublishOptions = {
        collectionNames: [...selectedCollections],
        workerName,
        password: password || undefined,
        forcePublic: !password,
        workerOnly,
      };
      const res = await publishCollections(opts, (s, detail) => setPubProgress((p) => [...p, `[${s}] ${detail}`]));
      setPubResult({ workerUrl: res.workerUrl, mcpUrl: res.mcpUrl });
      setWizStep("done");
    } catch (err: unknown) {
      setPubError(err instanceof Error ? err.message : String(err));
      setWizStep("error");
    }
  }, [selectedCollections, workerName, password, workerOnly]);

  const resetWizard = useCallback(() => {
    setWizStep("select-mode");
    setModeCursor(0);
    setSelectedCollections(new Set());
    setCollCursor(0);
    setWorkerName("");
    setPassword("");
    setWorkerOnly(false);
    setPubProgress([]);
    setPubError("");
    setPubResult(null);
    setInputValue("");
    setView("deployments");
    setDepRefresh((k) => k + 1);
  }, []);

  // --- Input ---
  useInput((input, key) => {
    // ── Deployment list view ──
    if (view === "deployments") {
      if (depMode === "list") {
        if (key.upArrow && deployments.length > 0) setDepCursor((c) => Math.max(0, c - 1));
        if (key.downArrow && deployments.length > 0) setDepCursor((c) => Math.min(deployments.length - 1, c + 1));
        if (input === "d" && currentDep) setDepMode("confirm-delete");
        if (key.return && currentDep) {
          // Open deployment URL in default browser
          const url = currentDep.url;
          const cmd = process.platform === "darwin" ? `open "${url}"` : process.platform === "win32" ? `start "${url}"` : `xdg-open "${url}"`;
          exec(cmd);
        }
        if (input === "n") {
          setView("publish-wizard");
          setWizStep("select-mode");
        }
        if (input === "p" && currentDep) {
          // Republish: update the current deployment with its existing collections
          setSelectedCollections(new Set(currentDep.collections));
          setWorkerName(currentDep.name);
          setWorkerOnly(false);
          // Preserve existing password hash by not setting a new password
          setPassword("");
          setWizStep("confirm");
          setView("publish-wizard");
        }
      }
      if (depMode === "confirm-delete") {
        if (input === "y") doUnpublish();
        else setDepMode("list");
      }
      if (depMode === "done-delete" || depMode === "error-delete") {
        if (key.return || key.escape) {
          setDepMode("list");
          setDepProgress([]);
          setDepError("");
          setDepMessage("");
          setDepRefresh((k) => k + 1);
          setDepCursor(Math.max(0, depCursor - 1));
        }
      }
      return;
    }

    // ── Publish wizard view ──
    if (wizStep === "select-mode") {
      if (key.upArrow) setModeCursor((c) => Math.max(0, c - 1));
      if (key.downArrow) setModeCursor((c) => Math.min(publishModes.length - 1, c + 1));
      if (key.escape) { setView("deployments"); return; }
      if (key.return) {
        const mode = publishModes[modeCursor].value;
        setWorkerOnly(mode === "worker-only");
        if (mode === "worker-only" || mode === "update") {
          if (depNames.length > 0) {
            setWorkerName(depNames[0]);
            if (mode === "worker-only") setWizStep("confirm");
            else setWizStep("select-collections");
          }
        } else {
          setWizStep("select-collections");
        }
      }
    }
    if (wizStep === "select-collections") {
      if (key.upArrow) setCollCursor((c) => Math.max(0, c - 1));
      if (key.downArrow) setCollCursor((c) => Math.min(collections.length - 1, c + 1));
      if (key.escape) { setWizStep("select-mode"); return; }
      if (input === " ") {
        const name = collections[collCursor];
        setSelectedCollections((prev) => { const next = new Set(prev); if (next.has(name)) next.delete(name); else next.add(name); return next; });
      }
      if (key.return && selectedCollections.size > 0) {
        if (!workerName) setInputValue(`fink-${[...selectedCollections][0]}-${Math.random().toString(36).slice(2, 8)}`);
        setWizStep("worker-name");
      }
    }
    if (wizStep === "confirm") {
      if (input === "y") doPublish();
      if (input === "n" || key.escape) resetWizard();
    }
    if (wizStep === "done" || wizStep === "error") {
      if (key.return || key.escape) resetWizard();
    }
  });

  // ── Render: Deployment list ──
  if (view === "deployments") {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Text bold>Publish</Text>

        {deployments.length === 0 ? (
          <Box marginTop={1}><Text dimColor>No deployments yet.</Text></Box>
        ) : (
          <>
            <Box flexDirection="column" marginTop={1}>
              {deployments.map((dep: { name: string; url: string; collections: string[]; password?: { protected: boolean }; publishedAt: string; mcpUrl: string }, i: number) => {
                let depEntities = 0;
                let depSize = 0;
                for (const cn of dep.collections) { const s = getCollectionStats(cn); depEntities += s.entityCount; depSize += s.diskSize; }
                return (
                  <Box key={dep.name} gap={1}>
                    <Text color={i === depCursor ? "cyan" : undefined}>{i === depCursor ? "❯" : " "}</Text>
                    <Text bold={i === depCursor}>{dep.name}</Text>
                    <Text color={dep.password?.protected ? "green" : "yellow"}>[{dep.password?.protected ? "protected" : "public"}]</Text>
                    <Text dimColor>{depEntities} entities</Text>
                    <Text dimColor>{formatSize(depSize)}</Text>
                  </Box>
                );
              })}
            </Box>

            {currentDep && (depMode === "list" || depMode === "confirm-delete") && (
              <Box flexDirection="column" marginTop={1} marginLeft={2} borderStyle="single" borderColor="gray" paddingX={1}>
                <Box gap={2}>
                  <Text bold>{currentDep.name}</Text>
                  {isOutdated && <Text color="yellow" bold>outdated</Text>}
                </Box>
                <Text>URL: <Text color="blue">{currentDep.url}</Text></Text>
                <Text>MCP: <Text color="blue">{currentDep.mcpUrl}</Text></Text>
                <Text>Published: <Text dimColor>{currentDep.publishedAt}</Text></Text>
                <Text>Total: <Text bold>{totalEntities} entities</Text><Text dimColor> ({formatSize(totalSize)})</Text></Text>
                <Box flexDirection="column" marginTop={1}>
                  <Text dimColor bold>Collections:</Text>
                  {collectionDetails.map((cd) => {
                    const syncLabel = cd.lastSyncAt
                      ? formatRelative(new Date(cd.lastSyncAt + "Z"))
                      : "never";
                    return (
                      <Box key={cd.name} gap={1} marginLeft={1}>
                        <Text>{cd.name}</Text>
                        <Text dimColor>{cd.entityCount} entities ({formatSize(cd.diskSize)})</Text>
                        <Text dimColor>synced {syncLabel}</Text>
                        {cd.syncedAfterPublish && <Text color="yellow">*</Text>}
                      </Box>
                    );
                  })}
                </Box>
                {isOutdated && (
                  <Text color="yellow" dimColor>* synced after publish — press [p] to republish</Text>
                )}
              </Box>
            )}
          </>
        )}

        {depMode === "confirm-delete" && (
          <Box marginTop={1}><Text color="red">Delete "{currentDep?.name}" and its Cloudflare resources (worker, D1, R2)? (y/N)</Text></Box>
        )}
        {depMode === "deleting" && (
          <Box flexDirection="column" marginTop={1}>
            <Text color="yellow">Deleting...</Text>
            {depProgress.map((l, i) => <Text key={i} dimColor>{l}</Text>)}
          </Box>
        )}
        {depMode === "done-delete" && <Box marginTop={1}><Text color="green">{depMessage} Press Enter.</Text></Box>}
        {depMode === "error-delete" && <Box marginTop={1}><Text color="red">Error: {depError}. Press Enter.</Text></Box>}

        <Box marginTop={1} gap={2}>
          <Text dimColor>[n] New publish</Text>
          {deployments.length > 0 && <Text dimColor>[p] Republish</Text>}
          {deployments.length > 0 && <Text dimColor>[Enter] Open</Text>}
          {deployments.length > 0 && <Text dimColor>[d] Delete</Text>}
          {deployments.length > 0 && <Text dimColor>[↑↓] Navigate</Text>}
        </Box>
      </Box>
    );
  }

  // ── Render: Publish wizard ──
  return (
    <Box flexDirection="column" paddingY={1}>
      <Text bold>New Publish</Text>

      {wizStep === "select-mode" && (
        <Box flexDirection="column" marginTop={1}>
          {publishModes.map((m, i) => (
            <Box key={m.value}>
              <Text color={i === modeCursor ? "cyan" : undefined}>{i === modeCursor ? "❯ " : "  "}{m.label}</Text>
            </Box>
          ))}
          <Box marginTop={1}><Text dimColor>ESC back</Text></Box>
        </Box>
      )}

      {wizStep === "select-collections" && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>Select collections (Space toggle, Enter continue, ESC back)</Text>
          {collections.map((name: string, i: number) => (
            <Box key={name} gap={1}>
              <Text color={i === collCursor ? "cyan" : undefined}>{i === collCursor ? "❯" : " "}</Text>
              <Text>{selectedCollections.has(name) ? "[x]" : "[ ]"}</Text>
              <Text>{name}</Text>
            </Box>
          ))}
        </Box>
      )}

      {wizStep === "worker-name" && (
        <Box marginTop={1}>
          <TextInput label="Worker name" value={inputValue} onChange={setInputValue} onSubmit={handleWorkerNameSubmit} placeholder={workerName} />
        </Box>
      )}

      {wizStep === "password" && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>Leave blank for public access</Text>
          <TextInput label="Password" value={inputValue} onChange={setInputValue} onSubmit={handlePasswordSubmit} mask />
        </Box>
      )}

      {wizStep === "confirm" && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Summary</Text>
          {!workerOnly && <Text>  Collections: {[...selectedCollections].join(", ")}</Text>}
          <Text>  Worker: {workerName}</Text>
          {workerOnly && <Text>  Mode: Worker code only</Text>}
          {password && <Text>  Protected: Yes</Text>}
          <Box marginTop={1}><Text>Proceed? (y/n)</Text></Box>
        </Box>
      )}

      {wizStep === "publishing" && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="yellow">Publishing...</Text>
          {pubProgress.map((l, i) => <Text key={i} dimColor>{l}</Text>)}
        </Box>
      )}

      {wizStep === "done" && pubResult && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="green" bold>Published successfully!</Text>
          <Text>Website: <Text color="blue">{pubResult.workerUrl}</Text></Text>
          <Text>MCP URL: <Text color="blue">{pubResult.mcpUrl}</Text></Text>
          <Box marginTop={1}><Text dimColor>Press Enter to continue</Text></Box>
        </Box>
      )}

      {wizStep === "error" && (
        <Box marginTop={1}><Text color="red">Publish failed: {pubError}. Press Enter.</Text></Box>
      )}
    </Box>
  );
}
