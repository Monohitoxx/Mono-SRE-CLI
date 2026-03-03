import React from "react";
import { Box, Text, useInput } from "ink";
import type { ToolCall } from "../core/types.js";
import { detectSudo } from "../tools/SSHTool/exec.js";

interface ConfirmBarProps {
  toolCall: ToolCall;
  isRoot?: boolean;
  needsRootEscalation?: boolean;
  onConfirm: (approved: boolean) => void;
}

function describeToolCall(toolCall: ToolCall): string {
  const { name, arguments: args } = toolCall;
  const command = args.command as string | undefined;
  const hasSudo = command ? detectSudo(command) : false;

  switch (name) {
    case "ssh_connect": {
      const authMethod = args.password ? "password" : "key";
      return `SSH connect to ${args.username}@${args.host}${args.port ? `:${args.port}` : ""} (${authMethod} auth)`;
    }
    case "ssh_exec":
      return hasSudo
        ? `Run on remote as ROOT: ${command}`
        : `Run on remote: ${command}`;
    case "ssh_disconnect":
      return `Disconnect SSH: ${args.connectionId}`;
    case "shell":
      return hasSudo
        ? `Run locally as ROOT: ${command}`
        : `Run locally: ${command}`;
    default:
      return `${name}(${JSON.stringify(args)})`;
  }
}

function PlanConfirmBar({
  toolCall,
  onConfirm,
}: {
  toolCall: ToolCall;
  onConfirm: (approved: boolean) => void;
}) {
  useInput((input, key) => {
    if (input === "y" || input === "Y" || key.return) {
      onConfirm(true);
    } else if (input === "n" || input === "N" || key.escape) {
      onConfirm(false);
    }
  });

  const title =
    typeof toolCall.arguments.title === "string" && toolCall.arguments.title
      ? toolCall.arguments.title
      : "Untitled Plan";
  const rawSteps = Array.isArray(toolCall.arguments.steps)
    ? toolCall.arguments.steps
    : [];
  const steps = rawSteps.map((s: Record<string, unknown>, i: number) => ({
    id: typeof s?.id === "number" ? s.id : i + 1,
    title: typeof s?.title === "string" ? s.title : `Step ${i + 1}`,
    description: typeof s?.description === "string" ? s.description : "",
  }));

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
    >
      <Text bold color="cyan">
        {">>> "}Plan: {title}
      </Text>
      <Text> </Text>
      {steps.length === 0 && (
        <Text color="yellow">  (no steps provided)</Text>
      )}
      {steps.map((step) => (
        <Box key={step.id} flexDirection="column" marginLeft={1}>
          <Text>
            <Text color="white" bold>
              {String(step.id).padStart(2, " ")}.{" "}
            </Text>
            <Text color="white">{step.title}</Text>
          </Text>
          {step.description && (
            <Text color="gray" dimColor>
              {"     "}
              {step.description}
            </Text>
          )}
        </Box>
      ))}
      <Text> </Text>
      <Text color="cyan" bold>
        Approve this plan?
      </Text>
      <Box>
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

export function ConfirmBar({
  toolCall,
  isRoot,
  needsRootEscalation,
  onConfirm,
}: ConfirmBarProps) {
  if (toolCall.name === "plan") {
    return <PlanConfirmBar toolCall={toolCall} onConfirm={onConfirm} />;
  }

  useInput((input, key) => {
    if (input === "y" || input === "Y" || key.return) {
      onConfirm(true);
    } else if (input === "n" || input === "N" || key.escape) {
      onConfirm(false);
    }
  });

  const borderColor = isRoot ? "red" : "yellow";
  const headerColor = isRoot ? "red" : "yellow";

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={borderColor}
      paddingX={1}
    >
      {needsRootEscalation && (
        <Text bold color="red">
          *** ROOT MODE WILL BE ENABLED ***
        </Text>
      )}
      {isRoot && !needsRootEscalation && (
        <Text bold color="red">
          *** ROOT PRIVILEGE ***
        </Text>
      )}
      <Text color={headerColor} bold>
        {needsRootEscalation
          ? "Enable root mode and execute?"
          : "Confirm tool execution:"}
      </Text>
      <Text color="white">{describeToolCall(toolCall)}</Text>
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
