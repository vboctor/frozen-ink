import { useState, useRef, useEffect, useMemo } from "react";
import type { TreeNode } from "../types";

interface FileTreeProps {
  tree: TreeNode[];
  loading?: boolean;
  selectedFile: string | null;
  onSelect: (path: string, openNewTab: boolean) => void;
}

interface TreeItemProps {
  node: TreeNode;
  selectedFile: string | null;
  onSelect: (path: string, openNewTab: boolean) => void;
  depth: number;
  defaultExpanded?: boolean;
}

const LARGE_DIR_THRESHOLD = 200;
const PAGE_SIZE = 200;

function TreeItem({ node, selectedFile, onSelect, depth, defaultExpanded = false }: TreeItemProps) {
  const [expanded, setExpanded] = useState(true);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  if (node.type === "directory") {
    const children = node.children ?? [];
    const isLarge = children.length > LARGE_DIR_THRESHOLD;
    const visibleChildren = isLarge && expanded ? children.slice(0, visibleCount) : children;
    const hasMore = isLarge && visibleCount < children.length;

    return (
      <li className="tree-directory" role="treeitem" aria-expanded={expanded}>
        <button
          className="tree-toggle"
          onClick={() => setExpanded(!expanded)}
          style={{ paddingLeft: `${depth * 16 + 4}px` }}
        >
          <span className="tree-icon">{expanded ? "▼" : "▶"}</span>
          <span className="tree-name">{node.name}</span>
          {node.count !== undefined && node.count > 0 && (
            <span className="tree-count">({node.count.toLocaleString()})</span>
          )}
        </button>
        {expanded && (
          <ul className="tree-children" role="group">
            {visibleChildren.map((child) => (
              <TreeItem
                key={child.path}
                node={child}
                selectedFile={selectedFile}
                onSelect={onSelect}
                depth={depth + 1}
              />
            ))}
            {hasMore && (
              <li className="tree-show-more">
                <button
                  className="tree-show-more-button"
                  onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                  style={{ paddingLeft: `${(depth + 1) * 16 + 4}px` }}
                >
                  Show more ({(children.length - visibleCount).toLocaleString()} remaining)
                </button>
              </li>
            )}
          </ul>
        )}
      </li>
    );
  }

  const isSelected = node.path === selectedFile;
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isSelected) {
      btnRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [isSelected]);

  return (
    <li className="tree-file" role="treeitem">
      <button
        ref={btnRef}
        className={`tree-file-button${isSelected ? " selected" : ""}`}
        onClick={(e) => onSelect(node.path, e.metaKey || e.ctrlKey)}
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
        title={node.path}
      >
        <span className="tree-icon tree-file-icon">📄</span>
        <span className="tree-name">{node.title ?? node.name.replace(/\.md$/, "")}</span>
      </button>
    </li>
  );
}

export default function FileTree({ tree, loading, selectedFile, onSelect }: FileTreeProps) {
  const navRef = useRef<HTMLElement>(null);

  const totalFiles = useMemo(() => {
    function count(nodes: TreeNode[]): number {
      let n = 0;
      for (const node of nodes) {
        if (node.type === "file") n++;
        if (node.children) n += count(node.children);
      }
      return n;
    }
    return count(tree);
  }, [tree]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();

    const buttons = Array.from(
      navRef.current?.querySelectorAll<HTMLButtonElement>(".tree-file-button") ?? [],
    );
    if (buttons.length === 0) return;

    const currentIndex = buttons.findIndex((btn) => btn.classList.contains("selected"));
    const nextIndex =
      e.key === "ArrowDown"
        ? Math.min(currentIndex + 1, buttons.length - 1)
        : Math.max(currentIndex - 1, 0);

    if (nextIndex !== currentIndex) {
      const btn = buttons[nextIndex];
      btn.focus();
      onSelect(btn.title, false);
    }
  }

  if (loading) {
    return (
      <div className="file-tree-empty">
        <p>Loading files…</p>
      </div>
    );
  }

  if (tree.length === 0) {
    return (
      <div className="file-tree-empty">
        <p>No files</p>
      </div>
    );
  }

  return (
    <nav className="file-tree" aria-label="File tree" ref={navRef} onKeyDown={handleKeyDown}>
      {totalFiles > 1000 && (
        <div className="tree-summary">{totalFiles.toLocaleString()} files</div>
      )}
      <ul role="tree">
        {tree.map((node) => (
          <TreeItem
            key={node.path}
            node={node}
            selectedFile={selectedFile}
            onSelect={onSelect}
            depth={0}
            defaultExpanded={tree.length === 1}
          />
        ))}
      </ul>
    </nav>
  );
}
