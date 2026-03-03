import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

interface InputBarProps {
  onSubmit: (value: string) => void;
  isDisabled: boolean;
}

export function InputBar({ onSubmit, isDisabled }: InputBarProps) {
  const [value, setValue] = useState("");
  const [cursorOffset, setCursorOffset] = useState(0);

  useInput((input, key) => {
    if (isDisabled) return;

    if (key.return) {
      const trimmed = value.trim();
      if (trimmed) {
        onSubmit(trimmed);
        setValue("");
        setCursorOffset(0);
      }
      return;
    }

    if (key.backspace || key.delete) {
      if (value.length > 0) {
        setValue(value.slice(0, -1));
      }
      return;
    }

    if (key.ctrl && input === "c") {
      process.exit(0);
    }

    if (key.ctrl && input === "l") {
      return;
    }

    if (!key.ctrl && !key.meta && input) {
      setValue(value + input);
    }
  });

  return (
    <Box borderStyle="single" borderColor={isDisabled ? "gray" : "green"} paddingX={1}>
      <Text color={isDisabled ? "gray" : "green"} bold>
        {"❯ "}
      </Text>
      <Text>{value}</Text>
      {!isDisabled && <Text color="green">█</Text>}
    </Box>
  );
}
