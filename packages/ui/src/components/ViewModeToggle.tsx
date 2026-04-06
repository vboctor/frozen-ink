export type ViewMode = "markdown" | "html";

interface ViewModeToggleProps {
  mode: ViewMode;
  htmlAvailable: boolean;
  onChange: (mode: ViewMode) => void;
}

export default function ViewModeToggle({
  mode,
  htmlAvailable,
  onChange,
}: ViewModeToggleProps) {
  if (!htmlAvailable) return null;

  return (
    <div className="view-mode-toggle">
      <button
        className={`view-mode-btn${mode === "markdown" ? " active" : ""}`}
        onClick={() => onChange("markdown")}
        title="Markdown view"
      >
        <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
          <path d="M14.85 3c.63 0 1.15.52 1.14 1.15v7.7c0 .63-.51 1.15-1.15 1.15H1.15C.52 13 0 12.48 0 11.84V4.15C0 3.52.52 3 1.15 3ZM9 11V5H7l-1.5 2L4 5H2v6h2V8l1.5 1.92L7 8v3Zm2.99.5L14.5 8h-2V5h-2v3h-2Z"/>
        </svg>
      </button>
      <button
        className={`view-mode-btn${mode === "html" ? " active" : ""}`}
        onClick={() => onChange("html")}
        title="Styled HTML view"
      >
        <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
          <path d="M0 0h16v16H0Zm1.5 1.5v4h5.75v-4Zm7.25 0v4h5.75v-4ZM1.5 7v7.5h5.75V7Zm7.25 0v7.5h5.75V7Z"/>
        </svg>
      </button>
    </div>
  );
}
