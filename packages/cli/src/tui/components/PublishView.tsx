import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { exec } from "child_process";
import {
  ensureInitialized,
  listCollections,
  listPublishedCollections,
  getCollectionPublishState,
} from "@frozenink/core";
import { publishCollections, type PublishOptions } from "../../commands/publish.js";
import { unpublishCollection } from "../../commands/unpublish.js";
import { TextInput } from "./TextInput.js";

type View = "list" | "publish-wizard";
type WizardStep = "select-collection" | "password" | "confirm" | "publishing" | "done" | "error";
type ListMode = "list" | "confirm-delete" | "deleting" | "done-delete" | "error-delete";

export function PublishView({
  onDone,
}: {
  onDone: () => void;
}): React.ReactElement {
  const [view, setView] = useState<View>("list");

  // --- Published list state ---
  const [cursor, setCursor] = useState(0);
  const [listMode, setListMode] = useState<ListMode>("list");
  const [listProgress, setListProgress] = useState<string[]>([]);
  const [listError, setListError] = useState("");
  const [listMessage, setListMessage] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  // --- Publish wizard state ---
  const [wizStep, setWizStep] = useState<WizardStep>("select-collection");
  const [collCursor, setCollCursor] = useState(0);
  const [selectedCollection, setSelectedCollection] = useState("");
  const [password, setPassword] = useState("");
  const [pubProgress, setPubProgress] = useState<string[]>([]);
  const [pubError, setPubError] = useState("");
  const [pubResult, setPubResult] = useState<{ workerUrl: string; mcpUrl: string } | null>(null);
  const [inputValue, setInputValue] = useState("");

  ensureInitialized();

  const allCollections = listCollections().filter((c: { enabled: boolean }) => c.enabled);
  const publishedCollections = listPublishedCollections();
  const currentPub = publishedCollections[cursor];

  // --- Unpublish ---
  const doUnpublish = useCallback(async () => {
    if (!currentPub) return;
    setListMode("deleting");
    setListProgress([]);
    try {
      const publishState = getCollectionPublishState(currentPub.name);
      if (!publishState) { setListError("Collection is not published"); setListMode("error-delete"); return; }
      await unpublishCollection(currentPub.name, publishState, (step, detail) => setListProgress((p) => [...p, `[${step}] ${detail}`]));
      setListMessage(`Collection "${currentPub.name}" unpublished.`);
      setListMode("done-delete");
    } catch (err: unknown) {
      setListError(err instanceof Error ? err.message : String(err));
      setListMode("error-delete");
    }
  }, [currentPub]);

  // --- Publish ---
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
        collectionName: selectedCollection,
        password: password || undefined,
        forcePublic: !password,
      };
      const res = await publishCollections(opts, (s, detail) => setPubProgress((p) => [...p, `[${s}] ${detail}`]));
      setPubResult({ workerUrl: res.workerUrl, mcpUrl: res.mcpUrl });
      setWizStep("done");
    } catch (err: unknown) {
      setPubError(err instanceof Error ? err.message : String(err));
      setWizStep("error");
    }
  }, [selectedCollection, password]);

  const resetWizard = useCallback(() => {
    setWizStep("select-collection");
    setCollCursor(0);
    setSelectedCollection("");
    setPassword("");
    setPubProgress([]);
    setPubError("");
    setPubResult(null);
    setInputValue("");
    setView("list");
    setRefreshKey((k) => k + 1);
  }, []);

  // --- Input ---
  useInput((input, key) => {
    // ── Published list view ──
    if (view === "list") {
      if (listMode === "list") {
        if (key.upArrow && publishedCollections.length > 0) setCursor((c) => Math.max(0, c - 1));
        if (key.downArrow && publishedCollections.length > 0) setCursor((c) => Math.min(publishedCollections.length - 1, c + 1));
        if (input === "d" && currentPub) setListMode("confirm-delete");
        if (key.return && currentPub?.publish) {
          const url = currentPub.publish.url;
          const cmd = process.platform === "darwin" ? `open "${url}"` : process.platform === "win32" ? `start "${url}"` : `xdg-open "${url}"`;
          exec(cmd);
        }
        if (input === "n") {
          setView("publish-wizard");
          setWizStep("select-collection");
        }
        if (input === "p" && currentPub) {
          setSelectedCollection(currentPub.name);
          setPassword("");
          setWizStep("confirm");
          setView("publish-wizard");
        }
      }
      if (listMode === "confirm-delete") {
        if (input === "y") doUnpublish();
        else setListMode("list");
      }
      if (listMode === "done-delete" || listMode === "error-delete") {
        if (key.return || key.escape) {
          setListMode("list");
          setListProgress([]);
          setListError("");
          setListMessage("");
          setRefreshKey((k) => k + 1);
          setCursor(Math.max(0, cursor - 1));
        }
      }
      return;
    }

    // ── Publish wizard view ──
    if (wizStep === "select-collection") {
      if (key.upArrow) setCollCursor((c) => Math.max(0, c - 1));
      if (key.downArrow) setCollCursor((c) => Math.min(allCollections.length - 1, c + 1));
      if (key.escape) { setView("list"); return; }
      if (key.return && allCollections[collCursor]) {
        setSelectedCollection(allCollections[collCursor].name);
        setWizStep("password");
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

  // ── Render: Published list ──
  if (view === "list") {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Text bold>Publish</Text>

        {publishedCollections.length === 0 ? (
          <Box marginTop={1}><Text dimColor>No published collections.</Text></Box>
        ) : (
          <>
            <Box flexDirection="column" marginTop={1}>
              {publishedCollections.map((col, i: number) => (
                <Box key={col.name} gap={1}>
                  <Text color={i === cursor ? "cyan" : undefined}>{i === cursor ? ">" : " "}</Text>
                  <Text bold={i === cursor}>{col.name}</Text>
                  <Text color={col.publish?.password?.protected ? "green" : "yellow"}>
                    [{col.publish?.password?.protected ? "protected" : "public"}]
                  </Text>
                  <Text dimColor>{col.publish?.url?.replace("https://", "")}</Text>
                </Box>
              ))}
            </Box>

            {currentPub && currentPub.publish && (listMode === "list" || listMode === "confirm-delete") && (
              <Box flexDirection="column" marginTop={1} marginLeft={2} borderStyle="single" borderColor="gray" paddingX={1}>
                <Text bold>{currentPub.name}</Text>
                <Text>URL: <Text color="blue">{currentPub.publish.url}</Text></Text>
                <Text>MCP: <Text color="blue">{currentPub.publish.mcpUrl}</Text></Text>
                <Text>Published: <Text dimColor>{currentPub.publish.publishedAt}</Text></Text>
              </Box>
            )}
          </>
        )}

        {listMode === "confirm-delete" && (
          <Box marginTop={1}><Text color="red">Unpublish "{currentPub?.name}" and delete its Cloudflare resources (worker, D1, R2)? (y/N)</Text></Box>
        )}
        {listMode === "deleting" && (
          <Box flexDirection="column" marginTop={1}>
            <Text color="yellow">Deleting...</Text>
            {listProgress.map((l, i) => <Text key={i} dimColor>{l}</Text>)}
          </Box>
        )}
        {listMode === "done-delete" && <Box marginTop={1}><Text color="green">{listMessage} Press Enter.</Text></Box>}
        {listMode === "error-delete" && <Box marginTop={1}><Text color="red">Error: {listError}. Press Enter.</Text></Box>}

        <Box marginTop={1} gap={2}>
          <Text dimColor>[n] New publish</Text>
          {publishedCollections.length > 0 && <Text dimColor>[p] Republish</Text>}
          {publishedCollections.length > 0 && <Text dimColor>[Enter] Open</Text>}
          {publishedCollections.length > 0 && <Text dimColor>[d] Unpublish</Text>}
        </Box>
      </Box>
    );
  }

  // ── Render: Publish wizard ──
  return (
    <Box flexDirection="column" paddingY={1}>
      <Text bold>Publish Collection</Text>

      {wizStep === "select-collection" && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>Select a collection to publish (Enter to continue, ESC back)</Text>
          {allCollections.map((col, i: number) => (
            <Box key={col.name} gap={1}>
              <Text color={i === collCursor ? "cyan" : undefined}>{i === collCursor ? ">" : " "}</Text>
              <Text>{col.name}</Text>
              {col.publish && <Text color="green">(published)</Text>}
            </Box>
          ))}
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
          <Text>  Collection: {selectedCollection}</Text>
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
