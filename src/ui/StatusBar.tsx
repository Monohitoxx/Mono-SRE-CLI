import React from "react";
import { Box, Text } from "ink";

interface StatusBarProps {
  provider: string;
  model: string;
  isLoading: boolean;
  sshConnected?: string;
  rootMode?: boolean;
}

export function StatusBar({ provider, model, isLoading, sshConnected, rootMode }: StatusBarProps) {
  return (
    <Box
      borderStyle="single"
      borderColor={rootMode ? "red" : "gray"}
      paddingX={1}
      justifyContent="space-between"
    >
      <Box gap={2}>
        <Text bold color="cyan">
          SRE AI
        </Text>
        <Text dimColor>
          {provider}/{model}
        </Text>
        {rootMode && (
          <Text bold color="red">
            ROOT
          </Text>
        )}
      </Box>
      <Box gap={2}>
        {sshConnected && (
          <Text color="green">SSH: {sshConnected}</Text>
        )}
        {isLoading && <Text color="yellow">thinking...</Text>}
      </Box>
    </Box>
  );
}
