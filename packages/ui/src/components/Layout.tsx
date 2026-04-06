import type { ReactNode } from "react";

interface LayoutProps {
  sidebar: ReactNode;
  main: ReactNode;
  sidebarOpen: boolean;
  sidebarWidth: number;
  onResizeStart: (e: React.MouseEvent) => void;
  onToggleSidebar: () => void;
  isMobile?: boolean;
}

export function isPublishedDeployment(): boolean {
  return window.location.hostname.endsWith(".workers.dev");
}

export default function Layout({
  sidebar,
  main,
  sidebarOpen,
  sidebarWidth,
  onResizeStart,
  onToggleSidebar,
  isMobile = false,
}: LayoutProps) {
  return (
    <div className={`layout${isMobile ? " layout-mobile" : ""}`}>
      {/* Desktop: narrow ribbon toggle */}
      {!isMobile && (
        <button
          className="sidebar-toggle-ribbon"
          onClick={onToggleSidebar}
          title={`${sidebarOpen ? "Collapse" : "Expand"} sidebar`}
          aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
        >
          {sidebarOpen ? "\u25C0" : "\u25B6"}
        </button>
      )}
      {/* Mobile: sidebar as full-screen overlay */}
      {isMobile && sidebarOpen && (
        <div className="mobile-panel-overlay" onClick={onToggleSidebar}>
          <aside
            className="sidebar mobile-sidebar"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mobile-sidebar-header">
              <span className="mobile-sidebar-title">Files</span>
              <button
                className="mobile-sidebar-close"
                onClick={onToggleSidebar}
                aria-label="Close sidebar"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/>
                  <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
            {sidebar}
          </aside>
        </div>
      )}
      {/* Desktop: inline sidebar */}
      {!isMobile && sidebarOpen && (
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
