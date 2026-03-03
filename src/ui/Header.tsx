import React, { useEffect, useState } from "react";
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
  const pulse = ["◢", "◣", "◤", "◥"];
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((prev) => (prev + 1) % pulse.length);
    }, 180);
    return () => clearInterval(timer);
  }, [pulse.length]);

  return (
    <Box flexDirection="column">
      <Box paddingX={1} marginTop={1}>
        <GradientText>{logo}</GradientText>
      </Box>
      <Box
        marginTop={1}
        marginX={1}
        paddingX={1}
        borderStyle="round"
        borderColor="cyan"
        flexDirection="column"
      >
        <Box flexDirection="row" gap={2}>
          <Text bold color="cyan">
            SRE AI
          </Text>
          <Text dimColor>v{version}</Text>
          <Text dimColor>|</Text>
          <Text color="white">
            {provider}/<Text bold>{model}</Text>
          </Text>
        </Box>
        <Text color="yellow">
          {`${pulse[frame]} LIVE OPS CONSOLE ${pulse[(frame + 2) % pulse.length]}`}
        </Text>
      </Box>
      <Tips />
    </Box>
  );
}
