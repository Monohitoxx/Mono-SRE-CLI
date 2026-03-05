import * as fs from "node:fs/promises";
import * as path from "node:path";
import { BaseTool } from "../base.js";
import type { ToolResult } from "../../core/types.js";

export class FileReadTool extends BaseTool {
  name = "read_file";
  description =
    "Read a LOCAL file on this machine. For files on remote hosts, use read_config or execute_command with cat instead. " +
    "Optionally specify a line range to read only part of the file (useful for large files).";
  parameters = {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Absolute or relative path to the file",
      },
      start_line: {
        type: "number",
        description: "First line to read (1-based, inclusive). Omit to read from the start.",
      },
      end_line: {
        type: "number",
        description: "Last line to read (1-based, inclusive). Omit to read to the end.",
      },
    },
    required: ["path"],
  };

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const filePath = path.resolve(args.path as string);
    const startLine = typeof args.start_line === "number" ? args.start_line : undefined;
    const endLine = typeof args.end_line === "number" ? args.end_line : undefined;

    try {
      const raw = await fs.readFile(filePath, "utf-8");

      if (startLine === undefined && endLine === undefined) {
        return { toolCallId: "", content: raw };
      }

      const lines = raw.split("\n");
      const from = Math.max(1, startLine ?? 1);
      const to = Math.min(lines.length, endLine ?? lines.length);

      const selected = lines.slice(from - 1, to);
      const numbered = selected
        .map((line, i) => `${String(from + i).padStart(5)} | ${line}`)
        .join("\n");

      const header = `${filePath} (lines ${from}-${to} of ${lines.length})`;
      return { toolCallId: "", content: `${header}\n${numbered}` };
    } catch (err) {
      return {
        toolCallId: "",
        content: `Error reading file: ${(err as Error).message}`,
        isError: true,
      };
    }
  }
}
