import type { AIProvider } from "../providers/base.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { ToolCall, Message, TokenUsage } from "./types.js";
import { Conversation } from "./conversation.js";
import { classifyToolCallRisk } from "./risk-classifier.js";
import { detectSudo } from "../tools/RemoteTools/executor.js";
import type { AuditLogger } from "../utils/audit.js";
import { PolicyBlockCircuit } from "./policy-block-circuit.js";
import {
  extractBinary,
  isManagedSystemctlMutatingCommand,
  isPermissionErrorText,
  stripLeadingSudo,
} from "./command-policy-utils.js";

export interface AgentCallbacks {
  onTextDelta: (text: string) => void;
  onToolCallStart: (toolCall: ToolCall) => void;
  onToolCallEnd: (toolCall: ToolCall, result: string, isError?: boolean) => void;
  onConfirmToolCall: (toolCall: ToolCall) => Promise<boolean>;
  onUsage: (usage: TokenUsage) => void;
  onDone: (message: Message) => void;
  onError: (error: string) => void;
}

export class Agent {
  private provider: AIProvider;
  private toolRegistry: ToolRegistry;
  private conversation: Conversation;
  private isRunning = false;
  private planApprovedForTurn = false;
  private planNudged = false;
  private audit?: AuditLogger;
  // Track binaries that failed with permission errors — persists across turns for the whole session
  private sudoAllowedBinaries = new Set<string>();
  private policyBlockCircuit = new PolicyBlockCircuit();

  constructor(
    provider: AIProvider,
    toolRegistry: ToolRegistry,
    systemPrompt: string | (() => string),
  ) {
    this.provider = provider;
    this.toolRegistry = toolRegistry;
    this.conversation = new Conversation(systemPrompt);
  }

  setAuditLogger(audit: AuditLogger) {
    this.audit = audit;
  }

  get running(): boolean {
    return this.isRunning;
  }

  async run(userMessage: string, callbacks: AgentCallbacks): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    this.planApprovedForTurn = false;
    this.planNudged = false;
    this.policyBlockCircuit.resetTurnGuards();

    try {
      this.conversation.addUser(userMessage);
      await this.agentLoop(callbacks);
    } catch (err) {
      callbacks.onError((err as Error).message);
    } finally {
      this.isRunning = false;
    }
  }

  private async agentLoop(callbacks: AgentCallbacks): Promise<void> {
    const BASE_ITERATIONS = 20;
    const PLAN_ITERATIONS = 60;
    // Track whether think was called in the current iteration (for plan execution)
    let thoughtThisIteration = false;

    for (let i = 0; i < (this.planApprovedForTurn ? PLAN_ITERATIONS : BASE_ITERATIONS); i++) {
      const messages = this.conversation.getMessages();
      const tools = this.toolRegistry.getDefinitions();

      let assistantText = "";
      const pendingToolCalls: ToolCall[] = [];

      const stream = this.provider.chat(messages, tools);

      for await (const event of stream) {
        switch (event.type) {
          case "text_delta":
            assistantText += event.text;
            callbacks.onTextDelta(event.text);
            break;
          case "tool_call_end":
            pendingToolCalls.push(event.toolCall);
            break;
          case "usage":
            callbacks.onUsage(event.usage);
            break;
          case "done":
            this.conversation.addAssistant(event.message);
            break;
          case "error":
            callbacks.onError(event.error);
            return;
        }
      }

      if (pendingToolCalls.length === 0) {
        // If a plan is active and AI sent text-only, nudge once to continue.
        // After nudging, clear the flag so we don't loop forever when the plan is done.
        if (this.planApprovedForTurn && !this.planNudged) {
          this.planNudged = true;
          this.conversation.addUser(
            "Continue executing the remaining plan steps. Use the think tool first to reason about the next step, then call the appropriate tool. Do not use sudo unless a previous attempt failed with a permission error.",
          );
          continue;
        }
        callbacks.onDone({
          role: "assistant",
          content: assistantText,
        });
        return;
      }

      // AI made tool calls — reset nudge flag so it can nudge again if it stalls later
      this.planNudged = false;

      const THINK_EXEMPT = new Set(["think", "plan_progress"]);

      for (const toolCall of pendingToolCalls) {
        // ─── Audit: log every tool call attempt ─────────────────────
        this.audit?.log("tool_call", { tool: toolCall.name, args: toolCall.arguments });

        // Track think calls
        if (toolCall.name === "think") {
          thoughtThisIteration = true;
        }

        // ─── GATE 0: Think-before-act ────────────────────────────────
        // Always require think before creating a plan (so LLM reasons about gathered info).
        // During plan execution, require think before every action tool.
        const needsThinkFirst =
          toolCall.name === "plan" ||
          (this.planApprovedForTurn && !THINK_EXEMPT.has(toolCall.name));

        if (needsThinkFirst && !thoughtThisIteration) {
          const policyMsg = toolCall.name === "plan"
            ? "POLICY: Use the think tool to reason about the information you have gathered " +
              "before creating a plan. Call think first, then create the plan."
            : "POLICY: During plan execution, you must use the think tool before each action step " +
              "to explain your reasoning. Call think first, then proceed with this tool.";
          const shouldStop = this.handlePolicyBlock(
            toolCall,
            callbacks,
            "plan-think-required",
            policyMsg,
            "Call think first, then retry.",
          );
          if (shouldStop) return;
          continue;
        }

        // ─── GATE 1: Argument validation (before any UI) ────────────
        const validationError = this.toolRegistry.validateToolCall(toolCall);
        if (validationError) {
          const shouldStop = this.handlePolicyBlock(
            toolCall,
            callbacks,
            "tool-arg-validation",
            validationError.content,
            "Fix the tool arguments to match schema before retrying.",
          );
          if (shouldStop) return;
          continue;
        }

        // ─── GATE 2: Risk classification — plan required? ───────────
        const risk = classifyToolCallRisk(
          toolCall.name,
          toolCall.arguments,
        );

        if (risk.level === "plan-required" && !this.planApprovedForTurn) {
          const policyMsg = [
            `POLICY BLOCK: This operation requires an approved execution plan before it can proceed.`,
            `Reason: ${risk.reason}`,
            `Matched: ${risk.matchedPatterns.join(", ")}`,
            ``,
            `You MUST call the 'plan' tool first to create a structured plan.`,
            `The user will review and approve the plan, then you can execute the steps.`,
          ].join("\n");

          const shouldStop = this.handlePolicyBlock(
            toolCall,
            callbacks,
            "plan-required",
            policyMsg,
            "Call plan with structured steps, wait for approval, then execute.",
          );
          if (shouldStop) return;
          continue;
        }

        // ─── GATE 3: Sudo-first rejection ───────────────────────────
        if (toolCall.name === "execute_command") {
          const cmd = typeof toolCall.arguments.command === "string" ? toolCall.arguments.command.trim() : "";
          const normalized = stripLeadingSudo(cmd);
          const binary = extractBinary(normalized);

          if (isManagedSystemctlMutatingCommand(normalized)) {
            const policyMsg =
              "POLICY: For mutating systemd service actions, use service_control tool instead of execute_command. " +
              "Call service_control with { service, action, host/hosts/tags }.";
            const shouldStop = this.handlePolicyBlock(
              toolCall,
              callbacks,
              "managed-systemctl",
              policyMsg,
              "Use service_control (not execute_command) for this service action.",
            );
            if (shouldStop) return;
            continue;
          }

          if (detectSudo(cmd)) {
            if (!this.sudoAllowedBinaries.has(binary)) {
              const policyMsg =
                "POLICY: Try this command WITHOUT sudo first. Remove the sudo prefix and retry. " +
                "Only use sudo if the non-sudo attempt fails with a permission error.";
              const shouldStop = this.handlePolicyBlock(
                toolCall,
                callbacks,
                "sudo-first",
                policyMsg,
                "Retry the same command without sudo first.",
              );
              if (shouldStop) return;
              continue;
            }
          } else if (this.sudoAllowedBinaries.has(binary)) {
            // Auto-upgrade repeated non-sudo attempts to sudo to avoid LLM retry loops.
            toolCall.arguments.command = `sudo ${normalized}`;
            this.audit?.log("auto_sudo_upgrade", {
              tool: toolCall.name,
              binary,
              originalCommand: cmd,
              upgradedCommand: toolCall.arguments.command,
            });
          }
        }

        // ─── GATE 4: User confirmation ──────────────────────────────
        const needsConfirm = this.toolRegistry.needsConfirmation(toolCall.name);

        callbacks.onToolCallStart(toolCall);

        if (needsConfirm) {
          const approved = await callbacks.onConfirmToolCall(toolCall);
          if (!approved) {
            const deniedMsg = `User denied execution of ${toolCall.name}`;
            this.conversation.addToolResult(toolCall.id, deniedMsg, true);
            callbacks.onToolCallEnd(toolCall, deniedMsg, true);
            this.policyBlockCircuit.resetPolicyBlockStreak();

            if (toolCall.name === "plan") {
              this.planApprovedForTurn = false;
            }
            continue;
          }
        }

        // ─── Execute ────────────────────────────────────────────────
        const result = await this.toolRegistry.execute(toolCall);
        this.policyBlockCircuit.resetPolicyBlockStreak();

        // Reset think flag after a non-exempt action tool executes,
        // so the LLM must think again before the next action step.
        if (!THINK_EXEMPT.has(toolCall.name)) {
          thoughtThisIteration = false;
        }
        this.conversation.addToolResult(
          toolCall.id,
          result.content,
          result.isError,
        );
        callbacks.onToolCallEnd(toolCall, result.content, result.isError);

        // ─── Track permission failures for sudo escalation ───────────
        if (
          toolCall.name === "execute_command" &&
          typeof toolCall.arguments.command === "string"
        ) {
          if (isPermissionErrorText(result.content)) {
            const binary = extractBinary(
              stripLeadingSudo(toolCall.arguments.command.trim()),
            );
            this.sudoAllowedBinaries.add(binary);
          }
        }

        // ─── Audit: log tool result ──────────────────────────────────
        this.audit?.log("tool_result", {
          tool: toolCall.name,
          isError: result.isError ?? false,
          output: result.content.length > 500 ? result.content.slice(0, 500) + "…" : result.content,
        });

        // ─── Track plan approval ─────────────────────────────────────
        if (toolCall.name === "plan" && !result.isError) {
          this.planApprovedForTurn = true;
          this.audit?.log("plan_approved", {
            title: String(toolCall.arguments.title || ""),
            stepCount: Array.isArray(toolCall.arguments.steps) ? toolCall.arguments.steps.length : 0,
          });
        }
      }
    }

    callbacks.onError("Maximum agent iterations reached.");
  }

  clearHistory() {
    this.conversation.clear();
    this.sudoAllowedBinaries.clear();
    this.policyBlockCircuit.resetTurnGuards();
  }

  private handlePolicyBlock(
    toolCall: ToolCall,
    callbacks: AgentCallbacks,
    code: string,
    baseMessage: string,
    nextAction: string,
  ): boolean {
    return this.policyBlockCircuit.handle({
      toolCall,
      code,
      baseMessage,
      nextAction,
      addToolResult: (toolCallId, content, isError) =>
        this.conversation.addToolResult(toolCallId, content, isError),
      addAssistant: (message) => this.conversation.addAssistant(message),
      onToolCallStart: callbacks.onToolCallStart,
      onToolCallEnd: callbacks.onToolCallEnd,
      onDone: callbacks.onDone,
      audit: this.audit,
    });
  }
}
