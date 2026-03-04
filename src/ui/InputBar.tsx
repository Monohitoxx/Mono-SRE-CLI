import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

interface InputBarProps {
  onSubmit: (value: string) => void;
  isDisabled: boolean;
}

export const InputBar = React.memo(function InputBar({ onSubmit, isDisabled }: InputBarProps) {
  const [value, setValue] = useState("");
  const [cursor, setCursor] = useState(0);

  useInput((input, key) => {
    if (isDisabled) return;

    if (key.return) {
      const trimmed = value.trim();
      if (trimmed) {
        onSubmit(trimmed);
        setValue("");
        setCursor(0);
      }
      return;
    }

    if (key.backspace || key.delete) {
      if (cursor > 0) {
        setValue(value.slice(0, cursor - 1) + value.slice(cursor));
        setCursor(cursor - 1);
      }
      return;
    }

    // Ctrl+D or Delete forward
    if (key.ctrl && input === "d") {
      if (cursor < value.length) {
        setValue(value.slice(0, cursor) + value.slice(cursor + 1));
      }
      return;
    }

    if (key.leftArrow) {
      if (cursor > 0) setCursor(cursor - 1);
      return;
    }

    if (key.rightArrow) {
      if (cursor < value.length) setCursor(cursor + 1);
      return;
    }

    // Home / Ctrl+A
    if (key.ctrl && input === "a") {
      setCursor(0);
      return;
    }

    // End / Ctrl+E
    if (key.ctrl && input === "e") {
      setCursor(value.length);
      return;
    }

    // Ctrl+U: clear line before cursor
    if (key.ctrl && input === "u") {
      setValue(value.slice(cursor));
      setCursor(0);
      return;
    }

    // Ctrl+K: clear line after cursor
    if (key.ctrl && input === "k") {
      setValue(value.slice(0, cursor));
      return;
    }

    if (key.ctrl && input === "c") {
      process.exit(0);
    }

    if (key.ctrl && input === "l") {
      return;
    }

    if (!key.ctrl && !key.meta && input) {
      setValue(value.slice(0, cursor) + input + value.slice(cursor));
      setCursor(cursor + input.length);
    }
  });

  return (
    <Box
      borderStyle="round"
      borderColor={isDisabled ? "gray" : "green"}
      paddingX={1}
    >
      <Text color={isDisabled ? "gray" : "green"} bold>
        {"❯ "}
      </Text>
      {value ? (
        <>
          <Text color="white">{value.slice(0, cursor)}</Text>
          <Text color="green" inverse={!isDisabled}>
            {cursor < value.length ? value[cursor] : " "}
          </Text>
          {cursor < value.length && (
            <Text color="white">{value.slice(cursor + 1)}</Text>
          )}
        </>
      ) : (
        <Text color="gray" dimColor>
          Type a message...
        </Text>
      )}
    </Box>
  );
});
