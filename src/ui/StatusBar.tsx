import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { Spinner } from "./Spinner.js";

interface StatusBarProps {
  provider: string;
  model: string;
  isLoading: boolean;
  sshConnected?: string;
  rootMode?: boolean;
  elapsedMs: number;
  tokens: number;
}

const ACTIVITY_FRAMES = [
  "▁▂▃▄▅▆▅▄▃▂",
  "▂▃▄▅▆▇▆▅▄▃",
  "▃▄▅▆▇█▇▆▅▄",
  "▄▅▆▇█▇▆▅▄▃",
];

export function StatusBar({ provider, model, isLoading, sshConnected, rootMode, elapsedMs, tokens }: StatusBarProps) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!isLoading) return;
    const timer = setInterval(() => {
      setFrame((prev) => (prev + 1) % ACTIVITY_FRAMES.length);
    }, 300);
    return () => clearInterval(timer);
  }, [isLoading]);

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
      </Box>
      <Box gap={2}>
        {sshConnected && (
          <Text color="green">SSH {sshConnected}</Text>
        )}
        {isLoading && (
          <Text color="yellow" dimColor>
            {ACTIVITY_FRAMES[frame]}
          </Text>
        )}
        {isLoading && <Spinner label="thinking" elapsedMs={elapsedMs} tokens={tokens} />}
      </Box>
    </Box>
  );
}
