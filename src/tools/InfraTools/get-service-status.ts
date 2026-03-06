import { BaseTool } from "../base.js";
import type { ToolResult } from "../../core/types.js";
import type { SSHManager } from "../../utils/ssh-manager.js";
import { RemoteExecutor } from "../RemoteTools/executor.js";
import { assertServiceName, shellQuote } from "../RemoteTools/sanitize.js";

export class GetServiceStatusTool extends BaseTool {
  name = "get_service_status";
  description =
    "Get the status of a systemd service on remote host(s). " +
    "Returns detailed service status including active state, PID, memory, and recent log lines. " +
    "Target hosts by name, list, or inventory tags.";
  parameters = {
    type: "object",
    properties: {
      service: {
        type: "string",
        description: "Service name (e.g. 'nginx', 'docker', 'sshd')",
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

      const unit = service.endsWith(".service") ? service : `${service}.service`;
      const command = `systemctl status --no-pager -- ${shellQuote(unit)}`;

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
