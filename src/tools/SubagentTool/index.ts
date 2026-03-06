import { BaseTool } from "../base.js";
import type { ToolResult } from "../../core/types.js";
import type { SubagentRunner } from "../../subagent/runner.js";
import type { ToolFilterType } from "../../subagent/types.js";

export class DelegateTaskTool extends BaseTool {
  name = "delegate_task";
  description =
    "Delegate a task to an isolated subagent for execution. " +
    "The subagent runs with its own conversation history (context isolation) and filtered tool access. " +
    "Use this to:\n" +
    "- Explore/analyze infrastructure without polluting main conversation\n" +
    "- Run multi-step information gathering tasks in parallel\n" +
    "- Perform read-only investigations safely\n" +
    "- Break complex tasks into independent subtasks\n\n" +
    "The subagent returns a summary of its findings. " +
    "Tool filter options:\n" +
    "- readonly: Only read/query tools (safe for exploration)\n" +
    "- full: All tools except recursive delegation (for tasks that need writes)\n" +
    "- none: All tools (use with caution)";
  parameters = {
    type: "object",
    properties: {
      task: {
        type: "string",
        description: "Clear description of what the subagent should do. Be specific about what information to gather or what action to take.",
      },
      tool_filter: {
        type: "string",
        enum: ["readonly", "full", "none"],
        description: "Tool access level for the subagent (default: readonly). Use 'readonly' for exploration/analysis, 'full' for tasks that need modifications.",
      },
      max_steps: {
        type: "number",
        description: "Maximum number of steps the subagent can take (default: 15). Increase for complex multi-step tasks.",
      },
    },
    required: ["task"],
  };

  private runner: SubagentRunner;

  constructor(runner: SubagentRunner) {
    super();
    // Subagent delegation requires user confirmation
    this.requiresConfirmation = true;
    this.runner = runner;
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const task = args.task as string;
    const toolFilter = (args.tool_filter as ToolFilterType) || "readonly";
    const maxIterations = (args.max_steps as number) || 15;

    if (!task || task.trim().length === 0) {
      return { toolCallId: "", content: "Task description is required.", isError: true };
    }

    try {
      const result = await this.runner.run(task, {
        toolFilter,
        maxIterations,
      });

      const meta = result.metadata;
      const toolSummary = Object.entries(meta.toolCalls)
        .map(([name, count]) => `${name}(${count})`)
        .join(", ");

      const header = [
        `## Subagent Result`,
        `Status: ${result.success ? "completed" : "failed"}`,
        `Steps: ${meta.steps} | Duration: ${(meta.durationMs / 1000).toFixed(1)}s | Tools used: ${toolSummary || "none"}`,
        `Tool filter: ${toolFilter}`,
        `---`,
      ].join("\n");

      return {
        toolCallId: "",
        content: `${header}\n${result.output}`,
        isError: !result.success,
      };
    } catch (err) {
      return {
        toolCallId: "",
        content: `Subagent execution failed: ${(err as Error).message}`,
        isError: true,
      };
    }
  }
}
