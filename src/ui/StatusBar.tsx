import React from "react";
import { Box, Text } from "ink";
import { Spinner } from "./Spinner.js";

interface StatusBarProps {
  provider: string;
  model: string;
  isLoading: boolean;
  sshConnected?: string;
  rootMode?: boolean;
  startTime: number;
  tokens: number;
  showFlow?: boolean;
}

export const StatusBar = React.memo(function StatusBar({
  provider,
  model,
  isLoading,
  sshConnected,
  rootMode,
  startTime,
  tokens,
  showFlow,
}: StatusBarProps) {
  return (
    <Box
      borderStyle="round"
      borderColor={rootMode ? "red" : isLoading ? "yellow" : "gray"}
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
        {!showFlow && (
          <Text dimColor>▸ flow hidden</Text>
        )}
      </Box>
      <Box gap={2}>
        {sshConnected && (
          <Text color="green">SSH {sshConnected}</Text>
        )}
        {isLoading && (
          <Spinner label="thinking" startTime={startTime} tokens={tokens} />
        )}
      </Box>
    </Box>
  );
});
