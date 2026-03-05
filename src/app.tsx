import React, { useState, useCallback, useRef, useEffect } from "react";
import { Box, Static, useApp, useInput } from "ink";
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
import { setAskUserHandler } from "./tools/AskUserTool/index.js";
import { PlanProgress, type ActivePlan } from "./ui/PlanProgress.js";
import { SudoGuardBar } from "./ui/SudoGuardBar.js";
import type { SSHManager } from "./utils/ssh-manager.js";
import type { AuditLogger } from "./utils/audit.js";
import { sd } from "./utils/stream-debug.js";

interface AppProps {
  agent: Agent;
  toolRegistry: ToolRegistry;
  provider: string;
  model: string;
  sshManager: SSHManager;
  audit: AuditLogger;
  initialShowFlow?: boolean;
  planModeRef: { current: boolean };
}

export function App({ agent, toolRegistry, provider, model, sshManager, audit, initialShowFlow = false, planModeRef }: AppProps) {
  const { exit } = useApp();
  const [showFlow, setShowFlow] = useState(initialShowFlow);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sshHost, setSshHost] = useState<string | undefined>();
  const [rootMode, setRootMode] = useState(false);
  const [planMode, setPlanModeState] = useState(false);
  const [tokens, setTokens] = useState(0);
  const [activePlan, setActivePlan] = useState<ActivePlan | null>(null);
  const streamingRef = useRef("");
  const streamingFlushRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reasoningRef = useRef("");
  const rootModeRef = useRef(false);
  const loadingStartRef = useRef<number>(0);

  const [pendingConfirm, setPendingConfirm] = useState<{
    toolCall: ToolCall;
    needsRootEscalation: boolean;
    resolve: (result: boolean | string) => void;
  } | null>(null);

  // ─── Sudo Guard: second-layer protection at SSH level ─────────
  const [pendingSudo, setPendingSudo] = useState<{
    connectionId: string;
    command: string;
    resolve: (approved: boolean) => void;
  } | null>(null);

  const [pendingAskUser, setPendingAskUser] = useState<{
    question: string;
    resolve: (answer: string) => void;
  } | null>(null);

  useEffect(() => {
    setAskUserHandler(async (question: string) => {
      return new Promise<string>((resolve) => {
        setPendingAskUser({ question, resolve });
      });
    });
    return () => setAskUserHandler(async () => "");
  }, []);

  useEffect(() => {
    sshManager.setSudoGuard(async (connectionId, command) => {
      return new Promise<boolean>((resolve) => {
        setPendingSudo({ connectionId, command, resolve });
      });
    });
    return () => sshManager.setSudoGuard(undefined);
  }, [sshManager]);

  // Ctrl+O: toggle flow visibility
  useInput((input, key) => {
    if (key.ctrl && input === "o") {
      setShowFlow((prev) => !prev);
    }
  });

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
          planModeRef,
          setPlanMode: (enabled: boolean) => {
            setPlanModeState(enabled);
            planModeRef.current = enabled;
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
      reasoningRef.current = "";
      loadingStartRef.current = Date.now();
      setTokens(0);

      const commitPendingReasoning = () => {
        const text = reasoningRef.current.trim();
        if (!text) return;
        setMessages((prev) => [
          ...prev,
          { role: "tool" as const, content: text, toolName: "model_think", summary: "Thinking..." },
        ]);
        reasoningRef.current = "";
      };

      await agent.run(input, {
        onReasoningDelta: (text: string) => {
          reasoningRef.current += text;
        },
        onTextDelta: (text: string) => {
          commitPendingReasoning();
          streamingRef.current += text;
          if (!streamingFlushRef.current) {
            streamingFlushRef.current = setTimeout(() => {
              setStreamingText(streamingRef.current);
              streamingFlushRef.current = null;
            }, 350);
          }
        },
        onThinkingBoundary: () => {
          // All text_delta accumulated so far was actually thinking content.
          // Move it retroactively from streaming text to reasoning.
          const thinkingText = streamingRef.current;
          sd("APP thinking_boundary", { streamingLen: thinkingText.length, movedToReasoning: thinkingText.slice(0, 200) });
          streamingRef.current = "";
          if (thinkingText.trim()) {
            reasoningRef.current += thinkingText;
            commitPendingReasoning();
          }
          setStreamingText("");
        },
        onIterationEnd: () => {
          // Flush streaming state between agent loop iterations so the next
          // iteration starts clean (prevents thinking_boundary from sweeping
          // up legitimate response text from prior iterations).
          commitPendingReasoning();
          if (streamingFlushRef.current) {
            clearTimeout(streamingFlushRef.current);
            streamingFlushRef.current = null;
          }
          const captured = streamingRef.current.trim();
          sd("APP onIterationEnd", { capturedLen: captured.length });
          if (captured) {
            setMessages((prev) => [
              ...prev,
              { role: "assistant" as const, content: captured },
            ]);
          }
          streamingRef.current = "";
          setStreamingText("");
        },
        onToolCallStart: (toolCall: ToolCall) => {
          commitPendingReasoning();
          if (streamingFlushRef.current) {
            clearTimeout(streamingFlushRef.current);
            streamingFlushRef.current = null;
          }
          const captured = streamingRef.current.trim();
          if (captured) {
            setMessages((prev) => [
              ...prev,
              { role: "assistant" as const, content: captured },
            ]);
          }
          streamingRef.current = "";
          setStreamingText("");


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

          if (toolCall.name === "ask_user") {
            setMessages((prev) => [
              ...prev,
              {
                role: "tool" as const,
                content: String(toolCall.arguments.question || ""),
                toolName: "ask_user",
              },
            ]);
            return;
          }

          if (toolCall.name === "activate_skill") {
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
              summary: generateToolSummary(toolCall.name, toolCall.arguments),
            },
          ]);
        },
        onConfirmToolCall: (toolCall: ToolCall) => {
          return new Promise<boolean | string>((resolve) => {
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

          const resultSummary = generateResultSummary(toolCall.name, toolCall.arguments, result, isError);
          setMessages((prev) => [
            ...prev,
            {
              role: "tool" as const,
              content: result,
              toolName: toolCall.name,
              isError,
              summary: resultSummary,
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
          commitPendingReasoning();
          if (streamingFlushRef.current) {
            clearTimeout(streamingFlushRef.current);
            streamingFlushRef.current = null;
          }
          const captured = streamingRef.current.trim();
          sd("APP onDone", { capturedLen: captured.length, captured: captured.slice(0, 200) });
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
          reasoningRef.current = "";
          if (streamingFlushRef.current) {
            clearTimeout(streamingFlushRef.current);
            streamingFlushRef.current = null;
          }
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
    (result: boolean | string) => {
      if (!pendingConfirm) return;

      const approved = result === true;
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

      pendingConfirm.resolve(result);
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

  const handleAskUserAnswer = useCallback(
    (answer: string) => {
      if (!pendingAskUser) return;
      setMessages((prev) => [
        ...prev,
        { role: "user" as const, content: answer },
      ]);
      pendingAskUser.resolve(answer);
      setPendingAskUser(null);
    },
    [pendingAskUser],
  );

  const showConfirm = !!pendingConfirm;
  const showSudoGuard = !!pendingSudo;
  const showAskUser = !!pendingAskUser;

  return (
    <Box flexDirection="column" height="100%">
      <Static items={["header"] as const}>
        {() => <Header key="header" provider={provider} model={model} />}
      </Static>
      <StatusBar
        provider={provider}
        model={model}
        isLoading={isLoading}
        sshConnected={sshHost}
        rootMode={rootMode}
        planMode={planMode}
        startTime={loadingStartRef.current}
        tokens={tokens}
        showFlow={showFlow}
      />
      <Box flexDirection="column" flexGrow={1}>
        <ChatView
          messages={messages.filter((m) => m.role !== "system" || m.content)}
          streamingText={streamingText}
          isLoading={isLoading && !pendingConfirm && !pendingSudo}
          startTime={loadingStartRef.current}
          tokens={tokens}
          showFlow={showFlow}
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
          onConfirm={handleConfirm as (result: boolean | string) => void}
        />
      )}
      {showAskUser && !showConfirm && !showSudoGuard && (
        <InputBar onSubmit={handleAskUserAnswer} isDisabled={false} />
      )}
      {!showAskUser && !showConfirm && !showSudoGuard && (
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

// ─── Tool Summary Generation ─────────────────────────────────────────────

function resolveTarget(args: Record<string, unknown>): string {
  if (typeof args.host === "string") return args.host;
  if (Array.isArray(args.hosts) && args.hosts.length > 0)
    return (args.hosts as string[]).join(", ");
  if (Array.isArray(args.tags) && args.tags.length > 0)
    return `tags:${(args.tags as string[]).join(",")}`;
  return "";
}

function generateToolSummary(toolName: string, args: Record<string, unknown>): string {
  const target = resolveTarget(args);
  const on = target ? ` on ${target}` : "";

  switch (toolName) {
    case "execute_command":
      return `${String(args.command || "").slice(0, 80)}${on}`;
    case "service_control":
      return `Service ${args.action}: ${args.service}${on}`;
    case "read_config":
      return `Read config: ${args.config_path}${on}`;
    case "write_config":
      return `Write config: ${args.config_path}${on}`;
    case "run_healthcheck": {
      const checks = Array.isArray(args.checks) ? (args.checks as string[]).join(", ") : "";
      return `Health check${on}: ${checks}`;
    }
    case "inventory_lookup":
      return `Inventory lookup: ${args.query}`;
    case "inventory_add":
      return `Add host: ${args.name} (${args.ip})`;
    case "inventory_remove":
      return `Remove host: ${args.name}`;
    case "web_search":
      return `Web search: ${String(args.query || "").slice(0, 60)}`;
    case "web_fetch":
      return `Fetch: ${String(args.url || "").slice(0, 60)}`;
    case "save_memory":
      return `Save memory: ${String(args.fact || "").slice(0, 60)}`;
    case "grep_search":
      return `Search files: ${args.pattern}`;
    case "read_file":
      return `Read: ${args.path}`;
    case "read_many_files": {
      const count = Array.isArray(args.paths) ? args.paths.length : 0;
      return `Read ${count} files`;
    }
    default:
      return `${toolName}(${formatArgs(args).slice(0, 60)})`;
  }
}

function generateResultSummary(
  toolName: string,
  args: Record<string, unknown>,
  result: string,
  isError?: boolean,
): string {
  const icon = isError ? "✗" : "✓";
  const target = resolveTarget(args);
  const on = target ? ` on ${target}` : "";

  switch (toolName) {
    case "execute_command": {
      const cmd = String(args.command || "").slice(0, 60);
      const lines = result.split("\n").filter(Boolean).length;
      return `${icon} ${cmd}${on} (${lines} lines)`;
    }
    case "service_control":
      return `${icon} Service ${args.action}: ${args.service}${on}`;
    case "read_config":
      return `${icon} Read: ${args.config_path}${on}`;
    case "write_config":
      return `${icon} Written: ${args.config_path}${on}`;
    case "run_healthcheck":
      return `${icon} Health check${on}`;
    case "web_search":
      return `${icon} Results for: ${String(args.query || "").slice(0, 50)}`;
    case "web_fetch":
      return `${icon} Fetched: ${String(args.url || "").slice(0, 50)}`;
    case "save_memory":
      return `${icon} Memory saved`;
    case "grep_search":
      return `${icon} Search: ${args.pattern}`;
    case "read_file":
      return `${icon} Read: ${args.path}`;
    case "activate_skill": {
      const match = result.match(/name="([^"]+)"/);
      return `${icon} Skill: ${match ? match[1] : "loaded"}`;
    }
    default:
      return `${icon} ${toolName}${on}`;
  }
}
