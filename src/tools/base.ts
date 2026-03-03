import type { ToolDefinition, ToolResult } from "../core/types.js";

export type PrivilegeLevel = "normal" | "elevated" | "root";

export abstract class BaseTool {
  abstract name: string;
  abstract description: string;
  abstract parameters: Record<string, unknown>;

  requiresConfirmation = false;
  privilege: PrivilegeLevel = "normal";

  abstract execute(args: Record<string, unknown>): Promise<ToolResult>;

  /**
   * Validates that all required parameters are present and non-empty.
   * Returns null if valid, or a ToolResult error if invalid.
   */
  validateArgs(args: Record<string, unknown>): ToolResult | null {
    const schema = this.parameters as {
      required?: string[];
      properties?: Record<string, unknown>;
    };
    const required = schema.required || [];
    const missing: string[] = [];

    for (const key of required) {
      const val = args[key];
      if (val === undefined || val === null || val === "") {
        missing.push(key);
      }
    }

    if (missing.length > 0) {
      return {
        toolCallId: "",
        content: `Missing required arguments for ${this.name}: ${missing.join(", ")}. Please provide all required parameters.`,
        isError: true,
      };
    }

    return null;
  }

  getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      parameters: this.parameters,
    };
  }
}
