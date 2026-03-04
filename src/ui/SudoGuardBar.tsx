import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

interface SudoGuardBarProps {
  connectionId: string;
  command: string;
  onConfirm: (approved: boolean) => void;
}

export function SudoGuardBar({
  connectionId,
  command,
  onConfirm,
}: SudoGuardBarProps) {
  const [selectedIdx, setSelectedIdx] = useState(0);

  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedIdx((prev) => Math.max(0, prev - 1));
    } else if (key.downArrow) {
      setSelectedIdx((prev) => Math.min(1, prev + 1));
    } else if (key.return) {
      onConfirm(selectedIdx === 0);
    } else if (input === "1") {
      onConfirm(true);
    } else if (input === "2") {
      onConfirm(false);
    }
  });

  const options = [
    { label: "Yes, escalate to sudo", color: "green" as const },
    { label: "No, deny", color: "red" as const },
  ];

  return (
    <Box
      flexDirection="column"
      borderStyle="double"
      borderColor="red"
      paddingX={1}
    >
      <Text bold color="red">
        SUDO GUARD
      </Text>
      <Text color="white">
        <Text bold>Host: </Text>
        {connectionId}
      </Text>
      <Text color="white">
        <Text bold>Command: </Text>
        sudo {command}
      </Text>
      <Text> </Text>
      <Text color="yellow">
        This command will execute with ROOT privileges on the remote host.
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {options.map((opt, i) => {
          const isSelected = i === selectedIdx;
          return (
            <Text key={i} color={isSelected ? opt.color : "gray"}>
              {isSelected ? "❯" : " "} {i + 1}. {opt.label}
            </Text>
          );
        })}
        <Box marginTop={1}>
          <Text dimColor>↑↓ navigate  ·  Enter select  ·  1 / 2 shortcut</Text>
        </Box>
      </Box>
    </Box>
  );
}
