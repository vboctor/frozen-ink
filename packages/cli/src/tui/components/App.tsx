import React, { useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import {
  ensureInitialized,
  listCollections,
} from "@frozenink/core";
import { CollectionList } from "./CollectionList.js";
import { SyncView } from "./SyncView.js";
import { PublishView } from "./PublishView.js";
import { SettingsView } from "./SettingsView.js";
import { SearchView } from "./SearchView.js";

export type Screen =
  | "home"
  | "collections"
  | "sync"
  | "publish"
  | "settings"
  | "search";

interface MenuItem {
  key: string;
  label: string;
  description: string;
  screen: Screen;
  requiresCollections?: boolean;
}

const ALL_MENU_ITEMS: MenuItem[] = [
  { key: "c", label: "Collections", description: "View, manage, add, export, and sync your data sources", screen: "collections" },
  { key: "s", label: "Sync", description: "Sync all enabled collections at once", screen: "sync", requiresCollections: true },
  { key: "f", label: "Search", description: "Full-text search across all synced content", screen: "search", requiresCollections: true },
  { key: "p", label: "Publish", description: "Publish to Cloudflare and manage deployments", screen: "publish", requiresCollections: true },
  { key: "g", label: "Settings", description: "Configure sync interval, concurrency, and logging", screen: "settings" },
];

export function App(): React.ReactElement {
  const { exit } = useApp();
  const [screen, setScreen] = useState<Screen>("home");
  const [menuCursor, setMenuCursor] = useState(0);

  ensureInitialized();
  const hasCollections = listCollections().length > 0;
  const menuItems = ALL_MENU_ITEMS.filter(
    (item) => !item.requiresCollections || hasCollections,
  );

  useInput((input, key) => {
    if (input === "q" && screen === "home") {
      exit();
      return;
    }
    if (key.escape) {
      // Collections screen manages its own sub-navigation and ESC back to home;
      // skip the global handler so sub-screens (e.g. CollectionEdit) aren't bypassed.
      if (screen === "collections") return;
      if (screen !== "home") {
        setScreen("home");
      } else {
        exit();
      }
      return;
    }

    // Home screen: up/down + enter navigation + shortcuts
    if (screen === "home") {
      if (key.upArrow) setMenuCursor((c) => Math.max(0, c - 1));
      if (key.downArrow) setMenuCursor((c) => Math.min(menuItems.length - 1, c + 1));
      if (key.return) {
        setScreen(menuItems[menuCursor].screen);
        return;
      }
      if (input === "d") { setScreen("collections"); return; }
      const nav = menuItems.find((n) => n.key === input);
      if (nav) setScreen(nav.screen);
    }
    // Sub-screens handle their own key bindings — no global shortcuts
  });

  if (screen === "home") {
    return (
      <Box flexDirection="column">
        <Box paddingX={1} paddingY={1} gap={1}>
          <Text> </Text>
          <Text bold color="cyan">Frozen Ink</Text>
          <Text dimColor>— Local data replica manager</Text>
        </Box>
        {!hasCollections && (
          <Box paddingX={2} marginBottom={1}>
            <Text dimColor>No collections configured. Select Collections to add one.</Text>
          </Box>
        )}
        <Box flexDirection="column" paddingX={1}>
          {menuItems.map((item, i) => (
            <Box key={item.key} gap={1}>
              <Text color={i === menuCursor ? "cyan" : "gray"}>{i === menuCursor ? "❯" : " "}</Text>
              <Text dimColor>[{item.key}]</Text>
              <Text bold={i === menuCursor} color={i === menuCursor ? "cyan" : undefined}>
                {item.label.padEnd(18)}
              </Text>
              <Text dimColor>{item.description}</Text>
            </Box>
          ))}
        </Box>
        <Box paddingX={1} marginTop={1}>
          <Text dimColor>↑↓ navigate  Enter select  q quit</Text>
        </Box>
      </Box>
    );
  }

  const screenLabel = ALL_MENU_ITEMS.find((m) => m.screen === screen)?.label ?? screen;

  return (
    <Box flexDirection="column">
      <Box paddingX={1} gap={1}>
        <Text bold color="cyan">Frozen Ink</Text>
        <Text dimColor>›</Text>
        <Text bold>{screenLabel}</Text>
      </Box>
      <Box flexDirection="column" paddingX={1}>
        {screen === "collections" && <CollectionList onNavigate={setScreen} />}
        {screen === "sync" && <SyncView />}
        {screen === "publish" && <PublishView onDone={() => setScreen("home")} />}
        {screen === "settings" && <SettingsView />}
        {screen === "search" && <SearchView />}
      </Box>
      <Box paddingX={1}>
        <Text dimColor>ESC back to menu</Text>
      </Box>
    </Box>
  );
}
