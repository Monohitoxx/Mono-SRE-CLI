import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { SessionInfo } from "../utils/session-manager.js";

interface SessionPickerProps {
  sessions: SessionInfo[];
  onSelect: (sessionId: string) => void;
  onCancel: () => void;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${mm}/${dd} ${hh}:${min}`;
}

export function SessionPicker({ sessions, onSelect, onCancel }: SessionPickerProps) {
  const [selectedIdx, setSelectedIdx] = useState(0);

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.return) {
      if (sessions.length > 0) {
        onSelect(sessions[selectedIdx].id);
      }
      return;
    }

    if (key.upArrow) {
      setSelectedIdx((prev) => (prev > 0 ? prev - 1 : sessions.length - 1));
      return;
    }

    if (key.downArrow) {
      setSelectedIdx((prev) => (prev < sessions.length - 1 ? prev + 1 : 0));
      return;
    }

    // Number keys 1-9 for quick select
    const num = parseInt(input, 10);
    if (num >= 1 && num <= sessions.length) {
      onSelect(sessions[num - 1].id);
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
    >
      <Text color="cyan" bold>
        Resume Session
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {sessions.map((s, i) => {
          const isActive = i === selectedIdx;
          const prefix = isActive ? ">" : " ";
          const num = `${i + 1}.`;
          const date = formatDate(s.updatedAt);
          const msgs = `(${s.messageCount} msgs)`;
          const preview = s.preview.length > 40 ? s.preview.slice(0, 37) + "..." : s.preview;

          return (
            <Box key={s.id}>
              <Text color={isActive ? "cyan" : "white"} bold={isActive}>
                {`${prefix} ${num} ${date}  ${msgs.padEnd(12)} ${preview}`}
              </Text>
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text color="gray" dimColor>
          {"  Up/Down navigate | Enter select | Esc cancel"}
        </Text>
      </Box>
    </Box>
  );
}
