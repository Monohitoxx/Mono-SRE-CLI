import * as fs from "node:fs/promises";
import * as path from "node:path";
import { BaseTool } from "../base.js";
import type { ToolResult } from "../../core/types.js";

export class FileReadTool extends BaseTool {
  name = "read_file";
  description = "Read the contents of a file at the given path.";
  parameters = {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Absolute or relative path to the file",
      },
    },
    required: ["path"],
  };

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const filePath = path.resolve(args.path as string);
    try {
      const content = await fs.readFile(filePath, "utf-8");
      return { toolCallId: "", content };
    } catch (err) {
      return {
        toolCallId: "",
        content: `Error reading file: ${(err as Error).message}`,
        isError: true,
      };
    }
  }
}
