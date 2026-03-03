import * as fs from "node:fs/promises";
import * as path from "node:path";
import { BaseTool } from "../base.js";
import type { ToolResult } from "../../core/types.js";

export class FileWriteTool extends BaseTool {
  name = "write_file";
  description =
    "Write content to a file at the given path. Creates directories if needed.";
  parameters = {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Absolute or relative path to the file",
      },
      content: {
        type: "string",
        description: "Content to write",
      },
    },
    required: ["path", "content"],
  };

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const filePath = path.resolve(args.path as string);
    const content = args.content as string;

    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, "utf-8");
      return {
        toolCallId: "",
        content: `Successfully wrote ${content.length} bytes to ${filePath}`,
      };
    } catch (err) {
      return {
        toolCallId: "",
        content: `Error writing file: ${(err as Error).message}`,
        isError: true,
      };
    }
  }
}
