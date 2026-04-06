import type { ReactNode } from "react";

interface LayoutProps {
  sidebar: ReactNode;
  main: ReactNode;
  sidebarOpen: boolean;
  sidebarWidth: number;
  onResizeStart: (e: React.MouseEvent) => void;
  onToggleSidebar: () => void;
}

function isPublishedDeployment(): boolean {
  // Published deployments run on workers.dev — show logout there
  return window.location.hostname.endsWith(".workers.dev");
}

export default function Layout({
  sidebar,
  main,
  sidebarOpen,
  sidebarWidth,
  onResizeStart,
  onToggleSidebar,
}: LayoutProps) {
  const showLogout = isPublishedDeployment();

  return (
    <div className="layout">
      <button
        className="sidebar-toggle-ribbon"
        onClick={onToggleSidebar}
        title={`${sidebarOpen ? "Collapse" : "Expand"} sidebar`}
        aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
      >
        {sidebarOpen ? "\u25C0" : "\u25B6"}
      </button>
      {sidebarOpen && (
        <aside
          className="sidebar"
          style={{ width: sidebarWidth, minWidth: sidebarWidth }}
        >
          {sidebar}
          {showLogout && (
            <form method="POST" action="/logout" className="sidebar-logout">
              <button type="submit" className="logout-btn" title="Sign out">
                Logout
              </button>
            </form>
          )}
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
