import React from "react";
import { Box, Text, useStdout } from "ink";
import { GradientText } from "./Gradient.js";
import { pickLogo } from "./AsciiArt.js";
import { Tips } from "./Tips.js";

interface HeaderProps {
  provider: string;
  model: string;
  version?: string;
}

export function Header({ provider, model, version = "0.1.0" }: HeaderProps) {
  const { stdout } = useStdout();
  const terminalWidth = stdout?.columns ?? 80;
  const logo = pickLogo(terminalWidth);

  return (
    <Box flexDirection="column">
      <Box paddingX={1} marginTop={1}>
        <GradientText>{logo}</GradientText>
      </Box>
      <Box paddingX={2} flexDirection="row" gap={2}>
        <Text bold color="cyan">
          SRE AI
        </Text>
        <Text dimColor>v{version}</Text>
        <Text dimColor>|</Text>
        <Text color="white">
          {provider}/<Text bold>{model}</Text>
        </Text>
      </Box>
      <Tips />
    </Box>
  );
}
