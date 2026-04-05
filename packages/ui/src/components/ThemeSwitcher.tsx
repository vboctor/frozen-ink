const THEMES = [
  { id: "default", label: "Default Light" },
  { id: "minimal", label: "Minimal Light" },
  { id: "solarized", label: "Solarized Light" },
  { id: "nord", label: "Nord Dark" },
  { id: "catppuccin", label: "Catppuccin Dark" },
  { id: "dracula", label: "Dracula Dark" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

interface ThemeSwitcherProps {
  current: ThemeId;
  onChange: (theme: ThemeId) => void;
}

export default function ThemeSwitcher({ current, onChange }: ThemeSwitcherProps) {
  return (
    <div className="theme-switcher">
      <label htmlFor="theme-select">Theme</label>
      <select
        id="theme-select"
        value={current}
        onChange={(e) => onChange(e.target.value as ThemeId)}
      >
        {THEMES.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>
    </div>
  );
}
