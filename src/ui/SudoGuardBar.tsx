import React from "react";
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
  useInput((input, key) => {
    if (input === "y" || input === "Y" || key.return) {
      onConfirm(true);
    } else if (input === "n" || input === "N" || key.escape) {
      onConfirm(false);
    }
  });

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
      <Box marginTop={1}>
        <Text color="green" bold>
          [Y]es
        </Text>
        <Text> / </Text>
        <Text color="red" bold>
          [N]o
        </Text>
      </Box>
    </Box>
  );
}
