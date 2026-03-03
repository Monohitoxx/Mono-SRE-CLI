import React, { useState, useCallback, useRef, useEffect } from "react";
import { Box, useApp } from "ink";
import { Header } from "./ui/Header.js";
import { StatusBar } from "./ui/StatusBar.js";
import { ChatView, type ChatMessage } from "./ui/ChatView.js";
import { InputBar } from "./ui/InputBar.js";
import { ConfirmBar } from "./ui/ConfirmBar.js";
import { Agent } from "./core/agent.js";
import { processCommand } from "./commands/index.js";
import type { ToolRegistry } from "./tools/registry.js";
import type { ToolCall, Message, TokenUsage } from "./core/types.js";
import { detectSudo } from "./tools/RemoteTools/index.js";
import { formatPlanForDisplay, type PlanStep } from "./tools/PlanTool/index.js";
import { PlanProgress, type ActivePlan } from "./ui/PlanProgress.js";
import { SudoGuardBar } from "./ui/SudoGuardBar.js";
import type { SSHManager } from "./utils/ssh-manager.js";
import type { AuditLogger } from "./utils/audit.js";

interface AppProps {
  agent: Agent;
  toolRegistry: ToolRegistry;
  provider: string;
  model: string;
  sshManager: SSHManager;
  audit: AuditLogger;
}

export function App({ agent, toolRegistry, provider, model, sshManager, audit }: AppProps) {
  const { exit } = useApp();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sshHost, setSshHost] = useState<string | undefined>();
  const [rootMode, setRootMode] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [tokens, setTokens] = useState(0);
  const [activePlan, setActivePlan] = useState<ActivePlan | null>(null);
  const streamingRef = useRef("");
  const rootModeRef = useRef(false);
  const loadingStartRef = useRef<number>(0);

  useEffect(() => {
    if (!isLoading) return;
    const timer = setInterval(() => {
      setElapsedMs(Date.now() - loadingStartRef.current);
    }, 500);
    return () => clearInterval(timer);
  }, [isLoading]);

  const [pendingConfirm, setPendingConfirm] = useState<{
    toolCall: ToolCall;
    needsRootEscalation: boolean;
    resolve: (approved: boolean) => void;
  } | null>(null);

  // ─── Sudo Guard: second-layer protection at SSH level ─────────
  const [pendingSudo, setPendingSudo] = useState<{
    connectionId: string;
    command: string;
    resolve: (approved: boolean) => void;
  } | null>(null);

  useEffect(() => {
    sshManager.setSudoGuard(async (connectionId, command) => {
      return new Promise<boolean>((resolve) => {
        setPendingSudo({ connectionId, command, resolve });
      });
    });
    return () => sshManager.setSudoGuard(undefined);
  }, [sshManager]);

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
      loadingStartRef.current = Date.now();
      setElapsedMs(0);
      setTokens(0);

      await agent.run(input, {
        onTextDelta: (text: string) => {
          streamingRef.current += text;
          setStreamingText(streamingRef.current);
        },
        onToolCallStart: (toolCall: ToolCall) => {
          const captured = streamingRef.current.trim();
          if (captured) {
            setMessages((prev) => [
              ...prev,
              { role: "assistant" as const, content: captured },
            ]);
          }
          streamingRef.current = "";
          setStreamingText("");

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

          // plan_progress: update plan UI silently, no chat message
          if (toolCall.name === "plan_progress") {
            const action = toolCall.arguments.action as string;
            const stepId = toolCall.arguments.step as number;
            setActivePlan((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                steps: prev.steps.map((s) => {
                  if (s.id === stepId) {
                    return { ...s, status: action === "done" ? "done" as const : "in_progress" as const };
                  }
                  return s;
                }),
              };
            });
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
        onUsage: (usage: TokenUsage) => {
          setTokens((prev) => prev + usage.inputTokens + usage.outputTokens);
        },
        onToolCallEnd: (
          toolCall: ToolCall,
          result: string,
          isError?: boolean,
        ) => {
          // Clear sudo bypass after each tool execution
          sshManager.clearSudoBypass();

          // plan_progress: already handled in onToolCallStart, skip chat message
          if (toolCall.name === "plan_progress") return;

          // plan approved: activate the progress tracker
          if (toolCall.name === "plan" && !isError) {
            const steps = Array.isArray(toolCall.arguments.steps)
              ? (toolCall.arguments.steps as Array<Record<string, unknown>>)
              : [];
            setActivePlan({
              title: String(toolCall.arguments.title || "Plan"),
              steps: steps.map((s, i) => ({
                id: typeof s.id === "number" ? s.id : i + 1,
                title: typeof s.title === "string" ? s.title : `Step ${i + 1}`,
                status: "pending" as const,
              })),
            });
            // don't add the "Plan approved" text to chat — the progress widget shows it
            return;
          }

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
          const captured = streamingRef.current.trim();
          if (captured) {
            setMessages((prev) => [
              ...prev,
              { role: "assistant" as const, content: captured },
            ]);
          }
          streamingRef.current = "";
          setStreamingText("");
          setIsLoading(false);
          // clear plan when all steps are done
          setActivePlan((prev) => {
            if (!prev) return null;
            const allDone = prev.steps.every((s) => s.status === "done");
            return allDone ? null : prev;
          });
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

      const isSudo = detectSudoInArgs(pendingConfirm.toolCall);
      const auditDetails = {
        tool: pendingConfirm.toolCall.name,
        args: pendingConfirm.toolCall.arguments,
        isSudo,
      };

      if (approved) {
        audit.log("tool_approved", auditDetails);

        if (pendingConfirm.needsRootEscalation) {
          enableRootMode();
          setMessages((prev) => [
            ...prev,
            {
              role: "system" as const,
              content: "Root mode auto-enabled for this operation.",
            },
          ]);
        }

        // If Layer 2 already confirmed sudo, bypass Layer 3 (sudo guard)
        if (isSudo) {
          sshManager.bypassSudoGuard();
        }
      } else {
        audit.log("tool_denied", auditDetails);
      }

      pendingConfirm.resolve(approved);
      setPendingConfirm(null);
    },
    [pendingConfirm, enableRootMode, sshManager, audit],
  );

  const handleSudoConfirm = useCallback(
    (approved: boolean) => {
      if (!pendingSudo) return;
      const auditDetails = {
        connectionId: pendingSudo.connectionId,
        command: pendingSudo.command,
      };
      audit.log(approved ? "sudo_approved" : "sudo_denied", auditDetails);
      pendingSudo.resolve(approved);
      setPendingSudo(null);
    },
    [pendingSudo, audit],
  );

  const showConfirm = !!pendingConfirm;
  const showSudoGuard = !!pendingSudo;

  return (
    <Box flexDirection="column" height="100%">
      <Header provider={provider} model={model} />
      <StatusBar
        provider={provider}
        model={model}
        isLoading={isLoading}
        sshConnected={sshHost}
        rootMode={rootMode}
        elapsedMs={elapsedMs}
        tokens={tokens}
      />
      <Box flexDirection="column" flexGrow={1}>
        <ChatView
          messages={messages.filter((m) => m.role !== "system" || m.content)}
          streamingText={streamingText}
          isLoading={isLoading && !pendingConfirm && !pendingSudo}
          elapsedMs={elapsedMs}
          tokens={tokens}
        />
      </Box>
      {activePlan && <PlanProgress plan={activePlan} />}
      {showSudoGuard && (
        <SudoGuardBar
          connectionId={pendingSudo!.connectionId}
          command={pendingSudo!.command}
          onConfirm={handleSudoConfirm}
        />
      )}
      {showConfirm && !showSudoGuard && (
        <ConfirmBar
          toolCall={pendingConfirm!.toolCall}
          isRoot={detectSudoInArgs(pendingConfirm!.toolCall)}
          needsRootEscalation={pendingConfirm!.needsRootEscalation}
          onConfirm={handleConfirm}
        />
      )}
      {!showConfirm && !showSudoGuard && (
        <InputBar onSubmit={handleSubmit} isDisabled={isLoading} />
      )}
    </Box>
  );
}

function detectSudoInArgs(toolCall: ToolCall): boolean {
  // Explicit sudo in command argument
  const command = toolCall.arguments?.command;
  if (typeof command === "string" && detectSudo(command)) return true;

  // Implicit sudo in high-level remote tools
  if (toolCall.name === "service_control") {
    return toolCall.arguments?.action !== "status";
  }
  if (toolCall.name === "write_config") {
    return true;
  }

  return false;
}

const SENSITIVE_KEY_RE =
  /(password|passwd|secret|token|api[_-]?key|private[_-]?key|authorization|cookie|credential)/i;

function formatArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args);
  if (entries.length === 0) return "";
  return entries
    .map(([k, v]) => {
      if (SENSITIVE_KEY_RE.test(k)) {
        const s = String(v);
        return `${k}: "${s === "use_login_password" ? s : "****"}"`;
      }
      const val = typeof v === "string" ? `"${v}"` : String(v);
      return `${k}: ${val}`;
    })
    .join(", ");
}
