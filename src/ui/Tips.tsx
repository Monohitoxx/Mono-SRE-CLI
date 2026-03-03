import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";

const SRE_TIPS = [
  "Use /help to see all available commands",
  "Create SKILL.md files in .reason/skills/ to add custom workflows",
  "Configure allowed commands in .reason/settings.json",
  "Run remote operations by targeting host, hosts, or tags from inventory",
  "Use /clear to start a fresh conversation",
  "Change AI models by editing .reason/.env (PROVIDER & MODEL)",
  "I can run kubectl, docker, and systemctl commands for you",
  "Ask me to check disk space, memory, or CPU on remote servers",
  "I follow the allow/deny list in settings.json for safety",
  "Troubleshoot services: ask me to check logs with journalctl",
  "I support both password and SSH key authentication",
  "Ask me to analyze logs for errors and patterns",
  "I can help debug Kubernetes pods, deployments, and services",
  "For security, I always confirm before running destructive commands",
  "Use inventory_lookup before operating on remote machines",
];

export function Tips() {
  const [tip] = useState(
    () => SRE_TIPS[Math.floor(Math.random() * SRE_TIPS.length)],
  );

  return (
    <Box marginTop={1} paddingX={2} flexDirection="column">
      <Text color="gray">
        Tips for getting started:
      </Text>
      <Text color="gray">
        1. <Text color="white">/help</Text> for available commands
      </Text>
      <Text color="gray">
        2. Ask DevOps questions, manage servers, or troubleshoot issues
      </Text>
      <Text color="gray">
        3. Be specific for the best results
      </Text>
      <Box marginTop={1}>
        <Text color="yellow" dimColor>
          {"💡 "}
          {tip}
        </Text>
      </Box>
    </Box>
  );
}

export function LoadingTip() {
  const [tipIndex, setTipIndex] = useState(
    () => Math.floor(Math.random() * SRE_TIPS.length),
  );

  useEffect(() => {
    const interval = setInterval(() => {
      setTipIndex((prev) => (prev + 1) % SRE_TIPS.length);
    }, 8000);
    return () => clearInterval(interval);
  }, []);

  return (
    <Text color="gray" dimColor>
      {"💡 "}
      {SRE_TIPS[tipIndex]}
    </Text>
  );
}
