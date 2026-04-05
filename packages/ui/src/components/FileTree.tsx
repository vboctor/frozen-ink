import { useState, useRef, useEffect } from "react";
import type { TreeNode } from "../types";

interface FileTreeProps {
  tree: TreeNode[];
  selectedFile: string | null;
  onSelect: (path: string, openNewTab: boolean) => void;
}

interface TreeItemProps {
  node: TreeNode;
  selectedFile: string | null;
  onSelect: (path: string, openNewTab: boolean) => void;
  depth: number;
}

function TreeItem({ node, selectedFile, onSelect, depth }: TreeItemProps) {
  const [expanded, setExpanded] = useState(true);

  if (node.type === "directory") {
    return (
      <li className="tree-directory" role="treeitem" aria-expanded={expanded}>
        <button
          className="tree-toggle"
          onClick={() => setExpanded(!expanded)}
          style={{ paddingLeft: `${depth * 16 + 4}px` }}
        >
          <span className="tree-icon">{expanded ? "▼" : "▶"}</span>
          <span className="tree-name">{node.name}</span>
        </button>
        {expanded && node.children && (
          <ul className="tree-children" role="group">
            {node.children.map((child) => (
              <TreeItem
                key={child.path}
                node={child}
                selectedFile={selectedFile}
                onSelect={onSelect}
                depth={depth + 1}
              />
            ))}
          </ul>
        )}
      </li>
    );
  }

  const isSelected = node.path === selectedFile;
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isSelected) {
      btnRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
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
        <span className="tree-name">{node.name.replace(/\.md$/, "")}</span>
      </button>
    </li>
  );
}

export default function FileTree({ tree, selectedFile, onSelect }: FileTreeProps) {
  const navRef = useRef<HTMLElement>(null);

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

  if (tree.length === 0) {
    return (
      <div className="file-tree-empty">
        <p>No files</p>
      </div>
    );
  }

  return (
    <nav className="file-tree" aria-label="File tree" ref={navRef} onKeyDown={handleKeyDown}>
      <ul role="tree">
        {tree.map((node) => (
          <TreeItem
            key={node.path}
            node={node}
            selectedFile={selectedFile}
            onSelect={onSelect}
            depth={0}
          />
        ))}
      </ul>
    </nav>
  );
}
