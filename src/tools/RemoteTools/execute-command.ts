import { BaseTool } from "../base.js";
import type { ToolResult } from "../../core/types.js";
import type { SSHManager } from "../../utils/ssh-manager.js";
import { RemoteExecutor } from "./executor.js";

export class ExecuteCommandTool extends BaseTool {
  name = "execute_command";
  description =
    "Execute a command on one or more remote hosts. " +
    "Target hosts by name, list, or inventory tags. " +
    "For multi-host targeting, the command runs in parallel on all matched hosts. " +
    "IMPORTANT: Only commands in the system allowlist are permitted — if a command is denied, the error will explain why. " +
    "Run ONE command per call — do NOT chain with &&, ||, or ;. Pipes (|) for filtering output are OK (e.g. 'dpkg -l | grep nginx'). " +
    "Do NOT prefix with sudo — if you get a permission error, just retry the same command and the system will auto-escalate. " +
    "Do NOT use this tool for systemctl (use service_control), reading config files (use read_config), or writing config files (use write_config).";
  parameters = {
    type: "object",
    properties: {
      host: {
        type: "string",
        description: "Single host name from inventory (e.g. 'hk01')",
      },
      hosts: {
        type: "array",
        items: { type: "string" },
        description: "Array of host names (e.g. ['hk01', 'hk02'])",
      },
      tags: {
        type: "array",
        items: { type: "string" },
        description:
          "Query hosts by tags (AND logic). E.g. ['hk', 'prod'] matches hosts with both tags.",
      },
      command: {
        type: "string",
        description: "The command to execute on the remote host(s).",
      },
    },
    required: ["command"],
  };

  private executor: RemoteExecutor;
  private commandChecker?: (cmd: string) => string | null;

  constructor(
    sshManager: SSHManager,
    commandChecker?: (cmd: string) => string | null,
  ) {
    super();
    this.requiresConfirmation = true;
    this.executor = new RemoteExecutor(sshManager);
    this.commandChecker = commandChecker;
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const targets = this.executor.resolve(args as {
        host?: string;
        hosts?: string[];
        tags?: string[];
      });

      const command = args.command as string;

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

      const results = await this.executor.runOnHosts(
        targets,
        async (connId) => this.executor.exec(connId, command),
      );

      return {
        toolCallId: "",
        content: RemoteExecutor.formatResults(results),
        isError: results.every((r) => r.isError),
      };
    } catch (err) {
      return {
        toolCallId: "",
        content: (err as Error).message,
        isError: true,
      };
    }
  }
}
