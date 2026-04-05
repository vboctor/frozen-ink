import type { ReactNode } from "react";

interface LayoutProps {
  sidebar: ReactNode;
  main: ReactNode;
  sidebarOpen: boolean;
  sidebarWidth: number;
  onResizeStart: (e: React.MouseEvent) => void;
  onToggleSidebar: () => void;
}

export default function Layout({
  sidebar,
  main,
  sidebarOpen,
  sidebarWidth,
  onResizeStart,
  onToggleSidebar,
}: LayoutProps) {
  return (
    <div className="layout">
      <button
        className="sidebar-toggle-ribbon"
        onClick={onToggleSidebar}
        title={`${sidebarOpen ? "Collapse" : "Expand"} sidebar (⌘\\)`}
        aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
      >
        {sidebarOpen ? "◀" : "▶"}
      </button>
      {sidebarOpen && (
        <aside
          className="sidebar"
          style={{ width: sidebarWidth, minWidth: sidebarWidth }}
        >
          {sidebar}
          <div
            className="sidebar-resize-handle"
            onMouseDown={onResizeStart}
            title="Drag to resize sidebar"
          />
        </aside>
      )}
      <main className="main-content">{main}</main>
    </div>
  );
}
