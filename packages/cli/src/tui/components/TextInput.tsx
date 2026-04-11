import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

interface Props {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  mask?: boolean;
}

export function TextInput({
  label,
  value,
  onChange,
  onSubmit,
  placeholder,
  mask,
}: Props): React.ReactElement {
  useInput((input, key) => {
    if (key.return) {
      onSubmit();
      return;
    }
    if (key.backspace || key.delete) {
      onChange(value.slice(0, -1));
      return;
    }
    if (
      !key.ctrl &&
      !key.meta &&
      !key.escape &&
      !key.upArrow &&
      !key.downArrow &&
      !key.leftArrow &&
      !key.rightArrow &&
      !key.tab &&
      input
    ) {
      onChange(value + input);
    }
  });

  const display = mask ? "*".repeat(value.length) : value;
  const showPlaceholder = !value && placeholder;

  return (
    <Box>
      <Text color="cyan">? </Text>
      <Text bold>{label}: </Text>
      {showPlaceholder ? (
        <Text dimColor>{placeholder}</Text>
      ) : (
        <Text>{display}</Text>
      )}
      <Text color="cyan">█</Text>
    </Box>
  );
}
