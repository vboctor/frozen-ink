import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

export interface MultiSelectItem {
  label: string;
  value: string;
  enabled?: boolean;
}

interface Props {
  items: MultiSelectItem[];
  onSubmit: (selected: string[]) => void;
  label?: string;
}

/**
 * Multi-select input: arrow keys to navigate, space to toggle, enter to confirm.
 * Items with `enabled: false` are shown but cannot be selected.
 */
export function MultiSelectInput({
  items,
  onSubmit,
  label,
}: Props): React.ReactElement {
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    for (const item of items) {
      if (item.enabled !== false) initial.add(item.value);
    }
    return initial;
  });

  useInput((input, key) => {
    if (key.upArrow) {
      setIndex((i) => (i > 0 ? i - 1 : items.length - 1));
    }
    if (key.downArrow) {
      setIndex((i) => (i < items.length - 1 ? i + 1 : 0));
    }
    if (input === " ") {
      const item = items[index];
      if (item.enabled === false) return;
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(item.value)) {
          next.delete(item.value);
        } else {
          next.add(item.value);
        }
        return next;
      });
    }
    if (key.return) {
      onSubmit([...selected]);
    }
  });

  return (
    <Box flexDirection="column">
      {label && (
        <Text bold color="cyan">
          {label}
        </Text>
      )}
      {items.map((item, i) => {
        const isSelected = selected.has(item.value);
        const isDisabled = item.enabled === false;
        const cursor = i === index ? ">" : " ";
        const check = isDisabled ? "-" : isSelected ? "x" : " ";
        const color = isDisabled ? "gray" : i === index ? "cyan" : undefined;
        return (
          <Box key={item.value}>
            <Text color={color}>
              {cursor} [{check}] {item.label}
              {isDisabled && " (not available)"}
            </Text>
          </Box>
        );
      })}
      <Text dimColor>Space to toggle, Enter to confirm</Text>
    </Box>
  );
}
