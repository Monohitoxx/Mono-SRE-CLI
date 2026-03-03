import { BaseTool } from "../base.js";
import type { ToolResult } from "../../core/types.js";

export class PlanProgressTool extends BaseTool {
  name = "plan_progress";
  description =
    "Update the progress of the current execution plan. " +
    "Call with action='start' before beginning a step, and action='done' after completing it. " +
    "This updates the visual progress tracker shown to the user.";
  parameters = {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["start", "done"],
        description: "'start' = mark step as in-progress, 'done' = mark step as completed",
      },
      step: {
        type: "number",
        description: "The step number (1-based) from the approved plan",
      },
    },
    required: ["action", "step"],
  };

  constructor() {
    super();
    this.requiresConfirmation = false;
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const action = args.action as string;
    const step = args.step as number;

    return {
      toolCallId: "",
      content: `Step ${step} marked as ${action === "done" ? "completed" : "in progress"}.`,
    };
  }
}
