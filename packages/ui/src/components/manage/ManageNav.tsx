export type ManageSection = "collections";

interface ManageNavProps {
  active: ManageSection;
  onSelect: (section: ManageSection) => void;
}

export default function ManageNav({ active, onSelect }: ManageNavProps) {
  // Single section — no nav needed
  return null;
}
