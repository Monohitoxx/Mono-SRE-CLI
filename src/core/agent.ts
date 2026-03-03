import type { AIProvider } from "../providers/base.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { StreamEvent, ToolCall, Message } from "./types.js";
import { Conversation } from "./conversation.js";
import { classifyToolCallRisk } from "./risk-classifier.js";

export interface AgentCallbacks {
  onTextDelta: (text: string) => void;
  onToolCallStart: (toolCall: ToolCall) => void;
  onToolCallEnd: (toolCall: ToolCall, result: string, isError?: boolean) => void;
  onConfirmToolCall: (toolCall: ToolCall) => Promise<boolean>;
  onDone: (message: Message) => void;
  onError: (error: string) => void;
}

export class Agent {
  private provider: AIProvider;
  private toolRegistry: ToolRegistry;
  private conversation: Conversation;
  private isRunning = false;
  private planApprovedForTurn = false;

  constructor(
    provider: AIProvider,
    toolRegistry: ToolRegistry,
    systemPrompt: string,
  ) {
    this.provider = provider;
    this.toolRegistry = toolRegistry;
    this.conversation = new Conversation(systemPrompt);
  }

  get running(): boolean {
    return this.isRunning;
  }

  async run(userMessage: string, callbacks: AgentCallbacks): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    this.planApprovedForTurn = false;

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
    const maxIterations = 20;

    for (let i = 0; i < maxIterations; i++) {
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
          case "done":
            this.conversation.addAssistant(event.message);
            break;
          case "error":
            callbacks.onError(event.error);
            return;
        }
      }

      if (pendingToolCalls.length === 0) {
        callbacks.onDone({
          role: "assistant",
          content: assistantText,
        });
        return;
      }

      for (const toolCall of pendingToolCalls) {
        // ─── POLICY: Risk classification gate ────────────────────────
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

          callbacks.onToolCallStart(toolCall);
          this.conversation.addToolResult(toolCall.id, policyMsg, true);
          callbacks.onToolCallEnd(toolCall, policyMsg, true);
          continue;
        }

        // ─── Normal confirmation flow ────────────────────────────────
        const needsConfirm = this.toolRegistry.needsConfirmation(toolCall.name);

        callbacks.onToolCallStart(toolCall);

        if (needsConfirm) {
          const approved = await callbacks.onConfirmToolCall(toolCall);
          if (!approved) {
            const deniedMsg = `User denied execution of ${toolCall.name}`;
            this.conversation.addToolResult(toolCall.id, deniedMsg, true);
            callbacks.onToolCallEnd(toolCall, deniedMsg, true);

            if (toolCall.name === "plan") {
              this.planApprovedForTurn = false;
            }
            continue;
          }
        }

        const result = await this.toolRegistry.execute(toolCall);
        this.conversation.addToolResult(
          toolCall.id,
          result.content,
          result.isError,
        );
        callbacks.onToolCallEnd(toolCall, result.content, result.isError);

        // ─── Track plan approval ─────────────────────────────────────
        if (toolCall.name === "plan" && !result.isError) {
          this.planApprovedForTurn = true;
        }
      }
    }

    callbacks.onError("Maximum agent iterations reached.");
  }

  clearHistory() {
    this.conversation.clear();
  }
}
