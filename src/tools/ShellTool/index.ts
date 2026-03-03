import { exec } from "node:child_process";
import { BaseTool } from "../base.js";
import type { ToolResult } from "../../core/types.js";

export class ShellTool extends BaseTool {
  name = "shell";
  description =
    "Execute a shell command on the local machine. Returns stdout and stderr.";
  parameters = {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The shell command to execute",
      },
      cwd: {
        type: "string",
        description:
          "Working directory (optional, defaults to current directory)",
      },
    },
    required: ["command"],
  };

  private commandChecker?: (cmd: string) => string | null;

  constructor() {
    super();
    this.requiresConfirmation = true;
  }

  setCommandChecker(checker: (cmd: string) => string | null) {
    this.commandChecker = checker;
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const command = args.command as string;
    const cwd = (args.cwd as string) || process.cwd();

    if (command.trim().startsWith("sudo ")) {
      this.privilege = "root";
    }

    if (this.commandChecker) {
      const denyReason = this.commandChecker(command);
      if (denyReason) {
        return {
          toolCallId: "",
          content: `Command denied by policy: ${command}\nReason: ${denyReason}`,
          isError: true,
        };
      }
    }

    return new Promise((resolve) => {
      exec(
        command,
        { cwd, timeout: 30000, maxBuffer: 1024 * 1024 },
        (error, stdout, stderr) => {
          const output = [
            stdout ? `stdout:\n${stdout}` : "",
            stderr ? `stderr:\n${stderr}` : "",
            error ? `exit code: ${error.code ?? 1}` : "exit code: 0",
          ]
            .filter(Boolean)
            .join("\n");

          resolve({
            toolCallId: "",
            content: output || "Command completed with no output.",
            isError: !!error,
          });
        },
      );
    });
  }
}
