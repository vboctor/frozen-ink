import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import Layout from "./components/Layout";
import CollectionPicker from "./components/CollectionPicker";
import FileTree from "./components/FileTree";
import MarkdownView from "./components/MarkdownView";
import SearchBar from "./components/SearchBar";
import ThemeSwitcher, { type ThemeId } from "./components/ThemeSwitcher";
import TabBar, { type Tab } from "./components/TabBar";
import LinksPanel, { type Backlink, type LinkItem } from "./components/LinksPanel";
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

function loadLastCollection(): string | null {
  try {
    return localStorage.getItem("veecontext-collection") ?? null;
  } catch {
    return null;
  }
}

function saveLastCollection(name: string) {
  try {
    localStorage.setItem("veecontext-collection", name);
  } catch {
    // localStorage unavailable
  }
}

function loadLastFile(collection: string): string | null {
  try {
    return localStorage.getItem(`veecontext-file:${collection}`) ?? null;
  } catch {
    return null;
  }
}

function saveLastFile(collection: string, file: string) {
  try {
    localStorage.setItem(`veecontext-file:${collection}`, file);
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
  const [outgoingLinks, setOutgoingLinks] = useState<LinkItem[]>([]);
  const [backlinksOpen, setBacklinksOpen] = useState(true);

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
  // Tracks which collection has already had its last file restored to prevent
  // re-triggering when unrelated state causes allFiles to recompute.
  const restoredCollectionRef = useRef<string | null>(null);

  // Derive the active file from the active tab
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
  const selectedFile = activeTab?.file ?? null;

  // Flat list of all file paths in the current file tree for wikilink resolution
  const allFiles = useMemo(() => {
    function flatten(nodes: TreeNode[]): string[] {
      const paths: string[] = [];
      for (const node of nodes) {
        if (node.type === "file") paths.push(node.path);
        if (node.children) paths.push(...flatten(node.children));
      }
      return paths;
    }
    return flatten(fileTree);
  }, [fileTree]);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    fetch("/api/collections")
      .then((r) => r.json())
      .then((data: Collection[]) => {
        const sorted = [...data].sort((a, b) => a.name.localeCompare(b.name));
        setCollections(sorted);
        if (!selectedCollection && sorted.length > 0) {
          const last = loadLastCollection();
          const found = last ? sorted.find((c) => c.name === last) : null;
          setSelectedCollection(found ? found.name : sorted[0].name);
        }
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (!selectedCollection) {
      setFileTree([]);
      return;
    }
    saveLastCollection(selectedCollection);
    // Reset restore guard whenever the collection changes so the new collection
    // gets a fresh restore attempt once its tree loads.
    restoredCollectionRef.current = null;
    fetch(`/api/collections/${encodeURIComponent(selectedCollection)}/tree`)
      .then((r) => r.json())
      .then(setFileTree)
      .catch(console.error);
  }, [selectedCollection]);

  // Save the current file whenever it changes
  useEffect(() => {
    if (selectedCollection && selectedFile) {
      saveLastFile(selectedCollection, selectedFile);
    }
  }, [selectedCollection, selectedFile]);

  // Restore the last opened file once the file tree is ready for a collection.
  // The ref guard ensures this fires exactly once per collection switch.
  useEffect(() => {
    if (!selectedCollection || allFiles.length === 0) return;
    if (restoredCollectionRef.current === selectedCollection) return;
    restoredCollectionRef.current = selectedCollection;
    if (tabs.some((t) => t.collection === selectedCollection)) return;
    const lastFile = loadLastFile(selectedCollection);
    if (lastFile && allFiles.includes(lastFile)) {
      navigateTo(selectedCollection, lastFile);
    }
  // navigateTo and tabs are intentionally omitted — we only want to trigger
  // on collection/tree changes, not on every tab update.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCollection, allFiles]);

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

  // Fetch outgoing links for the current file
  useEffect(() => {
    if (!selectedCollection || !selectedFile) {
      setOutgoingLinks([]);
      return;
    }
    fetch(
      `/api/collections/${encodeURIComponent(selectedCollection)}/outgoing-links/${selectedFile}`,
    )
      .then((r) => (r.ok ? r.json() : []))
      .then(setOutgoingLinks)
      .catch(() => setOutgoingLinks([]));
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

      // 1. Direct path match (exact file exists)
      if (allFiles.includes(directPath)) {
        navigateTo(selectedCollection, directPath);
        return;
      }

      // 2. Obsidian-style: match by file stem anywhere in the tree
      // e.g. [[VeeClaw - CLI Channel]] matches "notes/VeeClaw - CLI Channel.md"
      const stem = directPath.includes("/") ? directPath.split("/").pop()! : directPath;
      const match = allFiles.find((f: string) => f === stem || f.endsWith(`/${stem}`));
      if (match) {
        navigateTo(selectedCollection, match);
        return;
      }

      // 3. Fall back to direct path (will show not-found if missing)
      navigateTo(selectedCollection, directPath);
    },
    [selectedCollection, navigateTo, allFiles],
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
          <button
            className={`nav-btn icon-btn${backlinksOpen ? " active" : ""}`}
            onClick={() => setBacklinksOpen((o) => !o)}
            title="Toggle links panel"
            aria-label="Toggle links panel"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
            </svg>
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
              allFiles={allFiles}
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
        {!loading && selectedFile && (
          <LinksPanel
            backlinks={backlinks}
            outgoingLinks={outgoingLinks}
            open={backlinksOpen}
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
