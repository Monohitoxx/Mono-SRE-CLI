import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { ToolCall } from "../core/types.js";
import { detectSudo } from "../tools/RemoteTools/index.js";

export interface ConfirmBarProps {
  toolCall: ToolCall;
  isRoot?: boolean;
  needsRootEscalation?: boolean;
  onConfirm: (result: boolean | string) => void;
}

// ─── Shared hook: option navigation + inline text input ──────────────────

function useConfirmSelect(onConfirm: (result: boolean | string) => void) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [feedbackMode, setFeedbackMode] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackCursor, setFeedbackCursor] = useState(0);

  const handleSelect = (idx: number) => {
    if (idx === 0) {
      onConfirm(true);
    } else if (idx === 1) {
      onConfirm(false);
    } else {
      setSelectedIdx(2);
      setFeedbackMode(true);
    }
  };

  useInput((input, key) => {
    if (feedbackMode) {
      if (key.return) {
        const text = feedbackText.trim();
        onConfirm(text || false);
      } else if (key.escape) {
        setFeedbackMode(false);
        setFeedbackText("");
        setFeedbackCursor(0);
        setSelectedIdx(2);
      } else if (key.backspace || key.delete) {
        if (feedbackCursor > 0) {
          setFeedbackText((t) => t.slice(0, feedbackCursor - 1) + t.slice(feedbackCursor));
          setFeedbackCursor((c) => c - 1);
        }
      } else if (key.leftArrow) {
        setFeedbackCursor((c) => Math.max(0, c - 1));
      } else if (key.rightArrow) {
        setFeedbackCursor((c) => Math.min(feedbackText.length, c + 1));
      } else if (input && !key.ctrl && !key.meta) {
        setFeedbackText((t) => t.slice(0, feedbackCursor) + input + t.slice(feedbackCursor));
        setFeedbackCursor((c) => c + input.length);
      }
      return;
    }

    if (key.upArrow) {
      setSelectedIdx((prev) => Math.max(0, prev - 1));
    } else if (key.downArrow) {
      setSelectedIdx((prev) => Math.min(2, prev + 1));
    } else if (key.return) {
      handleSelect(selectedIdx);
    } else if (input === "1") {
      handleSelect(0);
    } else if (input === "2") {
      handleSelect(1);
    } else if (input === "3") {
      handleSelect(2);
    }
  });

  return { selectedIdx, feedbackMode, feedbackText, feedbackCursor };
}

// ─── Shared sub-components ────────────────────────────────────────────────

const OPTION_LABELS = ["Yes", "No", "Add feedback for AI..."] as const;
const OPTION_COLORS = ["green", "red", "yellow"] as const;

function OptionList({
  selectedIdx,
  feedbackMode,
  feedbackText,
  feedbackCursor,
}: {
  selectedIdx: number;
  feedbackMode: boolean;
  feedbackText: string;
  feedbackCursor: number;
}) {
  return (
    <Box flexDirection="column" marginTop={1}>
      {OPTION_LABELS.map((label, i) => {
        const isSelected = i === selectedIdx;
        const color = OPTION_COLORS[i];
        const cursor = isSelected && !feedbackMode ? "❯" : " ";
        return (
          <Box key={i} flexDirection="column">
            <Text color={isSelected && !feedbackMode ? color : "gray"}>
              {cursor} {i + 1}. {label}
            </Text>
            {i === 2 && feedbackMode && (
              <Box marginLeft={3}>
                <FeedbackInput text={feedbackText} cursor={feedbackCursor} />
              </Box>
            )}
          </Box>
        );
      })}
      <Box marginTop={1}>
        {feedbackMode ? (
          <Text dimColor>Enter to send  ·  Esc to cancel</Text>
        ) : (
          <Text dimColor>↑↓ navigate  ·  Enter select  ·  1 / 2 / 3 shortcut</Text>
        )}
      </Box>
    </Box>
  );
}

function FeedbackInput({ text, cursor }: { text: string; cursor: number }) {
  const before = text.slice(0, cursor);
  const at = text[cursor] ?? " ";
  const after = text.slice(cursor + 1);
  return (
    <Box>
      <Text color="yellow">{">"} </Text>
      <Text color="white">{before}</Text>
      <Text backgroundColor="white" color="black">
        {at}
      </Text>
      <Text color="white">{after}</Text>
    </Box>
  );
}

// ─── Formatters ───────────────────────────────────────────────────────────

function formatTarget(args: Record<string, unknown>): string {
  if (args.tags && Array.isArray(args.tags)) {
    return `[tags: ${(args.tags as string[]).join(", ")}]`;
  }
  if (args.hosts && Array.isArray(args.hosts)) {
    return (args.hosts as string[]).join(", ");
  }
  return (args.host as string) || "?";
}

function describeToolCall(toolCall: ToolCall): string {
  const { name, arguments: args } = toolCall;
  const command = args.command as string | undefined;
  const hasSudo = command ? detectSudo(command) : false;

  switch (name) {
    case "shell":
      return hasSudo
        ? `Run locally as ROOT: ${command}`
        : `Run locally: ${command}`;

    case "execute_command": {
      const target = formatTarget(args);
      const fullCmd = args.args ? `${command} ${args.args}` : command;
      return hasSudo
        ? `Run on ${target} as ROOT: ${fullCmd}`
        : `Run on ${target}: ${fullCmd}`;
    }

    case "service_control": {
      const target = formatTarget(args);
      const action = args.action as string;
      const service = args.service as string;
      const isWrite = action !== "status";
      const prefix = isWrite ? "[SUDO] " : "";
      return `${prefix}systemctl ${action} ${service} on ${target}`;
    }

    case "write_config": {
      const target = formatTarget(args);
      const configPath = args.config_path as string;
      const contentLen = typeof args.content === "string" ? args.content.length : 0;
      const backup = args.backup !== false ? " (backup: yes)" : "";
      return `[SUDO] Write ${contentLen} bytes to ${configPath} on ${target}${backup}`;
    }

    case "web_fetch":
      return `Fetch URL: ${args.url || "(unknown)"}`;

    case "save_memory":
      return `Save to memory: "${args.fact || "(empty)"}"`;

    case "inventory_add":
      return `Add host "${args.name}" (${args.username}@${args.ip}:${args.port || 22}) to inventory`;

    case "inventory_remove":
      return `Remove host "${args.name}" from inventory`;

    default:
      return `${name}(${JSON.stringify(args)})`;
  }
}

// ─── Plan confirm ─────────────────────────────────────────────────────────

function PlanConfirmBar({
  toolCall,
  onConfirm,
}: {
  toolCall: ToolCall;
  onConfirm: (result: boolean | string) => void;
}) {
  const { selectedIdx, feedbackMode, feedbackText, feedbackCursor } =
    useConfirmSelect(onConfirm);

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
      <OptionList
        selectedIdx={selectedIdx}
        feedbackMode={feedbackMode}
        feedbackText={feedbackText}
        feedbackCursor={feedbackCursor}
      />
    </Box>
  );
}

// ─── Tool confirm ─────────────────────────────────────────────────────────

function ToolConfirmBar({
  toolCall,
  isRoot,
  needsRootEscalation,
  onConfirm,
}: ConfirmBarProps) {
  const { selectedIdx, feedbackMode, feedbackText, feedbackCursor } =
    useConfirmSelect(onConfirm);

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
      <OptionList
        selectedIdx={selectedIdx}
        feedbackMode={feedbackMode}
        feedbackText={feedbackText}
        feedbackCursor={feedbackCursor}
      />
    </Box>
  );
}

// ─── Entry point ──────────────────────────────────────────────────────────

export function ConfirmBar(props: ConfirmBarProps) {
  if (props.toolCall.name === "plan") {
    return <PlanConfirmBar toolCall={props.toolCall} onConfirm={props.onConfirm} />;
  }
  return <ToolConfirmBar {...props} />;
}
