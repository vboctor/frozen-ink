export type ManageSection = "collections" | "publish" | "mcp" | "export" | "settings";

interface ManageNavProps {
  active: ManageSection;
  onSelect: (section: ManageSection) => void;
}

const sections: { id: ManageSection; label: string }[] = [
  { id: "collections", label: "Collections" },
  { id: "publish", label: "Publish" },
  { id: "mcp", label: "MCP" },
  { id: "export", label: "Export" },
  { id: "settings", label: "Settings" },
];

export default function ManageNav({ active, onSelect }: ManageNavProps) {
  return (
    <nav className="manage-nav">
      {sections.map((s) => (
        <button
          key={s.id}
          className={`manage-nav-item${active === s.id ? " active" : ""}`}
          onClick={() => onSelect(s.id)}
        >
          {s.label}
        </button>
      ))}
    </nav>
  );
}
