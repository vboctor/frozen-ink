import { useState } from "react";
import type { TreeNode } from "../types";

interface FileTreeProps {
  tree: TreeNode[];
  selectedFile: string | null;
  onSelect: (path: string) => void;
}

interface TreeItemProps {
  node: TreeNode;
  selectedFile: string | null;
  onSelect: (path: string) => void;
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
  return (
    <li className="tree-file" role="treeitem">
      <button
        className={`tree-file-button${isSelected ? " selected" : ""}`}
        onClick={() => onSelect(node.path)}
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
        title={node.path}
      >
        <span className="tree-icon">📄</span>
        <span className="tree-name">{node.name.replace(/\.md$/, "")}</span>
      </button>
    </li>
  );
}

export default function FileTree({ tree, selectedFile, onSelect }: FileTreeProps) {
  if (tree.length === 0) {
    return (
      <div className="file-tree-empty">
        <p>No files</p>
      </div>
    );
  }

  return (
    <nav className="file-tree" aria-label="File tree">
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
