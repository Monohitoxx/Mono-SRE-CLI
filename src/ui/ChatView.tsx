import React from "react";
import { Box, Text, Static } from "ink";
import { Spinner } from "./Spinner.js";

export interface ChatMessage {
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  toolName?: string;
  isError?: boolean;
  isStreaming?: boolean;
}

interface ChatViewProps {
  messages: ChatMessage[];
  streamingText: string;
  isLoading: boolean;
  elapsedMs: number;
  tokens: number;
}

type AssistantBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "heading"; text: string; level: number }
  | { kind: "bullet"; text: string }
  | { kind: "numbered"; text: string; index: number }
  | { kind: "quote"; text: string }
  | { kind: "code"; lang: string; code: string };

function parseAssistantBlocks(content: string): AssistantBlock[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: AssistantBlock[] = [];
  let inCode = false;
  let codeLang = "";
  const codeLines: string[] = [];
  const paragraphLines: string[] = [];

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    const text = paragraphLines.join(" ").replace(/\s+/g, " ").trim();
    if (text) blocks.push({ kind: "paragraph", text });
    paragraphLines.length = 0;
  };

  const flushCode = () => {
    if (!inCode) return;
    blocks.push({
      kind: "code",
      lang: codeLang,
      code: codeLines.join("\n").trimEnd(),
    });
    inCode = false;
    codeLang = "";
    codeLines.length = 0;
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const fence = line.match(/^```([\w-]+)?\s*$/);
    if (fence) {
      flushParagraph();
      if (!inCode) {
        inCode = true;
        codeLang = fence[1] || "";
        continue;
      }
      flushCode();
      continue;
    }

    if (inCode) {
      codeLines.push(rawLine);
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      blocks.push({
        kind: "heading",
        level: heading[1].length,
        text: heading[2].trim(),
      });
      continue;
    }

    const bullet = trimmed.match(/^[-*+]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      blocks.push({ kind: "bullet", text: bullet[1].trim() });
      continue;
    }

    const numbered = trimmed.match(/^(\d+)[.)]\s+(.+)$/);
    if (numbered) {
      flushParagraph();
      blocks.push({
        kind: "numbered",
        index: Number(numbered[1]),
        text: numbered[2].trim(),
      });
      continue;
    }

    const quote = trimmed.match(/^>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      blocks.push({ kind: "quote", text: quote[1].trim() });
      continue;
    }

    paragraphLines.push(trimmed);
  }

  flushParagraph();
  flushCode();

  return blocks;
}

function AssistantFormatted({ content }: { content: string }) {
  const blocks = parseAssistantBlocks(content);
  if (blocks.length === 0) {
    return <Text color="cyan">{content}</Text>;
  }

  return (
    <Box flexDirection="column">
      {blocks.map((block, idx) => {
        switch (block.kind) {
          case "heading": {
            const marker = block.level <= 2 ? "▣" : "▪";
            return (
              <Box key={idx} marginTop={idx === 0 ? 0 : 1}>
                <Text bold color="yellow">
                  {marker} {block.text}
                </Text>
              </Box>
            );
          }

          case "bullet":
            return (
              <Text key={idx} color="cyan">
                {"  • "}{block.text}
              </Text>
            );

          case "numbered":
            return (
              <Text key={idx} color="cyan">
                {`  ${block.index}. ${block.text}`}
              </Text>
            );

          case "quote":
            return (
              <Text key={idx} color="gray" dimColor italic>
                {`  │ ${block.text}`}
              </Text>
            );

          case "code":
            return (
              <Box
                key={idx}
                flexDirection="column"
                marginTop={1}
                borderStyle="round"
                borderColor="blue"
                paddingX={1}
              >
                {block.lang ? (
                  <Text color="blue" dimColor>
                    {block.lang}
                  </Text>
                ) : null}
                <Text color="white">{block.code || "(empty code block)"}</Text>
              </Box>
            );

          case "paragraph":
            return (
              <Text key={idx} color="cyan">
                {block.text}
              </Text>
            );
        }
      })}
    </Box>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  switch (message.role) {
    case "user":
      return (
        <Box marginTop={1} flexDirection="column">
          <Box borderStyle="round" borderColor="green" paddingX={1}>
            <Text bold color="green">
              {"YOU "}
              <Text color="white">{message.content}</Text>
            </Text>
          </Box>
        </Box>
      );

    case "assistant":
      return (
        <Box
          marginTop={1}
          flexDirection="column"
          borderStyle="round"
          borderColor="cyan"
          paddingX={1}
        >
          <Text bold color="cyan">
            AI RESPONSE
          </Text>
          <AssistantFormatted content={message.content} />
        </Box>
      );

    case "tool":
      if (message.toolName === "think") {
        return (
          <Box marginTop={1} flexDirection="column" paddingX={1}>
            <Text bold color="magenta">
              {">> "}
            </Text>
            <Text color="magenta">
              {message.content.length > 600
                ? message.content.slice(0, 600) + "..."
                : message.content}
            </Text>
          </Box>
        );
      }

      if (message.toolName === "plan") {
        return (
          <Box
            marginTop={1}
            flexDirection="column"
            borderStyle="round"
            borderColor="cyan"
            paddingX={1}
          >
            <Text color="cyan" bold>
              {">>> "}Execution Plan
            </Text>
            <Text color="white">{message.content}</Text>
          </Box>
        );
      }

      return (
        <Box
          marginTop={1}
          flexDirection="column"
          borderStyle="round"
          borderColor={message.isError ? "red" : "gray"}
          paddingX={1}
        >
          <Text dimColor bold>
            [{message.toolName || "tool"}]
          </Text>
          <Text color={message.isError ? "red" : "white"} wrap="wrap">
            {message.content.length > 1200
              ? message.content.slice(0, 1200) + "\n... (truncated)"
              : message.content}
          </Text>
        </Box>
      );

    case "system":
      return (
        <Box marginTop={1} flexDirection="column" paddingX={1}>
          <Text color="gray">{message.content}</Text>
        </Box>
      );

    default:
      return null;
  }
}

// Keep the last N messages in the dynamic area so the user can always see
// recent activity (AI responses, thinking, tool results).  Older messages
// are frozen into <Static> to prevent the flickering that comes from
// re-rendering the entire chat on every timer tick.
const KEEP_VISIBLE = 8;

export function ChatView({ messages, streamingText, isLoading, elapsedMs, tokens }: ChatViewProps) {
  const splitIdx = Math.max(0, messages.length - KEEP_VISIBLE);
  const frozenMessages = messages.slice(0, splitIdx);
  const recentMessages = messages.slice(splitIdx);

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      {frozenMessages.length > 0 && (
        <Static items={frozenMessages}>
          {(msg, i) => <MessageBubble key={i} message={msg} />}
        </Static>
      )}
      {recentMessages.map((msg, i) => (
        <MessageBubble key={`r-${splitIdx + i}`} message={msg} />
      ))}
      {streamingText && (
        <Box
          marginTop={1}
          flexDirection="column"
          borderStyle="round"
          borderColor="cyan"
          paddingX={1}
        >
          <Text bold color="cyan">
            AI TYPING
          </Text>
          <AssistantFormatted content={streamingText} />
        </Box>
      )}
      {isLoading && !streamingText && (
        <Box marginTop={1}>
          <Spinner label="thinking" elapsedMs={elapsedMs} tokens={tokens} />
        </Box>
      )}
    </Box>
  );
}
