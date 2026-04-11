import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

export interface SelectItem {
  label: string;
  value: string;
}

interface Props {
  items: SelectItem[];
  onSelect: (item: SelectItem) => void;
  label?: string;
}

export function SelectInput({
  items,
  onSelect,
  label,
}: Props): React.ReactElement {
  const [index, setIndex] = useState(0);

  useInput((_input, key) => {
    if (key.upArrow) {
      setIndex((i) => (i > 0 ? i - 1 : items.length - 1));
    }
    if (key.downArrow) {
      setIndex((i) => (i < items.length - 1 ? i + 1 : 0));
    }
    if (key.return) {
      onSelect(items[index]);
    }
  });

  return (
    <Box flexDirection="column">
      {label && (
        <Text bold color="cyan">
          {label}
        </Text>
      )}
      {items.map((item, i) => (
        <Box key={item.value}>
          <Text color={i === index ? "cyan" : undefined}>
            {i === index ? "❯ " : "  "}
            {item.label}
          </Text>
        </Box>
      ))}
    </Box>
  );
}
