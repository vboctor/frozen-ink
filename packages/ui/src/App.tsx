import { useState, useEffect, useCallback } from "react";
import Layout from "./components/Layout";
import CollectionPicker from "./components/CollectionPicker";
import FileTree from "./components/FileTree";
import MarkdownView from "./components/MarkdownView";
import SearchBar from "./components/SearchBar";
import ThemeSwitcher, { type ThemeId } from "./components/ThemeSwitcher";
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

export default function App() {
  const [theme, setTheme] = useState<ThemeId>(loadTheme);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [selectedCollection, setSelectedCollection] = useState<string | null>(
    null,
  );
  const [fileTree, setFileTree] = useState<TreeNode[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [loading, setLoading] = useState(false);

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
      setSelectedFile(null);
      setFileContent(null);
      return;
    }
    setSelectedFile(null);
    setFileContent(null);
    fetch(
      `/api/collections/${encodeURIComponent(selectedCollection)}/tree`,
    )
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
      .then((content) => setFileContent(content))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [selectedCollection, selectedFile]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen((open) => !open);
      }
      if (e.key === "Escape") {
        setSearchOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const handleSearchNavigate = useCallback(
    (collection: string, markdownPath: string | null) => {
      setSelectedCollection(collection);
      if (markdownPath) {
        setSelectedFile(markdownPath);
      }
      setSearchOpen(false);
    },
    [],
  );

  const handleWikilinkNavigate = useCallback((target: string) => {
    const filePath = target.endsWith(".md") ? target : `${target}.md`;
    setSelectedFile(filePath);
  }, []);

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
        onSelect={setSelectedFile}
      />
    </>
  );

  const main = (
    <>
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
            Press <kbd>⌘K</kbd> to search
          </p>
        </div>
      )}
    </>
  );

  return (
    <>
      <Layout sidebar={sidebar} main={main} />
      {searchOpen && (
        <SearchBar
          onClose={() => setSearchOpen(false)}
          onNavigate={handleSearchNavigate}
        />
      )}
    </>
  );
}
