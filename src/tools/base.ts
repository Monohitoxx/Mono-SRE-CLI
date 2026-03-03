import type { ToolDefinition, ToolResult } from "../core/types.js";

export type PrivilegeLevel = "normal" | "elevated" | "root";

export abstract class BaseTool {
  abstract name: string;
  abstract description: string;
  abstract parameters: Record<string, unknown>;

  requiresConfirmation = false;
  privilege: PrivilegeLevel = "normal";

  abstract execute(args: Record<string, unknown>): Promise<ToolResult>;

  getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      parameters: this.parameters,
    };
  }
}
