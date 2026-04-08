interface Workspace {
  name: string;
  path: string;
  lastOpened: string;
}

interface WorkspaceScreenProps {
  workspaces: Workspace[];
  onCreateWorkspace: () => void;
  onOpenWorkspace: () => void;
  onSelectWorkspace: (path: string) => void;
}

export default function WorkspaceScreen({
  workspaces,
  onCreateWorkspace,
  onOpenWorkspace,
  onSelectWorkspace,
}: WorkspaceScreenProps) {
  return (
    <div className="workspace-screen">
      <div className="workspace-header">
        <h1>Frozen Ink</h1>
        <p className="workspace-subtitle">Choose a workspace to get started</p>
      </div>

      <div className="workspace-actions">
        <button className="btn btn-primary" onClick={onCreateWorkspace}>
          Create Workspace
        </button>
        <button className="btn btn-secondary" onClick={onOpenWorkspace}>
          Open Existing Folder
        </button>
      </div>

      {workspaces.length > 0 && (
        <div className="workspace-recent">
          <h3>Recent Workspaces</h3>
          <div className="workspace-list">
            {workspaces.map((ws) => (
              <button
                key={ws.path}
                className="workspace-item"
                onClick={() => onSelectWorkspace(ws.path)}
              >
                <span className="workspace-name">{ws.name}</span>
                <span className="workspace-path">{ws.path}</span>
                <span className="workspace-date">
                  {new Date(ws.lastOpened).toLocaleDateString()}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
