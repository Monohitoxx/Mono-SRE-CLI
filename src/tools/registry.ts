import type { BaseTool, PrivilegeLevel } from "./base.js";
import type { ToolDefinition, ToolResult, ToolCall } from "../core/types.js";
import { ShellTool } from "./ShellTool/index.js";
import { ThinkTool } from "./ThinkTool/index.js";
import { PlanTool } from "./PlanTool/index.js";

export class ToolRegistry {
  private tools = new Map<string, BaseTool>();
  private rootEnabled = false;

  register(tool: BaseTool) {
    this.tools.set(tool.name, tool);
  }

  setRootEnabled(enabled: boolean) {
    this.rootEnabled = enabled;
  }

  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.getDefinition());
  }

  /**
   * Pre-flight argument validation — called BEFORE confirmation UI.
   * Returns null if valid, or a ToolResult error if args are missing.
   */
  validateToolCall(toolCall: ToolCall): ToolResult | null {
    const tool = this.tools.get(toolCall.name);
    if (!tool) {
      return {
        toolCallId: toolCall.id,
        content: `Unknown tool: ${toolCall.name}`,
        isError: true,
      };
    }
    const error = tool.validateArgs(toolCall.arguments);
    if (error) {
      error.toolCallId = toolCall.id;
      return error;
    }
    return null;
  }

  async execute(toolCall: ToolCall): Promise<ToolResult> {
    const tool = this.tools.get(toolCall.name);
    if (!tool) {
      return {
        toolCallId: toolCall.id,
        content: `Unknown tool: ${toolCall.name}`,
        isError: true,
      };
    }

    const result = await tool.execute(toolCall.arguments);
    result.toolCallId = toolCall.id;
    return result;
  }

  needsConfirmation(toolName: string): boolean {
    const tool = this.tools.get(toolName);
    return tool?.requiresConfirmation ?? false;
  }

  getPrivilege(toolName: string): PrivilegeLevel {
    const tool = this.tools.get(toolName);
    return tool?.privilege ?? "normal";
  }

  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  getTool(name: string): BaseTool | undefined {
    return this.tools.get(name);
  }

  isRootEnabled(): boolean {
    return this.rootEnabled;
  }
}

export function createDefaultRegistry(
  commandChecker?: (cmd: string) => string | null,
): ToolRegistry {
  const registry = new ToolRegistry();

  const shellTool = new ShellTool();
  if (commandChecker) {
    shellTool.setCommandChecker(commandChecker);
  }

  registry.register(new ThinkTool());
  registry.register(new PlanTool());
  registry.register(shellTool);

  return registry;
}
