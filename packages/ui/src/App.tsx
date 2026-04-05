import { useState, useEffect, useCallback, useRef } from "react";
import Layout from "./components/Layout";
import CollectionPicker from "./components/CollectionPicker";
import FileTree from "./components/FileTree";
import MarkdownView from "./components/MarkdownView";
import SearchBar from "./components/SearchBar";
import ThemeSwitcher, { type ThemeId } from "./components/ThemeSwitcher";
import TabBar, { type Tab } from "./components/TabBar";
import BacklinksPanel, { type Backlink } from "./components/BacklinksPanel";
import type { Collection, TreeNode } from "./types";

function loadTheme(): ThemeId {
  try {
    const stored = localStorage.getItem("veecontext-theme");
    if (stored) return stored as ThemeId;
  } catch {
    // localStorage unavailable
  }
  return "default";
}

function applyTheme(theme: ThemeId) {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem("veecontext-theme", theme);
  } catch {
    // localStorage unavailable
  }
}

function loadSidebarWidth(): number {
  try {
    const stored = localStorage.getItem("veecontext-sidebar-width");
    if (stored) return Math.max(160, Math.min(600, Number(stored)));
  } catch {
    // localStorage unavailable
  }
  return 280;
}

function saveSidebarWidth(width: number) {
  try {
    localStorage.setItem("veecontext-sidebar-width", String(width));
  } catch {
    // localStorage unavailable
  }
}

function titleFromPath(file: string): string {
  return (
    file
      .split("/")
      .pop()
      ?.replace(/\.md$/, "") ?? file
  );
}

interface NavEntry {
  collection: string;
  file: string;
}

export default function App() {
  const [theme, setTheme] = useState<ThemeId>(loadTheme);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [selectedCollection, setSelectedCollection] = useState<string | null>(null);
  const [fileTree, setFileTree] = useState<TreeNode[]>([]);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);

  // Tabs
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  // Navigation history (global)
  const [navHistory, setNavHistory] = useState<NavEntry[]>([]);
  const [navIndex, setNavIndex] = useState(-1);

  // Sidebar
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth);
  const resizingRef = useRef(false);
  const resizeStartRef = useRef({ x: 0, width: 0 });

  // Derive the active file from the active tab
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
  const selectedFile = activeTab?.file ?? null;

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    fetch("/api/collections")
      .then((r) => r.json())
      .then(setCollections)
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (!selectedCollection) {
      setFileTree([]);
      return;
    }
    fetch(`/api/collections/${encodeURIComponent(selectedCollection)}/tree`)
      .then((r) => r.json())
      .then(setFileTree)
      .catch(console.error);
  }, [selectedCollection]);

  useEffect(() => {
    if (!selectedCollection || !selectedFile) {
      setFileContent(null);
      return;
    }
    setLoading(true);
    fetch(
      `/api/collections/${encodeURIComponent(selectedCollection)}/markdown/${selectedFile}`,
    )
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load file");
        return r.text();
      })
      .then(setFileContent)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [selectedCollection, selectedFile]);

  // Fetch backlinks for the current file
  useEffect(() => {
    if (!selectedCollection || !selectedFile) {
      setBacklinks([]);
      return;
    }
    fetch(
      `/api/collections/${encodeURIComponent(selectedCollection)}/backlinks/${selectedFile}`,
    )
      .then((r) => (r.ok ? r.json() : []))
      .then(setBacklinks)
      .catch(() => setBacklinks([]));
  }, [selectedCollection, selectedFile]);

  // Core navigation: open a file, optionally in a new tab
  const navigateTo = useCallback(
    (collection: string, file: string, openNewTab = false) => {
      const title = titleFromPath(file);

      setSelectedCollection(collection);

      if (openNewTab || tabs.length === 0) {
        const id = crypto.randomUUID();
        setTabs((prev) => [...prev, { id, title, collection, file }]);
        setActiveTabId(id);
      } else {
        setTabs((prev) =>
          prev.map((t) =>
            t.id === activeTabId ? { ...t, collection, file, title } : t,
          ),
        );
      }

      // Push to history, truncating any forward entries
      setNavHistory((prev) => {
        const trimmed = prev.slice(0, navIndex + 1);
        return [...trimmed, { collection, file }];
      });
      setNavIndex((prev) => prev + 1);
    },
    [tabs, activeTabId, navIndex],
  );

  const navigateBack = useCallback(() => {
    if (navIndex <= 0) return;
    const newIndex = navIndex - 1;
    const entry = navHistory[newIndex];
    setNavIndex(newIndex);
    setSelectedCollection(entry.collection);
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTabId
          ? { ...t, collection: entry.collection, file: entry.file, title: titleFromPath(entry.file) }
          : t,
      ),
    );
  }, [navIndex, navHistory, activeTabId]);

  const navigateForward = useCallback(() => {
    if (navIndex >= navHistory.length - 1) return;
    const newIndex = navIndex + 1;
    const entry = navHistory[newIndex];
    setNavIndex(newIndex);
    setSelectedCollection(entry.collection);
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTabId
          ? { ...t, collection: entry.collection, file: entry.file, title: titleFromPath(entry.file) }
          : t,
      ),
    );
  }, [navIndex, navHistory, activeTabId]);

  const handleCloseTab = useCallback(
    (id: string) => {
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === id);
        const next = prev.filter((t) => t.id !== id);
        if (id === activeTabId && next.length > 0) {
          const newActive = next[Math.min(idx, next.length - 1)];
          setActiveTabId(newActive.id);
          setSelectedCollection(newActive.collection);
        } else if (next.length === 0) {
          setActiveTabId(null);
          setFileContent(null);
        }
        return next;
      });
    },
    [activeTabId],
  );

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      // Search: Cmd+P or Cmd+K
      if (mod && (e.key === "p" || e.key === "k")) {
        e.preventDefault();
        setSearchOpen((open) => !open);
        return;
      }

      if (e.key === "Escape") {
        setSearchOpen(false);
        return;
      }

      // Sidebar toggle: Cmd+\
      if (mod && e.key === "\\") {
        e.preventDefault();
        setSidebarOpen((open) => !open);
        return;
      }

      // Close tab: Cmd+W
      if (mod && e.key === "w" && activeTabId) {
        e.preventDefault();
        handleCloseTab(activeTabId);
        return;
      }

      // Cycle tabs: Ctrl+Tab / Ctrl+Shift+Tab
      if (e.ctrlKey && e.key === "Tab") {
        e.preventDefault();
        setTabs((prev) => {
          if (prev.length < 2) return prev;
          const idx = prev.findIndex((t) => t.id === activeTabId);
          const next = e.shiftKey
            ? prev[(idx - 1 + prev.length) % prev.length]
            : prev[(idx + 1) % prev.length];
          setActiveTabId(next.id);
          setSelectedCollection(next.collection);
          return prev;
        });
        return;
      }

      // Back/Forward: Alt+← / Alt+→  or  Cmd+[ / Cmd+]
      if (e.altKey && e.key === "ArrowLeft") {
        e.preventDefault();
        navigateBack();
        return;
      }
      if (e.altKey && e.key === "ArrowRight") {
        e.preventDefault();
        navigateForward();
        return;
      }
      if (mod && e.key === "[") {
        e.preventDefault();
        navigateBack();
        return;
      }
      if (mod && e.key === "]") {
        e.preventDefault();
        navigateForward();
        return;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeTabId, handleCloseTab, navigateBack, navigateForward]);

  // Sidebar resize handlers
  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      resizingRef.current = true;
      resizeStartRef.current = { x: e.clientX, width: sidebarWidth };

      const onMouseMove = (ev: MouseEvent) => {
        if (!resizingRef.current) return;
        const delta = ev.clientX - resizeStartRef.current.x;
        const newWidth = Math.max(160, Math.min(600, resizeStartRef.current.width + delta));
        setSidebarWidth(newWidth);
      };

      const onMouseUp = (ev: MouseEvent) => {
        resizingRef.current = false;
        const delta = ev.clientX - resizeStartRef.current.x;
        const newWidth = Math.max(160, Math.min(600, resizeStartRef.current.width + delta));
        saveSidebarWidth(newWidth);
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
      };

      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    },
    [sidebarWidth],
  );

  const handleSearchNavigate = useCallback(
    (collection: string, markdownPath: string | null) => {
      if (markdownPath) {
        navigateTo(collection, markdownPath);
      } else {
        setSelectedCollection(collection);
      }
      setSearchOpen(false);
    },
    [navigateTo],
  );

  const handleWikilinkNavigate = useCallback(
    (target: string) => {
      if (!selectedCollection) return;
      const directPath = target.endsWith(".md") ? target : `${target}.md`;

      // Flatten the file tree into a list of all file paths for lookup
      function flattenTree(nodes: TreeNode[]): string[] {
        const paths: string[] = [];
        for (const node of nodes) {
          if (node.type === "file") paths.push(node.path);
          if (node.children) paths.push(...flattenTree(node.children));
        }
        return paths;
      }
      const allFiles = flattenTree(fileTree);

      // 1. Direct path match (exact file exists)
      if (allFiles.includes(directPath)) {
        navigateTo(selectedCollection, directPath);
        return;
      }

      // 2. Obsidian-style: match by file stem anywhere in the tree
      // e.g. [[VeeClaw - CLI Channel]] matches "notes/VeeClaw - CLI Channel.md"
      const stem = directPath.includes("/") ? directPath.split("/").pop()! : directPath;
      const match = allFiles.find((f) => f === stem || f.endsWith(`/${stem}`));
      if (match) {
        navigateTo(selectedCollection, match);
        return;
      }

      // 3. Fall back to direct path (will show not-found if missing)
      navigateTo(selectedCollection, directPath);
    },
    [selectedCollection, navigateTo, fileTree],
  );

  const handleFileSelect = useCallback(
    (file: string, openNewTab: boolean) => {
      if (selectedCollection) navigateTo(selectedCollection, file, openNewTab);
    },
    [selectedCollection, navigateTo],
  );

  const canGoBack = navIndex > 0;
  const canGoForward = navIndex < navHistory.length - 1;

  const sidebar = (
    <>
      <ThemeSwitcher current={theme} onChange={setTheme} />
      <CollectionPicker
        collections={collections}
        selected={selectedCollection}
        onSelect={setSelectedCollection}
      />
      <FileTree
        tree={fileTree}
        selectedFile={selectedFile}
        onSelect={handleFileSelect}
      />
    </>
  );

  const main = (
    <>
      <div className="toolbar">
        <div className="toolbar-nav">
          <button
            className="nav-btn"
            onClick={navigateBack}
            disabled={!canGoBack}
            title="Go back (Alt+←)"
            aria-label="Go back"
          >
            ‹
          </button>
          <button
            className="nav-btn"
            onClick={navigateForward}
            disabled={!canGoForward}
            title="Go forward (Alt+→)"
            aria-label="Go forward"
          >
            ›
          </button>
        </div>
        <TabBar
          tabs={tabs}
          activeTabId={activeTabId}
          onSelect={(id) => {
            const t = tabs.find((tab) => tab.id === id);
            if (t) {
              setActiveTabId(id);
              setSelectedCollection(t.collection);
            }
          }}
          onClose={handleCloseTab}
        />
        <div className="toolbar-actions">
          <button
            className="nav-btn"
            onClick={() => setSearchOpen(true)}
            title="Quick switcher (⌘P)"
            aria-label="Open search"
          >
            ⌘P
          </button>
        </div>
      </div>
      <div className="main-body">
        <div className="main-inner">
          {loading && <div className="loading">Loading...</div>}
          {!loading && selectedFile && fileContent !== null && (
            <MarkdownView
              content={fileContent}
              collection={selectedCollection || ""}
              onWikilinkClick={handleWikilinkNavigate}
            />
          )}
          {!selectedFile && !loading && (
            <div className="empty-state">
              <p>Select a file from the sidebar to view its contents</p>
              <p className="hint">
                Press <kbd>⌘P</kbd> or <kbd>⌘K</kbd> to search
              </p>
            </div>
          )}
        </div>
        {!loading && selectedFile && fileContent !== null && (
          <BacklinksPanel
            backlinks={backlinks}
            onNavigate={handleWikilinkNavigate}
          />
        )}
      </div>
    </>
  );

  return (
    <>
      <Layout
        sidebar={sidebar}
        main={main}
        sidebarOpen={sidebarOpen}
        sidebarWidth={sidebarWidth}
        onResizeStart={onResizeStart}
        onToggleSidebar={() => setSidebarOpen((o) => !o)}
      />
      {searchOpen && (
        <SearchBar
          onClose={() => setSearchOpen(false)}
          onNavigate={handleSearchNavigate}
        />
      )}
    </>
  );
}
