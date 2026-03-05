import React, { useState, useRef, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { getCommands } from "../commands/index.js";

interface InputBarProps {
  onSubmit: (value: string) => void;
  isDisabled: boolean;
}

export const InputBar = React.memo(function InputBar({ onSubmit, isDisabled }: InputBarProps) {
  // Use refs for immediate mutation (avoids stale closure on rapid paste)
  const valueRef = useRef("");
  const cursorRef = useRef(0);
  const [, setTick] = useState(0);
  const rerender = useCallback(() => setTick((t) => t + 1), []);
  const [suggestionIdx, setSuggestionIdx] = useState(0);

  const value = valueRef.current;
  const cursor = cursorRef.current;

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
        : valueRef.current.trim();
      if (toSubmit) {
        onSubmit(toSubmit);
        valueRef.current = "";
        cursorRef.current = 0;
        setSuggestionIdx(0);
        rerender();
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
      valueRef.current = completed;
      cursorRef.current = completed.length;
      rerender();
      return;
    }

    if (key.backspace || key.delete) {
      if (cursorRef.current > 0) {
        valueRef.current = valueRef.current.slice(0, cursorRef.current - 1) + valueRef.current.slice(cursorRef.current);
        cursorRef.current--;
        setSuggestionIdx(0);
        rerender();
      }
      return;
    }

    // Ctrl+D or Delete forward
    if (key.ctrl && input === "d") {
      if (cursorRef.current < valueRef.current.length) {
        valueRef.current = valueRef.current.slice(0, cursorRef.current) + valueRef.current.slice(cursorRef.current + 1);
        setSuggestionIdx(0);
        rerender();
      }
      return;
    }

    if (key.leftArrow) {
      if (cursorRef.current > 0) { cursorRef.current--; rerender(); }
      return;
    }

    if (key.rightArrow) {
      if (cursorRef.current < valueRef.current.length) { cursorRef.current++; rerender(); }
      return;
    }

    // Home / Ctrl+A
    if (key.ctrl && input === "a") {
      cursorRef.current = 0;
      rerender();
      return;
    }

    // End / Ctrl+E
    if (key.ctrl && input === "e") {
      cursorRef.current = valueRef.current.length;
      rerender();
      return;
    }

    // Ctrl+U: clear line before cursor
    if (key.ctrl && input === "u") {
      valueRef.current = valueRef.current.slice(cursorRef.current);
      cursorRef.current = 0;
      setSuggestionIdx(0);
      rerender();
      return;
    }

    // Ctrl+K: clear line after cursor
    if (key.ctrl && input === "k") {
      valueRef.current = valueRef.current.slice(0, cursorRef.current);
      setSuggestionIdx(0);
      rerender();
      return;
    }

    if (key.ctrl && input === "c") {
      process.exit(0);
    }

    if (key.ctrl && input === "l") {
      return;
    }

    if (!key.ctrl && !key.meta && input) {
      valueRef.current = valueRef.current.slice(0, cursorRef.current) + input + valueRef.current.slice(cursorRef.current);
      cursorRef.current += input.length;
      setSuggestionIdx(0);
      rerender();
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
