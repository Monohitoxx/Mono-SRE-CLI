import { BaseTool } from "../base.js";
import type { ToolResult } from "../../core/types.js";

export class ThinkTool extends BaseTool {
  name = "think";
  description = `Use this tool for internal reasoning and brainstorming. It does not execute anything or obtain new information - it just logs your thought process for transparency.

Common use cases:
1. Analyzing a complex infrastructure task and deciding whether it needs a plan
2. Evaluating system state to determine the best approach
3. Reasoning about potential risks before executing commands
4. Deciding between multiple approaches (e.g. yum vs dnf, systemctl vs service)
5. Assessing pre-flight check results before proceeding`;

  parameters = {
    type: "object",
    properties: {
      thought: {
        type: "string",
        description: "Your internal reasoning or analysis",
      },
    },
    required: ["thought"],
  };

  constructor() {
    super();
    this.requiresConfirmation = false;
  }

  async execute(_args: Record<string, unknown>): Promise<ToolResult> {
    return {
      toolCallId: "",
      content: "Thinking complete.",
    };
  }
}
