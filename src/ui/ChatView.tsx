import React from "react";
import { Box, Text } from "ink";

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
}

function MessageBubble({ message }: { message: ChatMessage }) {
  switch (message.role) {
    case "user":
      return (
        <Box marginY={0} flexDirection="column">
          <Text bold color="green">
            {"❯ "}
            <Text>{message.content}</Text>
          </Text>
        </Box>
      );

    case "assistant":
      return (
        <Box marginY={0} flexDirection="column">
          <Text color="cyan">{message.content}</Text>
        </Box>
      );

    case "tool":
      if (message.toolName === "think") {
        return (
          <Box marginY={0} flexDirection="column" paddingX={1}>
            <Text color="magenta" dimColor italic>
              {"(thinking) "}
              {message.content.length > 300
                ? message.content.slice(0, 300) + "..."
                : message.content}
            </Text>
          </Box>
        );
      }

      if (message.toolName === "plan") {
        return (
          <Box
            marginY={0}
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
          marginY={0}
          flexDirection="column"
          borderStyle="round"
          borderColor={message.isError ? "red" : "gray"}
          paddingX={1}
        >
          <Text dimColor bold>
            [{message.toolName || "tool"}]
          </Text>
          <Text color={message.isError ? "red" : "white"} wrap="truncate-end">
            {message.content.length > 500
              ? message.content.slice(0, 500) + "..."
              : message.content}
          </Text>
        </Box>
      );

    default:
      return null;
  }
}

export function ChatView({ messages, streamingText, isLoading }: ChatViewProps) {
  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      {messages.map((msg, i) => (
        <MessageBubble key={i} message={msg} />
      ))}
      {streamingText && (
        <Box marginY={0}>
          <Text color="cyan">{streamingText}</Text>
        </Box>
      )}
      {isLoading && !streamingText && (
        <Box marginY={0}>
          <Text color="yellow">● thinking...</Text>
        </Box>
      )}
    </Box>
  );
}
