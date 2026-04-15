import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import Layout, { isPublishedDeployment } from "./components/Layout";
import CollectionPicker from "./components/CollectionPicker";
import FileTree from "./components/FileTree";
import MarkdownView from "./components/MarkdownView";
import HtmlView from "./components/HtmlView";
import SearchBar, { type FileEntry } from "./components/SearchBar";
import FullTextSearch from "./components/FullTextSearch";
import ThemeSwitcher, { type ThemeId } from "./components/ThemeSwitcher";
import ViewModeToggle, { type ViewMode } from "./components/ViewModeToggle";
import TabBar, { type Tab } from "./components/TabBar";
import LinksPanel, { type Backlink, type LinkItem } from "./components/LinksPanel";
import ModeSwitcher from "./components/ModeSwitcher";
import ManageNav, { type ManageSection } from "./components/manage/ManageNav";
import CollectionList from "./components/manage/CollectionList";
import CollectionForm from "./components/manage/CollectionForm";
import PublishPanel from "./components/manage/PublishPanel";
import ExportPanel from "./components/manage/ExportPanel";
import SettingsPanel from "./components/manage/SettingsPanel";
import type { Collection, TreeNode, AppInfo, UIMode } from "./types";

function loadTheme(): ThemeId {
  try {
    const stored = localStorage.getItem("frozenink-theme");
    if (stored) return stored as ThemeId;
  } catch {}
  return "default";
}

function applyTheme(theme: ThemeId) {
  document.documentElement.setAttribute("data-theme", theme);
  try { localStorage.setItem("frozenink-theme", theme); } catch {}
}


function loadSidebarWidth(): number {
  try {
    const stored = localStorage.getItem("frozenink-sidebar-width");
    if (stored) return Math.max(160, Math.min(600, Number(stored)));
  } catch {}
  return 280;
}

function saveSidebarWidth(width: number) {
  try { localStorage.setItem("frozenink-sidebar-width", String(width)); } catch {}
  savePreferenceToServer("sidebarWidth", width);
}

function loadLastCollection(): string | null {
  try { return localStorage.getItem("frozenink-collection") ?? null; } catch { return null; }
}

function saveLastCollection(name: string) {
  try { localStorage.setItem("frozenink-collection", name); } catch {}
  savePreferenceToServer("lastCollection", name);
}

interface SavedTabs {
  tabs: { file: string }[];
  activeFile: string | null;
}

function loadCollectionTabs(collection: string): SavedTabs | null {
  try {
    const raw = localStorage.getItem(`frozenink-tabs:${collection}`);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveCollectionTabs(collection: string, tabs: { file: string }[], activeFile: string | null) {
  try { localStorage.setItem(`frozenink-tabs:${collection}`, JSON.stringify({ tabs, activeFile })); } catch {}
  savePreferenceToServer(`tabs:${collection}`, { tabs, activeFile });
}

// --- Server-side preference helpers (survive port changes in desktop mode) ---

function savePreferenceToServer(key: string, value: unknown) {
  fetch("/api/preferences", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ [key]: value }),
  }).catch(() => {});
}

/** Load all server-side preferences and hydrate localStorage + return them. */
async function loadServerPreferences(): Promise<Record<string, unknown>> {
  try {
    const res = await fetch("/api/preferences");
    if (!res.ok) return {};
    return await res.json();
  } catch { return {}; }
}

function titleFromPath(file: string): string {
  return (
    file
      .split("/")
      .pop()
      ?.replace(/\.md$/, "") ?? file
  );
}

/** Read the entity file path from the URL path, e.g. /issues/1234 → issues/1234.md */
function parseUrlFile(): string | null {
  const { pathname } = window.location;
  if (pathname === "/" || pathname === "") return null;
  return `${pathname.replace(/^\//, "")}.md`;
}

/** Convert an internal file path to a URL path, e.g. issues/1234.md → /issues/1234 */
function fileToUrlPath(file: string): string {
  return `/${file.replace(/\.md$/, "")}`;
}

interface NavEntry {
  collection: string;
  file: string;
}

interface BrowserHistoryState {
  collection: string;
  file: string;
  navIndex: number;
  notFound?: boolean;
}

function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.innerWidth <= breakpoint,
  );
  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [breakpoint]);
  return isMobile;
}

function loadUIMode(): UIMode {
  try {
    const stored = localStorage.getItem("frozenink-ui-mode");
    if (stored === "manage") return "manage";
  } catch {}
  return "browse";
}

function saveUIMode(mode: UIMode) {
  try { localStorage.setItem("frozenink-ui-mode", mode); } catch {}
}

export default function App() {
  const isMobile = useIsMobile();
  const [theme, setTheme] = useState<ThemeId>(loadTheme);
  const [appMode, setAppMode] = useState<"desktop" | "published" | "local">("local");
  const [uiMode, setUIMode] = useState<UIMode>(loadUIMode);
  const [manageSection, setManageSection] = useState<ManageSection>("collections");
  const [editingCollection, setEditingCollection] = useState<string | null>(null);
  const [addingCollection, setAddingCollection] = useState(false);
  // refreshKey: increment to force collections + file tree to re-fetch
  const [refreshKey, setRefreshKey] = useState(0);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [selectedCollection, setSelectedCollection] = useState<string | null>(null);
  const [fileTree, setFileTree] = useState<TreeNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [ftsOpen, setFtsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(false);
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  const [outgoingLinks, setOutgoingLinks] = useState<LinkItem[]>([]);
  const [backlinksOpen, setBacklinksOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("markdown");
  const [htmlContent, setHtmlContent] = useState<string | null>(null);
  const [htmlLoading, setHtmlLoading] = useState(false);
  const [htmlAvailable, setHtmlAvailable] = useState(false);

  // Tabs
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  // Navigation history (global)
  const [navHistory, setNavHistory] = useState<NavEntry[]>([]);
  const [navIndex, setNavIndex] = useState(-1);

  const [sidebarOpen, setSidebarOpen] = useState(!isMobile);

  // Sync panel defaults when viewport crosses the mobile breakpoint (e.g. window resize)
  useEffect(() => {
    setSidebarOpen(!isMobile);
    // Links panel stays closed by default on all breakpoints; close it on mobile transition
    if (isMobile) setBacklinksOpen(false);
  }, [isMobile]);
  const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth);
  const resizingRef = useRef(false);
  const resizeStartRef = useRef({ x: 0, width: 0 });
  // Refs that mirror state so navigateTo can read current values inside functional updates
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;
  const navIndexRef = useRef(navIndex);
  navIndexRef.current = navIndex;

  // URL-based routing state
  const [fileNotFound, setFileNotFound] = useState(false);
  // Pending URL navigation — parsed once from URL on mount, consumed by tree loading
  const pendingUrlNavRef = useRef<{ file: string } | null | undefined>(undefined);
  if (pendingUrlNavRef.current === undefined) {
    const file = parseUrlFile();
    pendingUrlNavRef.current = file ? { file } : null;
  }
  // Prevents double-initializing browser history (URL params vs. seeding effect)
  const historyInitializedRef = useRef(false);

  // Derive the active file from the active tab
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
  const selectedFile = activeTab?.file ?? null;

  // Seed navigation history with the initial page so first navigation enables Back.
  // Also initializes the browser history state and URL for non-URL-param load paths
  // (saved tabs, default file). URL-param loads are handled in the tree loading effect.
  useEffect(() => {
    if (!selectedCollection || !selectedFile) return;
    setNavHistory((prev) => {
      if (prev.length > 0) return prev;
      return [{ collection: selectedCollection, file: selectedFile }];
    });
    setNavIndex((prev) => (prev === -1 ? 0 : prev));
    if (!historyInitializedRef.current) {
      historyInitializedRef.current = true;
      window.history.replaceState(
        { collection: selectedCollection, file: selectedFile, navIndex: 0 } satisfies BrowserHistoryState,
        "",
        fileToUrlPath(selectedFile),
      );
    }
  }, [selectedCollection, selectedFile]);

  // Browse mode only shows enabled collections
  const browseCollections = useMemo(
    () => collections.filter((c) => c.enabled),
    [collections],
  );

  // If the selected collection was disabled or deleted, switch to the first enabled one
  useEffect(() => {
    if (!selectedCollection) return;
    const stillEnabled = browseCollections.some((c) => c.name === selectedCollection);
    if (!stillEnabled && browseCollections.length > 0) {
      setSelectedCollection(browseCollections[0].name);
    } else if (!stillEnabled && browseCollections.length === 0) {
      setSelectedCollection(null);
    }
  }, [browseCollections, selectedCollection]);

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

  // File entries with titles for Cmd+P search
  const fileEntries = useMemo(() => {
    function flatten(nodes: TreeNode[]): FileEntry[] {
      const out: FileEntry[] = [];
      for (const node of nodes) {
        if (node.type === "file") {
          out.push({ path: node.path, title: node.title ?? node.name.replace(/\.md$/, "") });
        }
        if (node.children) out.push(...flatten(node.children));
      }
      return out;
    }
    return flatten(fileTree);
  }, [fileTree]);

  // Detect app mode + hydrate preferences from server (survives port changes)
  useEffect(() => {
    fetch("/api/app-info")
      .then((r) => r.ok ? r.json() : null)
      .then((info: AppInfo | null) => {
        if (info) setAppMode(info.mode);
      })
      .catch(() => {});

    loadServerPreferences().then((prefs) => {
      if (prefs.theme) {
        setTheme(prefs.theme as ThemeId);
        applyTheme(prefs.theme as ThemeId);
      }
      if (prefs.sidebarWidth) {
        setSidebarWidth(Math.max(160, Math.min(600, Number(prefs.sidebarWidth))));
      }
      if (prefs.lastCollection) {
        setSelectedCollection((prev) => prev ?? (prefs.lastCollection as string));
      }
      // Hydrate localStorage with server values so subsequent reads work
      if (prefs.theme) try { localStorage.setItem("frozenink-theme", prefs.theme as string); } catch {}
      if (prefs.lastCollection) try { localStorage.setItem("frozenink-collection", prefs.lastCollection as string); } catch {}
      if (prefs.sidebarWidth) try { localStorage.setItem("frozenink-sidebar-width", String(prefs.sidebarWidth)); } catch {}
      // Hydrate tab state for each collection
      for (const [key, value] of Object.entries(prefs)) {
        if (key.startsWith("tabs:") && value) {
          try { localStorage.setItem(`frozenink-${key}`, JSON.stringify(value)); } catch {}
        }
      }
    });
  }, []);

  const handleUIModeChange = useCallback((mode: UIMode) => {
    setUIMode(mode);
    saveUIMode(mode);
  }, []);

  const handleThemeChange = useCallback((newTheme: ThemeId) => {
    setTheme(newTheme);
    savePreferenceToServer("theme", newTheme);
  }, []);

  const triggerRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

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
          const enabled = sorted.filter((c) => c.enabled);
          const last = loadLastCollection();
          const found = last ? enabled.find((c) => c.name === last) : null;
          setSelectedCollection(found ? found.name : (enabled[0]?.name ?? sorted[0].name));
        }
      })
      .catch(console.error);
  }, [refreshKey]);

  useEffect(() => {
    if (!selectedCollection) {
      setFileTree([]);
      return;
    }
    const collection = selectedCollection; // capture for async callbacks
    saveLastCollection(collection);
    setFileTree([]);
    setTreeLoading(true);
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
        setTreeLoading(false);
        setFileTree(tree);

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

        // If a tab for this collection already exists, don't auto-open.
        // But still consume a pending URL nav if it matches.
        setTabs((currentTabs) => {
          if (currentTabs.some((t) => t.collection === collection)) {
            return currentTabs;
          }

          // Check for a pending URL-based navigation (shared link / direct load)
          const pendingNav = pendingUrlNavRef.current;
          if (pendingNav) {
            pendingUrlNavRef.current = null;
            historyInitializedRef.current = true;
            if (files.includes(pendingNav.file)) {
              // File exists — open it and initialize browser history
              const id = crypto.randomUUID();
              setActiveTabId(id);
              setNavHistory([{ collection, file: pendingNav.file }]);
              setNavIndex(0);
              window.history.replaceState(
                { collection, file: pendingNav.file, navIndex: 0 } satisfies BrowserHistoryState,
                "",
                fileToUrlPath(pendingNav.file),
              );
              return [...currentTabs, { id, title: titleFromPath(pendingNav.file), collection, file: pendingNav.file }];
            } else {
              // File not found — show not-found state, keep URL as-is
              setFileNotFound(true);
              window.history.replaceState(
                { collection, file: pendingNav.file, navIndex: -1, notFound: true } satisfies BrowserHistoryState,
                "",
                window.location.pathname,
              );
              return currentTabs;
            }
          }

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
  }, [selectedCollection, refreshKey]);

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
    if (viewMode !== "markdown" || !selectedCollection || !selectedFile) {
      setFileContent(null);
      return;
    }
    setLoading(true);
    setFileNotFound(false);
    fetch(
      `/api/collections/${encodeURIComponent(selectedCollection)}/markdown/${selectedFile}`,
    )
      .then((r) => {
        if (!r.ok) throw new Error("not-found");
        return r.text();
      })
      .then((content) => {
        setFileContent(content);
        setFileNotFound(false);
      })
      .catch(() => {
        setFileContent(null);
        setFileNotFound(true);
      })
      .finally(() => setLoading(false));
  }, [viewMode, selectedCollection, selectedFile]);

  // Fetch backlinks for the current file (only when links panel is open)
  useEffect(() => {
    if (!backlinksOpen || !selectedCollection || !selectedFile) {
      setBacklinks([]);
      return;
    }
    fetch(
      `/api/collections/${encodeURIComponent(selectedCollection)}/backlinks/${selectedFile}`,
    )
      .then((r) => (r.ok ? r.json() : []))
      .then(setBacklinks)
      .catch(() => setBacklinks([]));
  }, [backlinksOpen, selectedCollection, selectedFile]);

  // Fetch outgoing links for the current file (only when links panel is open)
  useEffect(() => {
    if (!backlinksOpen || !selectedCollection || !selectedFile) {
      setOutgoingLinks([]);
      return;
    }
    fetch(
      `/api/collections/${encodeURIComponent(selectedCollection)}/outgoing-links/${selectedFile}`,
    )
      .then((r) => (r.ok ? r.json() : []))
      .then(setOutgoingLinks)
      .catch(() => setOutgoingLinks([]));
  }, [backlinksOpen, selectedCollection, selectedFile]);

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
        // Default to HTML when supported, fall back to markdown when not
        if (data.supported) {
          setViewMode("html");
        } else if (viewMode === "html") {
          setViewMode("markdown");
        }
      })
      .catch(() => setHtmlAvailable(false));
  }, [selectedCollection]);

  useEffect(() => {
    if (viewMode !== "html" || !htmlAvailable || !selectedCollection || !selectedFile) {
      setHtmlContent(null);
      setHtmlLoading(false);
      return;
    }
    setHtmlContent(null);
    setHtmlLoading(true);
    fetch(
      `/api/collections/${encodeURIComponent(selectedCollection)}/html/${selectedFile}`,
    )
      .then((r) => {
        if (!r.ok) throw new Error("HTML not available");
        return r.text();
      })
      .then((html) => {
        setHtmlContent(html);
        setHtmlLoading(false);
      })
      .catch(() => {
        setHtmlContent(null);
        setHtmlLoading(false);
      });
  }, [viewMode, htmlAvailable, selectedCollection, selectedFile]);

  // Core navigation: open a file, optionally in a new tab.
  // Uses functional state updates throughout to avoid stale closure issues.
  const navigateTo = useCallback(
    (collection: string, file: string, openNewTab = false) => {
      const title = titleFromPath(file);

      setSelectedCollection(collection);
      setFileNotFound(false);

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
      const newIndex = navIndexRef.current + 1;
      setNavIndex(newIndex);

      // Sync URL with browser history
      historyInitializedRef.current = true;
      window.history.pushState(
        { collection, file, navIndex: newIndex } satisfies BrowserHistoryState,
        "",
        fileToUrlPath(file),
      );
    },
    [],
  );

  const navigateBack = useCallback(() => {
    if (navIndexRef.current <= 0) return;
    window.history.back();
  }, []);

  const navigateForward = useCallback(() => {
    if (navIndexRef.current >= navHistory.length - 1) return;
    window.history.forward();
  }, [navHistory.length]);

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

  // Handle browser back/forward: restore state from the history entry
  useEffect(() => {
    const handler = (event: PopStateEvent) => {
      const state = event.state as BrowserHistoryState | null;
      if (!state?.collection || !state?.file) return;

      const { collection, file, navIndex: idx, notFound } = state;

      setSelectedCollection(collection);
      setNavIndex(idx ?? 0);

      if (notFound) {
        setFileNotFound(true);
        // Don't update active tab — the entity doesn't exist
        return;
      }

      setFileNotFound(false);
      const tabId = activeTabIdRef.current;
      setTabs((prev) =>
        prev.map((t) =>
          t.id === tabId
            ? { ...t, collection, file, title: titleFromPath(file) }
            : t,
        ),
      );
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      // Full-text search: Shift+Cmd+F
      if (mod && e.shiftKey && e.key === "f") {
        e.preventDefault();
        setFtsOpen((open) => !open);
        return;
      }

      // Search: Cmd+P or Cmd+K
      if (mod && (e.key === "p" || e.key === "k")) {
        e.preventDefault();
        setSearchOpen((open) => !open);
        return;
      }

      if (e.key === "Escape") {
        setSearchOpen(false);
        setFtsOpen(false);
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
      if (isMobile) setSidebarOpen(false);
    },
    [navigateTo, isMobile],
  );

  const handleFtsNavigate = useCallback(
    (collection: string, markdownPath: string, openNewTab?: boolean) => {
      navigateTo(collection, markdownPath, openNewTab);
      setFtsOpen(false);
      if (isMobile) setSidebarOpen(false);
    },
    [navigateTo, isMobile],
  );

  const handleWikilinkNavigate = useCallback(
    (target: string, openNewTab?: boolean) => {
      if (!selectedCollection) return;
      const directPath = target.endsWith(".md") ? target : `${target}.md`;

      // 1. Direct path match (exact file exists)
      if (allFiles.includes(directPath)) {
        navigateTo(selectedCollection, directPath, openNewTab);
      } else {
        // 2. Obsidian-style: match by file stem anywhere in the tree
        const stem = directPath.includes("/") ? directPath.split("/").pop()! : directPath;
        const match = allFiles.find((f: string) => f === stem || f.endsWith(`/${stem}`));
        // 3. Fall back to direct path (will show not-found if missing)
        navigateTo(selectedCollection, match ?? directPath, openNewTab);
      }

      // Close the links overlay after navigating on mobile
      if (isMobile) setBacklinksOpen(false);
    },
    [selectedCollection, navigateTo, allFiles, isMobile],
  );

  const handleFileSelect = useCallback(
    (file: string, openNewTab: boolean) => {
      if (selectedCollection) navigateTo(selectedCollection, file, openNewTab);
      if (isMobile) setSidebarOpen(false);
    },
    [selectedCollection, navigateTo, isMobile],
  );

  const canGoBack = navIndex > 0;
  const canGoForward = navIndex < navHistory.length - 1;
  const showLogout = isPublishedDeployment();

  const isDesktop = appMode === "desktop";

  const sidebar = (
    <>
      <ThemeSwitcher current={theme} onChange={handleThemeChange} />
      {isDesktop && <ModeSwitcher mode={uiMode} onChange={handleUIModeChange} />}
      {uiMode === "browse" && (
        <>
          <CollectionPicker
            collections={browseCollections}
            selected={selectedCollection}
            onSelect={setSelectedCollection}
          />
          <FileTree
            tree={fileTree}
            loading={treeLoading}
            selectedFile={selectedFile}
            onSelect={handleFileSelect}
          />
        </>
      )}
      {uiMode === "manage" && isDesktop && (
        <ManageNav active={manageSection} onSelect={(section) => {
          setManageSection(section);
          // Close any open forms when navigating between manage pages
          setEditingCollection(null);
          setAddingCollection(false);
        }} />
      )}
    </>
  );

  const manageContent = isDesktop && uiMode === "manage" ? (
    <div className="manage-content">
      {addingCollection ? (
        <CollectionForm
          onSave={() => { setAddingCollection(false); triggerRefresh(); }}
          onCancel={() => setAddingCollection(false)}
        />
      ) : editingCollection ? (
        <CollectionForm
          editName={editingCollection}
          editConfig={(() => {
            const col = collections.find((c) => c.name === editingCollection);
            return col ? { title: col.title, description: col.description, crawler: col.crawlerType, config: {}, credentials: {} } : undefined;
          })()}
          onSave={() => { setEditingCollection(null); triggerRefresh(); }}
          onCancel={() => setEditingCollection(null)}
        />
      ) : manageSection === "collections" ? (
        <CollectionList
          onEdit={(name) => setEditingCollection(name)}
          onAdd={() => setAddingCollection(true)}
          onSyncComplete={triggerRefresh}
          onCollectionsChanged={triggerRefresh}
        />
      ) : manageSection === "publish" ? (
        <PublishPanel />
      ) : manageSection === "export" ? (
        <ExportPanel />
      ) : manageSection === "settings" ? (
        <SettingsPanel />
      ) : null}
    </div>
  ) : null;

  const browseContent = (
    <>
      <div className="toolbar">
        {!isMobile && (
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
        )}
        <TabBar
          tabs={tabs}
          activeTabId={activeTabId}
          onSelect={(id) => {
            const t = tabs.find((tab) => tab.id === id);
            if (t) {
              setActiveTabId(id);
              setSelectedCollection(t.collection);
              setFileNotFound(false);
              // Reflect the newly active tab in the URL (replaceState — not a new nav entry)
              window.history.replaceState(
                { collection: t.collection, file: t.file, navIndex: navIndexRef.current } satisfies BrowserHistoryState,
                "",
                fileToUrlPath(t.file),
              );
            }
          }}
          onClose={handleCloseTab}
        />
        {!isMobile && (
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
              className="nav-btn"
              onClick={() => setFtsOpen(true)}
              title="Full-text search (⇧⌘F)"
              aria-label="Full-text search"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
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
            {selectedFile && selectedCollection && (
              <button
                className="nav-btn icon-btn"
                onClick={() => {
                  const url = `/api/collections/${encodeURIComponent(selectedCollection)}/textpack/${selectedFile}`;
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "";
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                }}
                title="Download as TextBundle"
                aria-label="Download as TextBundle"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
              </button>
            )}
            <div className="toolbar-menu-wrapper" ref={menuRef}>
              <button
                className={`nav-btn icon-btn${menuOpen ? " active" : ""}`}
                onClick={() => setMenuOpen((o) => !o)}
                title="Menu"
                aria-label="Menu"
                aria-expanded={menuOpen}
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                  <circle cx="12" cy="5" r="2" />
                  <circle cx="12" cy="12" r="2" />
                  <circle cx="12" cy="19" r="2" />
                </svg>
              </button>
              {menuOpen && (
                <div className="toolbar-menu" role="menu">
                  <button className="toolbar-menu-item" role="menuitem" onClick={() => { setSearchOpen(true); setMenuOpen(false); }}>
                    <span>Find by title</span><kbd>⌘P</kbd>
                  </button>
                  <button className="toolbar-menu-item" role="menuitem" onClick={() => { setFtsOpen(true); setMenuOpen(false); }}>
                    <span>Search content</span><kbd>⇧⌘F</kbd>
                  </button>
                  <div className="toolbar-menu-separator" />
                  <button className="toolbar-menu-item" role="menuitem" onClick={() => { setSidebarOpen((o) => !o); setMenuOpen(false); }}>
                    <span>{sidebarOpen ? "Hide" : "Show"} sidebar</span><kbd>⌘\</kbd>
                  </button>
                  <button className="toolbar-menu-item" role="menuitem" onClick={() => { setBacklinksOpen((o) => !o); setMenuOpen(false); }}>
                    <span>{backlinksOpen ? "Hide" : "Show"} links panel</span>
                  </button>
                  <div className="toolbar-menu-separator" />
                  <button className="toolbar-menu-item" role="menuitem" onClick={() => { navigateBack(); setMenuOpen(false); }} disabled={!canGoBack}>
                    <span>Go back</span><kbd>⌥←</kbd>
                  </button>
                  <button className="toolbar-menu-item" role="menuitem" onClick={() => { navigateForward(); setMenuOpen(false); }} disabled={!canGoForward}>
                    <span>Go forward</span><kbd>⌥→</kbd>
                  </button>
                  {activeTabId && (
                    <>
                      <div className="toolbar-menu-separator" />
                      <button className="toolbar-menu-item" role="menuitem" onClick={() => { handleCloseTab(activeTabId); setMenuOpen(false); }}>
                        <span>Close tab</span><kbd>⌘W</kbd>
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
            {showLogout && (
              <form method="POST" action="/logout" className="logout-form-inline">
                <button type="submit" className="nav-btn icon-btn logout-icon-btn" title="Sign out" aria-label="Sign out">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                    <polyline points="16 17 21 12 16 7"/>
                    <line x1="21" y1="12" x2="9" y2="12"/>
                  </svg>
                </button>
              </form>
            )}
          </div>
        )}
      </div>
      <div className="main-body">
        <div className="main-inner">
          {(loading || (viewMode === "html" && htmlLoading)) && <div className="loading">Loading...</div>}
          {!loading && !fileNotFound && selectedFile && viewMode === "html" && htmlContent !== null && (
            <HtmlView html={htmlContent} onWikilinkClick={handleWikilinkNavigate} />
          )}
          {!loading && !fileNotFound && selectedFile && viewMode === "markdown" && fileContent !== null && (
            <MarkdownView
              content={fileContent}
              collection={selectedCollection || ""}
              filePath={selectedFile || undefined}
              allFiles={allFiles}
              onWikilinkClick={handleWikilinkNavigate}
            />
          )}
          {!loading && fileNotFound && (
            <div className="empty-state">
              <p>Entity not found</p>
              <p className="hint">
                {isMobile
                  ? "Tap the sidebar icon to browse files or use search."
                  : "Select a file from the sidebar or press \u2318P to search."}
              </p>
            </div>
          )}
          {!selectedFile && !loading && !fileNotFound && (
            <div className="empty-state">
              <p>{isMobile ? "Tap the sidebar icon below to browse files" : "Select a file from the sidebar to view its contents"}</p>
              {!isMobile && (
                <p className="hint">
                  Press <kbd>⌘P</kbd> to find by title · <kbd>⇧⌘F</kbd> to search content
                </p>
              )}
            </div>
          )}
        </div>
        {!isMobile && !loading && selectedFile && (
          <LinksPanel
            backlinks={backlinks}
            outgoingLinks={outgoingLinks}
            open={backlinksOpen}
            onNavigate={handleWikilinkNavigate}
          />
        )}
      </div>
      {/* Mobile: Links panel as overlay */}
      {isMobile && backlinksOpen && selectedFile && !loading && (
        <div className="mobile-panel-overlay" onClick={() => setBacklinksOpen(false)}>
          <div className="mobile-panel-right" onClick={(e) => e.stopPropagation()}>
            <LinksPanel
              backlinks={backlinks}
              outgoingLinks={outgoingLinks}
              open={true}
              onNavigate={handleWikilinkNavigate}
            />
          </div>
        </div>
      )}
      {/* Mobile top action bar */}
      {isMobile && (
        <div className="mobile-top-bar">
          <button
            className={`mobile-bar-btn${sidebarOpen ? " active" : ""}`}
            onClick={() => setSidebarOpen((o) => !o)}
            aria-label="Toggle sidebar"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <line x1="9" y1="3" x2="9" y2="21"/>
            </svg>
          </button>
          <button
            className="mobile-bar-btn"
            onClick={navigateBack}
            disabled={!canGoBack}
            aria-label="Go back"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <button
            className="mobile-bar-btn"
            onClick={navigateForward}
            disabled={!canGoForward}
            aria-label="Go forward"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
          <button
            className="mobile-bar-btn"
            onClick={() => setSearchOpen(true)}
            aria-label="Search"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
          </button>
          <button
            className={`mobile-bar-btn${backlinksOpen && selectedFile ? " active" : ""}`}
            onClick={() => setBacklinksOpen((o) => !o)}
            disabled={!selectedFile}
            aria-label="Toggle links panel"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
            </svg>
          </button>
          {showLogout && (
            <form method="POST" action="/logout" style={{ display: "contents" }}>
              <button type="submit" className="mobile-bar-btn" aria-label="Sign out">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                  <polyline points="16 17 21 12 16 7"/>
                  <line x1="21" y1="12" x2="9" y2="12"/>
                </svg>
              </button>
            </form>
          )}
        </div>
      )}
    </>
  );

  const main = manageContent || browseContent;

  return (
    <>
      <Layout
        sidebar={sidebar}
        main={main}
        sidebarOpen={sidebarOpen}
        sidebarWidth={sidebarWidth}
        onResizeStart={onResizeStart}
        onToggleSidebar={() => setSidebarOpen((o) => !o)}
        isMobile={isMobile}
      />
      {searchOpen && (
        <SearchBar
          files={fileEntries}
          collection={selectedCollection ?? ""}
          onClose={() => setSearchOpen(false)}
          onNavigate={handleSearchNavigate}
        />
      )}
      {ftsOpen && (
        <FullTextSearch
          collection={selectedCollection ?? ""}
          onClose={() => setFtsOpen(false)}
          onNavigate={handleFtsNavigate}
        />
      )}
    </>
  );
}
