import { BaseTool } from "../base.js";
import type { ToolResult } from "../../core/types.js";
import type { SSHManager } from "../../utils/ssh-manager.js";
import { RemoteExecutor } from "../RemoteTools/executor.js";
import { parsePort } from "../RemoteTools/sanitize.js";

export class CheckPortTool extends BaseTool {
  name = "check_port";
  description =
    "Check if a specific port is listening on remote host(s). " +
    "Returns the listening state and the process using the port if available. " +
    "Target hosts by name, list, or inventory tags.";
  parameters = {
    type: "object",
    properties: {
      port: {
        type: "number",
        description: "Port number to check (1-65535)",
      },
      host: {
        type: "string",
        description: "Single host name from inventory",
      },
      hosts: {
        type: "array",
        items: { type: "string" },
        description: "Array of host names",
      },
      tags: {
        type: "array",
        items: { type: "string" },
        description: "Query hosts by tags (AND logic)",
      },
    },
    required: ["port"],
  };

  private executor: RemoteExecutor;

  constructor(sshManager: SSHManager) {
    super();
    this.executor = new RemoteExecutor(sshManager);
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const port = parsePort(String(args.port));
      const targets = this.executor.resolve(args as {
        host?: string;
        hosts?: string[];
        tags?: string[];
      });

      const command = `{ ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null; } | grep ':${port} '`;

      const results = await this.executor.runOnHosts(
        targets,
        async (connId) => {
          try {
            const output = await this.executor.exec(connId, command);
            return `Port ${port}: LISTENING\n${output}`;
          } catch {
            return `Port ${port}: NOT LISTENING`;
          }
        },
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
