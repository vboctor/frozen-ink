import { memo, useState, useRef, useEffect, useMemo } from "react";
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

const LARGE_DIR_THRESHOLD = 1000;
const PAGE_SIZE = 1000;

/**
 * Return true if `selectedFile` is at or beneath `node`. Used to decide whether
 * this directory's visibleCount needs bumping to reveal an externally-selected
 * file (e.g. one clicked from search) that would otherwise sit past the current
 * pagination cut-off.
 */
function containsPath(node: TreeNode, selectedFile: string | null): boolean {
  if (!selectedFile) return false;
  if (node.path === selectedFile) return true;
  if (!node.children) return false;
  return node.children.some((child) => containsPath(child, selectedFile));
}

const TreeItem = memo(function TreeItem({ node, selectedFile, onSelect, depth, defaultExpanded = false }: TreeItemProps) {
  const [expanded, setExpanded] = useState(node.expanded !== false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // When a file outside the currently-paginated slice is selected (e.g. via
  // search), bump visibleCount so the containing subtree is rendered and
  // scrollIntoView has something to land on.
  useEffect(() => {
    if (node.type !== "directory" || !selectedFile) return;
    const children = node.children ?? [];
    if (children.length <= LARGE_DIR_THRESHOLD) return;
    const idx = children.findIndex((child) => containsPath(child, selectedFile));
    if (idx < 0) return;
    if (idx + 1 > visibleCount) {
      // Round up to the next page boundary so the user sees some context below
      // the selected row instead of it landing right at the cut-off.
      const bumped = Math.ceil((idx + 1) / PAGE_SIZE) * PAGE_SIZE;
      setVisibleCount(bumped);
    }
  }, [selectedFile, node, visibleCount]);

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
});

export default function FileTree({ tree, loading, selectedFile, onSelect }: FileTreeProps) {
  const { totalFiles, flatFilePaths } = useMemo(() => {
    const paths: string[] = [];
    function walk(nodes: TreeNode[]): number {
      let n = 0;
      for (const node of nodes) {
        if (node.type === "file") { n++; paths.push(node.path); }
        if (node.children) n += walk(node.children);
      }
      return n;
    }
    return { totalFiles: walk(tree), flatFilePaths: paths };
  }, [tree]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    if (flatFilePaths.length === 0) return;

    const currentIndex = selectedFile ? flatFilePaths.indexOf(selectedFile) : -1;
    const nextIndex =
      e.key === "ArrowDown"
        ? Math.min(currentIndex + 1, flatFilePaths.length - 1)
        : Math.max(currentIndex - 1, 0);

    if (nextIndex !== currentIndex && nextIndex >= 0) {
      onSelect(flatFilePaths[nextIndex], false);
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
    <nav className="file-tree" aria-label="File tree" onKeyDown={handleKeyDown}>
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
