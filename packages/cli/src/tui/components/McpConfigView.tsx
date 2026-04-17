import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import { getCollection, getCollectionPublishState, updateCollection } from "@frozenink/core";
import {
  addMcpConnections,
  listAvailableMcpTools,
  listMcpConnections,
  removeMcpConnections,
  type AvailableToolInfo,
} from "../../mcp/manager";
import { normalizeMcpToolName, type McpToolName, type McpTransport } from "../../mcp/tools";
import { TextInput } from "./TextInput.js";

type Mode = "menu" | "edit-description" | "edit-password" | "busy";

export function McpConfigView({
  collectionName,
  onDone,
}: {
  collectionName: string;
  onDone: () => void;
}): React.ReactElement {
  const [mode, setMode] = useState<Mode>("menu");
  const [tools, setTools] = useState<AvailableToolInfo[]>([]);
  const [toolCursor, setToolCursor] = useState(0);
  const [transport, setTransport] = useState<McpTransport>("stdio");
  const [linked, setLinked] = useState(false);
  const [descriptionInput, setDescriptionInput] = useState(
    getCollection(collectionName)?.mcpToolDescription ?? "",
  );
  const [passwordInput, setPasswordInput] = useState("");
  const [message, setMessage] = useState("");
  const publishState = getCollectionPublishState(collectionName);

  const selectedTool = useMemo(() => {
    if (tools.length === 0) return null;
    return tools[Math.min(toolCursor, tools.length - 1)] ?? null;
  }, [toolCursor, tools]);

  const refreshTools = useCallback(async () => {
    const detected = await listAvailableMcpTools();
    setTools(detected);
    setToolCursor((current) => Math.min(current, Math.max(0, detected.length - 1)));
  }, []);

  const refreshLinked = useCallback(async (tool: McpToolName | undefined) => {
    if (!tool) {
      setLinked(false);
      return;
    }

    const statuses = await listMcpConnections(normalizeMcpToolName(tool));
    const row = statuses[0]?.links.find((link) => link.collection === collectionName);
    setLinked(!!row?.linked);
  }, [collectionName]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await refreshTools();
      } catch (err) {
        if (!cancelled) {
          setMessage(err instanceof Error ? err.message : String(err));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [refreshTools]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await refreshLinked(selectedTool?.tool);
      } catch (err) {
        if (!cancelled) {
          setMessage(err instanceof Error ? err.message : String(err));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [refreshLinked, selectedTool?.tool]);

  const runAddOrUpdate = useCallback(async () => {
    if (!selectedTool) return;
    setMode("busy");
    setMessage("");
    try {
      await addMcpConnections({
        tool: selectedTool.tool,
        collections: [collectionName],
        description: descriptionInput.trim() || undefined,
        transport,
        password: transport === "http" ? passwordInput.trim() || undefined : undefined,
      });
      setMessage(`Linked ${collectionName} to ${selectedTool.displayName} (${transport}).`);
      setPasswordInput("");
      await refreshLinked(selectedTool.tool);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setMode("menu");
    }
  }, [collectionName, descriptionInput, passwordInput, refreshLinked, selectedTool, transport]);

  const runRemove = useCallback(async () => {
    if (!selectedTool) return;
    setMode("busy");
    setMessage("");
    try {
      await removeMcpConnections({
        tool: selectedTool.tool,
        collections: [collectionName],
      });
      setMessage(`Removed MCP link for ${collectionName} from ${selectedTool.displayName}.`);
      await refreshLinked(selectedTool.tool);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setMode("menu");
    }
  }, [collectionName, refreshLinked, selectedTool]);

  useInput((input, key) => {
    if (mode === "menu") {
      if (key.escape) {
        onDone();
        return;
      }
      if (key.upArrow) {
        setToolCursor((current) => Math.max(0, current - 1));
      }
      if (key.downArrow) {
        setToolCursor((current) => Math.min(Math.max(0, tools.length - 1), current + 1));
      }
      if (input === "a") {
        runAddOrUpdate();
      }
      if (input === "r") {
        runRemove();
      }
      if (input === "d") {
        setMode("edit-description");
      }
      if (input === "t") {
        setTransport((current) => (current === "stdio" ? "http" : "stdio"));
      }
      if (input === "p") {
        if (transport === "http") setMode("edit-password");
      }
    }
  });

  const currentCollection = getCollection(collectionName);
  if (!currentCollection) {
    return <Text color="red">Collection "{collectionName}" not found.</Text>;
  }

  return (
    <Box flexDirection="column" paddingY={1}>
      <Text bold>MCP Config: {collectionName}</Text>
      <Text dimColor>
        Link this collection to an MCP client using `fink mcp serve --collection {collectionName}`.
      </Text>

      <Box flexDirection="column" marginTop={1}>
        <Text dimColor bold>Tool</Text>
        {tools.length === 0 && <Text dimColor>No MCP tools detected.</Text>}
        {tools.map((tool, index) => {
          const transportSupported = transport === "http" ? tool.supportsHttp : tool.supportsStdio;
          const dim = !transportSupported;
          return (
            <Box key={tool.tool} gap={1}>
              <Text color={index === toolCursor ? "cyan" : undefined}>
                {index === toolCursor ? "❯" : " "}
              </Text>
              <Text dimColor={dim}>{tool.displayName}</Text>
              <Text dimColor>({tool.tool})</Text>
              {!tool.available && <Text color="yellow">unavailable: {tool.reason ?? "not detected"}</Text>}
              {tool.available && !transportSupported && (
                <Text color="yellow">no {transport} support</Text>
              )}
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text>
          Transport: <Text color="cyan">{transport}</Text>
          {" "}
          <Text dimColor>(press t to toggle)</Text>
        </Text>
        {transport === "http" && (
          publishState ? (
            <>
              <Text dimColor>URL: {publishState.mcpUrl}</Text>
              {mode === "edit-password" ? (
                <TextInput
                  label="Password"
                  value={passwordInput}
                  onChange={setPasswordInput}
                  onSubmit={() => setMode("menu")}
                  placeholder="Bearer token (leave blank to use stored password)"
                />
              ) : (
                <Text dimColor>
                  Password: {passwordInput ? "(entered)" : publishState.protected ? "(stored password will be used)" : "(none — public site)"}
                </Text>
              )}
            </>
          ) : (
            <Text color="yellow">
              Collection is not published. Run `fink publish {collectionName}` first.
            </Text>
          )
        )}
      </Box>

      <Box marginTop={1}>
        <Text>
          Link status: <Text color={linked ? "green" : "yellow"}>{linked ? "linked" : "not linked"}</Text>
        </Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        {mode === "edit-description" ? (
          <TextInput
            label="Tool description"
            value={descriptionInput}
            onChange={setDescriptionInput}
            onSubmit={() => {
              const trimmed = descriptionInput.trim();
              updateCollection(collectionName, { mcpToolDescription: trimmed || undefined });
              setMessage("Saved collection MCP tool description.");
              setMode("menu");
            }}
            placeholder="Optional description shown to MCP clients"
          />
        ) : (
          <Text>
            Description: <Text dimColor>{currentCollection.mcpToolDescription ?? "(none)"}</Text>
          </Text>
        )}
      </Box>

      {mode === "busy" && (
        <Box marginTop={1}>
          <Text color="yellow">Working...</Text>
        </Box>
      )}

      {message && (
        <Box marginTop={1}>
          <Text color="green">{message}</Text>
        </Box>
      )}

      <Box marginTop={1} gap={2}>
        <Text dimColor>[a] Add/Update link</Text>
        <Text dimColor>[r] Remove link</Text>
        <Text dimColor>[d] Edit description</Text>
        <Text dimColor>[t] Toggle transport</Text>
        {transport === "http" && <Text dimColor>[p] Password</Text>}
        <Text dimColor>[↑↓] Tool</Text>
        <Text dimColor>[ESC] Back</Text>
      </Box>
    </Box>
  );
}
