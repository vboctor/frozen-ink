import type { Collection } from "../types";

interface CollectionPickerProps {
  collections: Collection[];
  selected: string | null;
  onSelect: (name: string | null) => void;
}

export default function CollectionPicker({
  collections,
  selected,
  onSelect,
}: CollectionPickerProps) {
  // Hide picker when there's only one collection
  if (collections.length <= 1) return null;

  return (
    <div className="collection-picker">
      <label htmlFor="collection-select">Collection</label>
      <select
        id="collection-select"
        value={selected || ""}
        onChange={(e) => onSelect(e.target.value || null)}
      >
        <option value="">Select a collection...</option>
        {collections.map((c) => (
          <option key={c.name} value={c.name}>
            {c.title}
          </option>
        ))}
      </select>
    </div>
  );
}
