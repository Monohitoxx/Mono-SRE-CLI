import { BaseTool } from "../base.js";
import type { ToolResult } from "../../core/types.js";
import type { SSHManager } from "../../utils/ssh-manager.js";
import { RemoteExecutor } from "../RemoteTools/executor.js";
import { assertServiceName, shellQuote } from "../RemoteTools/sanitize.js";

export class GetLogsTool extends BaseTool {
  name = "get_logs";
  description =
    "Get recent journal logs for a systemd service on remote host(s). " +
    "Supports limiting the number of lines and filtering by keyword. " +
    "Target hosts by name, list, or inventory tags.";
  parameters = {
    type: "object",
    properties: {
      service: {
        type: "string",
        description: "Service name (e.g. 'nginx', 'docker', 'sshd')",
      },
      lines: {
        type: "number",
        description: "Number of recent log lines to return (default: 50, max: 500)",
      },
      filter: {
        type: "string",
        description: "Optional keyword to filter logs (case-insensitive grep)",
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
    required: ["service"],
  };

  private executor: RemoteExecutor;

  constructor(sshManager: SSHManager) {
    super();
    this.executor = new RemoteExecutor(sshManager);
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const service = assertServiceName(String(args.service || ""));
      const targets = this.executor.resolve(args as {
        host?: string;
        hosts?: string[];
        tags?: string[];
      });

      let lines = typeof args.lines === "number" ? args.lines : 50;
      if (lines < 1) lines = 1;
      if (lines > 500) lines = 500;

      const filter = typeof args.filter === "string" ? args.filter.trim() : "";

      let command = `journalctl -u ${shellQuote(service)} --no-pager -n ${lines}`;
      if (filter) {
        command += ` | grep -i ${shellQuote(filter)}`;
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
