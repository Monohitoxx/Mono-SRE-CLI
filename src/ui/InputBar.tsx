import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { getCommands } from "../commands/index.js";

interface InputBarProps {
  onSubmit: (value: string) => void;
  isDisabled: boolean;
}

export const InputBar = React.memo(function InputBar({ onSubmit, isDisabled }: InputBarProps) {
  const [value, setValue] = useState("");
  const [cursor, setCursor] = useState(0);
  const [suggestionIdx, setSuggestionIdx] = useState(0);

  // Compute suggestions only when typing a bare slash command (no space yet)
  const isSlashIncomplete = value.startsWith("/") && !value.includes(" ");
  const suggestions = isSlashIncomplete
    ? getCommands().filter((cmd) =>
        `/${cmd.name}`.startsWith(value.toLowerCase()) ||
        cmd.aliases?.some((a) => `/${a}`.startsWith(value.toLowerCase()))
      )
    : [];

  useInput((input, key) => {
    if (isDisabled) return;

    if (key.return) {
      // If a suggestion is highlighted, complete and submit it
      const toSubmit = suggestions.length > 0
        ? `/${suggestions[suggestionIdx % suggestions.length].name}`
        : value.trim();
      if (toSubmit) {
        onSubmit(toSubmit);
        setValue("");
        setCursor(0);
        setSuggestionIdx(0);
      }
      return;
    }

    // ↓ / ↑: navigate suggestions
    if (key.downArrow) {
      if (suggestions.length > 0) {
        setSuggestionIdx((suggestionIdx + 1) % suggestions.length);
      }
      return;
    }

    if (key.upArrow) {
      if (suggestions.length > 0) {
        setSuggestionIdx((suggestionIdx - 1 + suggestions.length) % suggestions.length);
      }
      return;
    }

    // Tab: complete currently selected suggestion
    if (key.tab) {
      if (suggestions.length === 0) return;
      const completed = `/${suggestions[suggestionIdx % suggestions.length].name} `;
      setValue(completed);
      setCursor(completed.length);
      return;
    }

    if (key.backspace || key.delete) {
      if (cursor > 0) {
        setValue(value.slice(0, cursor - 1) + value.slice(cursor));
        setCursor(cursor - 1);
        setSuggestionIdx(0);
      }
      return;
    }

    // Ctrl+D or Delete forward
    if (key.ctrl && input === "d") {
      if (cursor < value.length) {
        setValue(value.slice(0, cursor) + value.slice(cursor + 1));
        setSuggestionIdx(0);
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
      setSuggestionIdx(0);
      return;
    }

    // Ctrl+K: clear line after cursor
    if (key.ctrl && input === "k") {
      setValue(value.slice(0, cursor));
      setSuggestionIdx(0);
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
      setSuggestionIdx(0);
    }
  });

  const activeSuggestionIdx = suggestions.length > 0 ? suggestionIdx % suggestions.length : -1;

  return (
    <Box flexDirection="column">
      {suggestions.length > 0 && (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="green"
          paddingX={1}
          marginBottom={0}
        >
          {suggestions.map((cmd, i) => {
            const isActive = i === activeSuggestionIdx;
            return (
              <Box key={cmd.name}>
                <Text color={isActive ? "green" : "gray"} bold={isActive}>
                  {isActive ? "▸ " : "  "}
                </Text>
                <Text color={isActive ? "green" : "gray"} bold={isActive}>
                  {"/" + cmd.name}
                </Text>
                <Text color="gray" dimColor>
                  {"  " + cmd.description}
                </Text>
              </Box>
            );
          })}
          <Text color="gray" dimColor>
            {"  [Tab] to complete"}
          </Text>
        </Box>
      )}
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
    </Box>
  );
});
