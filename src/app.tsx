import React, { useState, useCallback, useRef } from "react";
import { Box, useApp } from "ink";
import { Header } from "./ui/Header.js";
import { StatusBar } from "./ui/StatusBar.js";
import { ChatView, type ChatMessage } from "./ui/ChatView.js";
import { InputBar } from "./ui/InputBar.js";
import { ConfirmBar } from "./ui/ConfirmBar.js";
import { Agent } from "./core/agent.js";
import { processCommand } from "./commands/index.js";
import type { ToolRegistry } from "./tools/registry.js";
import type { ToolCall, Message } from "./core/types.js";
import { detectSudo } from "./tools/SSHTool/exec.js";
import { formatPlanForDisplay } from "./tools/PlanTool/index.js";

interface AppProps {
  agent: Agent;
  toolRegistry: ToolRegistry;
  provider: string;
  model: string;
}

export function App({ agent, toolRegistry, provider, model }: AppProps) {
  const { exit } = useApp();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sshHost, setSshHost] = useState<string | undefined>();
  const [rootMode, setRootMode] = useState(false);
  const streamingRef = useRef("");
  const rootModeRef = useRef(false);

  const [pendingConfirm, setPendingConfirm] = useState<{
    toolCall: ToolCall;
    needsRootEscalation: boolean;
    resolve: (approved: boolean) => void;
  } | null>(null);

  const enableRootMode = useCallback(() => {
    setRootMode(true);
    rootModeRef.current = true;
    toolRegistry.setRootEnabled(true);
  }, [toolRegistry]);

  const handleSubmit = useCallback(
    async (input: string) => {
      if (input.startsWith("/")) {
        const result = processCommand(input, {
          toolRegistry,
          rootModeRef,
          setRootMode: (enabled: boolean) => {
            setRootMode(enabled);
            rootModeRef.current = enabled;
          },
        });

        if (!result) return;

        if (result.type === "action") {
          if (result.action === "exit") {
            exit();
          } else if (result.action === "clear") {
            setMessages([]);
            agent.clearHistory();
          }
          return;
        }

        if (result.type === "message") {
          setMessages((prev) => [
            ...prev,
            { role: "system" as const, content: result.content },
          ]);
          return;
        }
        return;
      }

      setMessages((prev) => [
        ...prev,
        { role: "user" as const, content: input },
      ]);
      setIsLoading(true);
      setStreamingText("");
      streamingRef.current = "";

      await agent.run(input, {
        onTextDelta: (text: string) => {
          streamingRef.current += text;
          setStreamingText(streamingRef.current);
        },
        onToolCallStart: (toolCall: ToolCall) => {
          if (streamingRef.current) {
            const captured = streamingRef.current;
            setMessages((prev) => [
              ...prev,
              { role: "assistant" as const, content: captured },
            ]);
            streamingRef.current = "";
            setStreamingText("");
          }

          if (toolCall.name === "think") {
            setMessages((prev) => [
              ...prev,
              {
                role: "tool" as const,
                content: String(toolCall.arguments.thought || ""),
                toolName: "think",
              },
            ]);
            return;
          }

          if (toolCall.name === "plan") {
            setMessages((prev) => [
              ...prev,
              {
                role: "tool" as const,
                content: formatPlanForDisplay(toolCall.arguments),
                toolName: "plan",
              },
            ]);
            return;
          }

          setMessages((prev) => [
            ...prev,
            {
              role: "tool" as const,
              content: `${toolCall.name}(${formatArgs(toolCall.arguments)})`,
              toolName: toolCall.name,
            },
          ]);
        },
        onConfirmToolCall: (toolCall: ToolCall) => {
          return new Promise<boolean>((resolve) => {
            const isSudo = detectSudoInArgs(toolCall);
            const needsRootEscalation = isSudo && !rootModeRef.current;
            setPendingConfirm({ toolCall, needsRootEscalation, resolve });
          });
        },
        onToolCallEnd: (
          toolCall: ToolCall,
          result: string,
          isError?: boolean,
        ) => {
          setMessages((prev) => [
            ...prev,
            {
              role: "tool" as const,
              content: result,
              toolName: toolCall.name,
              isError,
            },
          ]);

          if (toolCall.name === "ssh_connect" && !isError) {
            const host = toolCall.arguments.host as string;
            setSshHost(host);
          }
          if (toolCall.name === "ssh_disconnect") {
            setSshHost(undefined);
          }
        },
        onDone: (_message: Message) => {
          if (streamingRef.current) {
            const captured = streamingRef.current;
            setMessages((prev) => [
              ...prev,
              { role: "assistant" as const, content: captured },
            ]);
          }
          streamingRef.current = "";
          setStreamingText("");
          setIsLoading(false);
        },
        onError: (error: string) => {
          setMessages((prev) => [
            ...prev,
            {
              role: "tool" as const,
              content: error,
              isError: true,
              toolName: "error",
            },
          ]);
          streamingRef.current = "";
          setStreamingText("");
          setIsLoading(false);
        },
      });
    },
    [agent, exit, toolRegistry],
  );

  const handleConfirm = useCallback(
    (approved: boolean) => {
      if (!pendingConfirm) return;

      if (approved && pendingConfirm.needsRootEscalation) {
        enableRootMode();
        setMessages((prev) => [
          ...prev,
          {
            role: "system" as const,
            content: "Root mode auto-enabled for this operation.",
          },
        ]);
      }

      pendingConfirm.resolve(approved);
      setPendingConfirm(null);
    },
    [pendingConfirm, enableRootMode],
  );

  const showConfirm = !!pendingConfirm;

  return (
    <Box flexDirection="column" height="100%">
      <Header provider={provider} model={model} />
      <StatusBar
        provider={provider}
        model={model}
        isLoading={isLoading}
        sshConnected={sshHost}
        rootMode={rootMode}
      />
      <Box flexDirection="column" flexGrow={1}>
        <ChatView
          messages={messages.filter((m) => m.role !== "system" || m.content)}
          streamingText={streamingText}
          isLoading={isLoading && !pendingConfirm}
        />
      </Box>
      {showConfirm && (
        <ConfirmBar
          toolCall={pendingConfirm!.toolCall}
          isRoot={detectSudoInArgs(pendingConfirm!.toolCall)}
          needsRootEscalation={pendingConfirm!.needsRootEscalation}
          onConfirm={handleConfirm}
        />
      )}
      {!showConfirm && (
        <InputBar onSubmit={handleSubmit} isDisabled={isLoading} />
      )}
    </Box>
  );
}

function detectSudoInArgs(toolCall: ToolCall): boolean {
  const command = toolCall.arguments?.command;
  if (typeof command !== "string") return false;
  return detectSudo(command);
}

const SENSITIVE_KEYS = new Set(["password", "sudoPassword", "privateKey"]);

function formatArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args);
  if (entries.length === 0) return "";
  return entries
    .map(([k, v]) => {
      if (SENSITIVE_KEYS.has(k)) {
        const s = String(v);
        return `${k}: "${s === "use_login_password" ? s : "****"}"`;
      }
      const val = typeof v === "string" ? `"${v}"` : String(v);
      return `${k}: ${val}`;
    })
    .join(", ");
}
