import type { AIProvider } from "../providers/base.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { AuditLogger } from "../utils/audit.js";
import { Agent, type AgentCallbacks } from "../core/agent.js";
import type { Message, ToolCall, TokenUsage } from "../core/types.js";
import { createFilteredRegistry } from "./tool-filter.js";
import { type SubagentConfig, type SubagentResult, type SubagentMetadata, DEFAULT_SUBAGENT_CONFIG } from "./types.js";

const SUBAGENT_SYSTEM_PROMPT = `You are a subagent of Mono, executing a delegated task.

Key rules:
- Focus exclusively on the assigned task. Do not deviate.
- Be concise in your responses. Report findings clearly.
- If you cannot complete the task, explain why.
- Do NOT use sudo. Do NOT modify any infrastructure.
- Gather information, analyze, and report back.

## System-Enforced Rules
- Run ONE command per execute_command call. Do NOT chain with && || or ;. Pipes (|) for output filtering are OK.
- Do NOT use grep alternation with \\| — use grep -e "pat1" -e "pat2" instead.
- Policy denial ("Command denied by policy") = blocked, do NOT retry. Restructure the approach.
- Permission error ("permission denied") = retry the same command, the system will auto-escalate.
- NEVER fabricate or guess connection details (hostnames, IPs, passwords).

When your task is complete, provide a clear summary of your findings.`;

const SUBAGENT_FULL_ACCESS_PROMPT = `You are a subagent of Mono, executing a delegated task with full tool access.

Key rules:
- Focus exclusively on the assigned task. Do not deviate.
- Be concise in your responses. Report findings clearly.
- If you cannot complete the task, explain why.
- You have write access to tools — use with care.
- For any modifying operation, still use the plan tool first.

## System-Enforced Rules
- Do NOT add sudo to commands. Run without sudo first; the system auto-escalates on permission errors.
- Run ONE command per execute_command call. Do NOT chain with && || or ;. Pipes (|) for output filtering are OK.
- Do NOT use grep alternation with \\| — use grep -e "pat1" -e "pat2" instead.
- Policy denial ("Command denied by policy") = blocked, do NOT retry. Restructure the approach.
- Permission error ("permission denied") = retry the same command, the system will auto-escalate.
- NEVER fabricate or guess connection details (hostnames, IPs, passwords).

When your task is complete, provide a clear summary of your findings and actions taken.`;

export class SubagentRunner {
  private provider: AIProvider;
  private sourceRegistry: ToolRegistry;
  private audit?: AuditLogger;

  constructor(provider: AIProvider, sourceRegistry: ToolRegistry, audit?: AuditLogger) {
    this.provider = provider;
    this.sourceRegistry = sourceRegistry;
    this.audit = audit;
  }

  /**
   * Run a task in an isolated subagent with filtered tool access.
   * The subagent has its own conversation history — it does NOT
   * share or pollute the main agent's context.
   */
  async run(
    task: string,
    config: Partial<SubagentConfig> = {},
    onProgress?: (event: SubagentProgressEvent) => void,
  ): Promise<SubagentResult> {
    const cfg: SubagentConfig = { ...DEFAULT_SUBAGENT_CONFIG, ...config };
    const startTime = Date.now();

    // 1. Create filtered tool registry (context isolation)
    const filteredRegistry = createFilteredRegistry(
      this.sourceRegistry,
      cfg.toolFilter,
      cfg.allowedTools,
      cfg.deniedTools,
    );

    // 2. Choose system prompt based on access level
    const systemPrompt = cfg.toolFilter === "full" || cfg.toolFilter === "none"
      ? SUBAGENT_FULL_ACCESS_PROMPT
      : SUBAGENT_SYSTEM_PROMPT;

    // 3. Create isolated Agent (independent conversation history)
    const subagent = new Agent(
      this.provider,
      filteredRegistry,
      systemPrompt,
      undefined, // use default context limit
    );

    if (this.audit) {
      subagent.setAuditLogger(this.audit);
    }

    // 4. Collect results via headless callbacks
    const metadata: SubagentMetadata = {
      steps: 0,
      durationMs: 0,
      toolCalls: {},
      hadErrors: false,
    };

    let outputText = "";
    let runError: string | null = null;

    const callbacks: AgentCallbacks = {
      onTextDelta: (text) => {
        outputText += text;
      },
      onReasoningDelta: () => {},
      onThinkingBoundary: () => {
        outputText = "";
      },
      onIterationEnd: () => {
        metadata.steps++;
      },
      onToolCallStart: (toolCall) => {
        metadata.toolCalls[toolCall.name] = (metadata.toolCalls[toolCall.name] || 0) + 1;
        onProgress?.({ type: "tool_start", toolName: toolCall.name, step: metadata.steps });
      },
      onToolCallEnd: (_toolCall, _result, isError) => {
        if (isError) metadata.hadErrors = true;
        metadata.steps++;
        onProgress?.({ type: "tool_end", step: metadata.steps });
      },
      onConfirmToolCall: async (_toolCall) => {
        // Subagents auto-approve all tool calls within their filtered registry.
        // For "readonly" filter this is safe — only read tools are available.
        // WARNING: For "full"/"none" filters, this bypasses user confirmation for
        // plan-required operations (the plan tool itself is also auto-approved).
        // The Agent's gates 1-3 (validation, risk classification, sudo rejection)
        // still apply, but gate 4 (user confirmation) is skipped.
        // TODO: Consider propagating confirmation to the parent agent for full-access subagents.
        return true;
      },
      onUsage: (_usage: TokenUsage) => {},
      onDone: (_message: Message) => {
        onProgress?.({ type: "done" });
      },
      onError: (error: string) => {
        runError = error;
        metadata.hadErrors = true;
        onProgress?.({ type: "error", error });
      },
    };

    // 5. Audit subagent start
    this.audit?.log("subagent_start", {
      task: task.slice(0, 200),
      toolFilter: cfg.toolFilter,
      maxIterations: cfg.maxIterations,
      availableTools: filteredRegistry.getDefinitions().map((t) => t.name),
    });

    // 6. Run the agent loop
    await subagent.run(task, callbacks);

    metadata.durationMs = Date.now() - startTime;

    // 7. Audit subagent end
    this.audit?.log("subagent_end", {
      success: !runError,
      steps: metadata.steps,
      durationMs: metadata.durationMs,
      toolCalls: metadata.toolCalls,
      hadErrors: metadata.hadErrors,
    });

    return {
      success: !runError,
      output: runError ? `Subagent error: ${runError}\n\nPartial output:\n${outputText}` : outputText,
      metadata,
    };
  }
}

export interface SubagentProgressEvent {
  type: "tool_start" | "tool_end" | "done" | "error";
  toolName?: string;
  step?: number;
  error?: string;
}
