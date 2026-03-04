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
  onReasoningDelta?: (text: string) => void;
  onToolCallStart: (toolCall: ToolCall) => void;
  onToolCallEnd: (toolCall: ToolCall, result: string, isError?: boolean) => void;
  onConfirmToolCall: (toolCall: ToolCall) => Promise<boolean | string>;
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
  private planNudgeCount = 0;
  private wrapUpSent = false;
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
    this.planNudgeCount = 0;
    this.wrapUpSent = false;
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
          case "reasoning_delta":
            callbacks.onReasoningDelta?.(event.text);
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
        // If a plan is active and AI sent text-only, nudge up to 3 times.
        // Qwen models sometimes output a text summary instead of tool calls on the last step.
        const MAX_NUDGES = 3;
        if (this.planApprovedForTurn && this.planNudgeCount < MAX_NUDGES) {
          this.planNudgeCount++;
          this.conversation.addUser(
            "You must continue executing the plan using tools — do NOT just describe what you did. " +
            "Call the appropriate tool (run_healthcheck, execute_command, service_control, etc.) to complete the current in-progress step. " +
            "Do not stop until all steps are marked done with plan_progress.",
          );
          continue;
        }

        // Nudge limit reached — give the model one chance to explain and ask the user
        if (!this.wrapUpSent) {
          this.wrapUpSent = true;
          this.conversation.addUser(
            "You have been unable to proceed with tool calls. " +
            "Please tell the user: (1) what was completed so far, (2) what you were trying to do next, " +
            "(3) why you cannot proceed (e.g. blocked by policy, requires a plan, permission issue), " +
            "and (4) ask the user whether they would like you to handle it (e.g. create a plan) or leave it for now.",
          );
          continue;
        }

        callbacks.onDone({
          role: "assistant",
          content: assistantText,
        });
        return;
      }

      // AI made tool calls — reset nudge/wrapup state so it can nudge again if it stalls later
      this.planNudgeCount = 0;
      this.wrapUpSent = false;

      for (const toolCall of pendingToolCalls) {
        // ─── Audit: log every tool call attempt ─────────────────────
        this.audit?.log("tool_call", { tool: toolCall.name, args: toolCall.arguments });

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
          const confirmed = await callbacks.onConfirmToolCall(toolCall);
          if (confirmed !== true) {
            const userFeedback = typeof confirmed === "string" && confirmed.trim()
              ? confirmed.trim()
              : null;
            const deniedMsg = userFeedback
              ? `User denied and provided feedback: ${userFeedback}`
              : `User denied execution of ${toolCall.name}`;
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
