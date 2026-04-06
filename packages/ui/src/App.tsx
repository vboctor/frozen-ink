import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import Layout from "./components/Layout";
import CollectionPicker from "./components/CollectionPicker";
import FileTree from "./components/FileTree";
import MarkdownView from "./components/MarkdownView";
import HtmlView from "./components/HtmlView";
import SearchBar from "./components/SearchBar";
import ThemeSwitcher, { type ThemeId } from "./components/ThemeSwitcher";
import ViewModeToggle, { type ViewMode } from "./components/ViewModeToggle";
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

interface SavedTabs {
  tabs: { file: string }[];
  activeFile: string | null;
}

function loadCollectionTabs(collection: string): SavedTabs | null {
  try {
    const raw = localStorage.getItem(`veecontext-tabs:${collection}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveCollectionTabs(collection: string, tabs: { file: string }[], activeFile: string | null) {
  try {
    localStorage.setItem(`veecontext-tabs:${collection}`, JSON.stringify({ tabs, activeFile }));
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
  const [viewMode, setViewMode] = useState<ViewMode>("markdown");
  const [htmlContent, setHtmlContent] = useState<string | null>(null);
  const [htmlAvailable, setHtmlAvailable] = useState(false);

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
  // Refs that mirror state so navigateTo can read current values inside functional updates
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;
  const navIndexRef = useRef(navIndex);
  navIndexRef.current = navIndex;

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
    const collection = selectedCollection; // capture for async callbacks
    saveLastCollection(collection);
    setFileTree([]);
    // Close tabs from other collections so a stale tab doesn't linger
    setTabs((prev) => {
      const kept = prev.filter((t) => t.collection === collection);
      if (kept.length === 0) {
        setActiveTabId(null);
      } else {
        const curId = activeTabIdRef.current;
        if (!kept.find((t) => t.id === curId)) {
          setActiveTabId(kept[0].id);
        }
      }
      return kept;
    });

    let cancelled = false;
    fetch(`/api/collections/${encodeURIComponent(collection)}/tree`)
      .then((r) => r.json())
      .then((tree: TreeNode[]) => {
        if (cancelled) return;
        setFileTree(tree);

        // If a tab for this collection already exists, don't auto-open
        setTabs((currentTabs) => {
          if (currentTabs.some((t) => t.collection === collection)) {
            return currentTabs;
          }

          // Flatten tree to get file list for validation
          function flatten(nodes: TreeNode[]): string[] {
            const out: string[] = [];
            for (const n of nodes) {
              if (n.type === "file") out.push(n.path);
              if (n.children) out.push(...flatten(n.children));
            }
            return out;
          }
          const files = flatten(tree);

          // Restore saved tabs (filter out files that no longer exist)
          const saved = loadCollectionTabs(collection);
          if (saved && saved.tabs.length > 0) {
            const restoredTabs: Tab[] = [];
            let activeId: string | null = null;
            for (const st of saved.tabs) {
              if (!files.includes(st.file)) continue;
              const id = crypto.randomUUID();
              restoredTabs.push({ id, title: titleFromPath(st.file), collection, file: st.file });
              if (st.file === saved.activeFile) activeId = id;
            }
            if (restoredTabs.length > 0) {
              setActiveTabId(activeId ?? restoredTabs[0].id);
              return [...currentTabs, ...restoredTabs];
            }
          }

          // No saved tabs — fall back to most recently updated file
          fetch(`/api/collections/${encodeURIComponent(collection)}/default-file`)
            .then((r) => (r.ok ? r.json() : null))
            .then((data: { file: string | null } | null) => {
              if (cancelled || !data?.file || !files.includes(data.file)) return;
              const id = crypto.randomUUID();
              setTabs((prev) => [...prev, { id, title: titleFromPath(data.file!), collection, file: data.file! }]);
              setActiveTabId(id);
            })
            .catch(() => {});

          return currentTabs;
        });
      })
      .catch(console.error);

    return () => { cancelled = true; };
  }, [selectedCollection]);

  // Persist all tabs for the current collection whenever tabs or active tab change.
  // Uses the tab collection (not selectedCollection) to avoid corrupting on switch.
  useEffect(() => {
    if (tabs.length === 0) return;
    const collection = tabs[0]?.collection;
    if (!collection) return;
    const collectionTabs = tabs.filter((t) => t.collection === collection);
    saveCollectionTabs(
      collection,
      collectionTabs.map((t) => ({ file: t.file })),
      activeTab?.collection === collection ? activeTab.file : collectionTabs[0]?.file ?? null,
    );
  }, [tabs, activeTab]);

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

  // Check if HTML rendering is available for the selected collection
  useEffect(() => {
    if (!selectedCollection) {
      setHtmlAvailable(false);
      return;
    }
    fetch(`/api/collections/${encodeURIComponent(selectedCollection)}/html-support`)
      .then((r) => (r.ok ? r.json() : { supported: false }))
      .then((data: { supported: boolean }) => {
        setHtmlAvailable(data.supported);
        if (!data.supported && viewMode === "html") {
          setViewMode("markdown");
        }
      })
      .catch(() => setHtmlAvailable(false));
  }, [selectedCollection]);

  // Fetch HTML content when in HTML mode
  useEffect(() => {
    if (viewMode !== "html" || !selectedCollection || !selectedFile) {
      setHtmlContent(null);
      return;
    }
    fetch(
      `/api/collections/${encodeURIComponent(selectedCollection)}/html/${selectedFile}`,
    )
      .then((r) => {
        if (!r.ok) throw new Error("HTML not available");
        return r.text();
      })
      .then(setHtmlContent)
      .catch(() => {
        setHtmlContent(null);
        setViewMode("markdown");
      });
  }, [viewMode, selectedCollection, selectedFile]);

  // Core navigation: open a file, optionally in a new tab.
  // Uses functional state updates throughout to avoid stale closure issues.
  const navigateTo = useCallback(
    (collection: string, file: string, openNewTab = false) => {
      const title = titleFromPath(file);

      setSelectedCollection(collection);

      setTabs((prev) => {
        if (openNewTab || prev.length === 0) {
          const id = crypto.randomUUID();
          setActiveTabId(id);
          return [...prev, { id, title, collection, file }];
        }
        // Update the active tab — read activeTabId from ref
        const currentTabId = activeTabIdRef.current;
        return prev.map((t) =>
          t.id === currentTabId ? { ...t, collection, file, title } : t,
        );
      });

      // Push to history, truncating any forward entries
      setNavHistory((prev) => {
        const trimmed = prev.slice(0, navIndexRef.current + 1);
        return [...trimmed, { collection, file }];
      });
      setNavIndex((prev) => prev + 1);
    },
    [],
  );

  const navigateBack = useCallback(() => {
    if (navIndexRef.current <= 0) return;
    const newIndex = navIndexRef.current - 1;
    const entry = navHistory[newIndex];
    setNavIndex(newIndex);
    setSelectedCollection(entry.collection);
    const tabId = activeTabIdRef.current;
    setTabs((prev) =>
      prev.map((t) =>
        t.id === tabId
          ? { ...t, collection: entry.collection, file: entry.file, title: titleFromPath(entry.file) }
          : t,
      ),
    );
  }, [navHistory]);

  const navigateForward = useCallback(() => {
    if (navIndexRef.current >= navHistory.length - 1) return;
    const newIndex = navIndexRef.current + 1;
    const entry = navHistory[newIndex];
    setNavIndex(newIndex);
    setSelectedCollection(entry.collection);
    const tabId = activeTabIdRef.current;
    setTabs((prev) =>
      prev.map((t) =>
        t.id === tabId
          ? { ...t, collection: entry.collection, file: entry.file, title: titleFromPath(entry.file) }
          : t,
      ),
    );
  }, [navHistory]);

  const handleCloseTab = useCallback(
    (id: string) => {
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === id);
        const next = prev.filter((t) => t.id !== id);
        if (id === activeTabIdRef.current && next.length > 0) {
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
    [],
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
    (collection: string, markdownPath: string, openNewTab?: boolean) => {
      navigateTo(collection, markdownPath, openNewTab);
      setSearchOpen(false);
    },
    [navigateTo],
  );

  const handleWikilinkNavigate = useCallback(
    (target: string, openNewTab?: boolean) => {
      if (!selectedCollection) return;
      const directPath = target.endsWith(".md") ? target : `${target}.md`;

      // 1. Direct path match (exact file exists)
      if (allFiles.includes(directPath)) {
        navigateTo(selectedCollection, directPath, openNewTab);
        return;
      }

      // 2. Obsidian-style: match by file stem anywhere in the tree
      // e.g. [[VeeClaw - CLI Channel]] matches "notes/VeeClaw - CLI Channel.md"
      const stem = directPath.includes("/") ? directPath.split("/").pop()! : directPath;
      const match = allFiles.find((f: string) => f === stem || f.endsWith(`/${stem}`));
      if (match) {
        navigateTo(selectedCollection, match, openNewTab);
        return;
      }

      // 3. Fall back to direct path (will show not-found if missing)
      navigateTo(selectedCollection, directPath, openNewTab);
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
          <ViewModeToggle
            mode={viewMode}
            htmlAvailable={htmlAvailable}
            onChange={setViewMode}
          />
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
          {!loading && selectedFile && fileContent !== null && viewMode === "markdown" && (
            <MarkdownView
              content={fileContent}
              collection={selectedCollection || ""}
              allFiles={allFiles}
              onWikilinkClick={handleWikilinkNavigate}
            />
          )}
          {!loading && selectedFile && viewMode === "html" && htmlContent !== null && (
            <HtmlView html={htmlContent} />
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
          files={allFiles}
          collection={selectedCollection ?? ""}
          onClose={() => setSearchOpen(false)}
          onNavigate={handleSearchNavigate}
        />
      )}
    </>
  );
}
