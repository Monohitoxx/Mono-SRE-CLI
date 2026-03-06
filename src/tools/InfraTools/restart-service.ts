import { BaseTool } from "../base.js";
import type { ToolResult } from "../../core/types.js";
import type { SSHManager } from "../../utils/ssh-manager.js";
import { RemoteExecutor } from "../RemoteTools/executor.js";
import { assertServiceName, shellQuote } from "../RemoteTools/sanitize.js";

export class RestartServiceTool extends BaseTool {
  name = "restart_service";
  description =
    "Restart a systemd service on remote host(s). " +
    "Runs systemctl restart and returns the new status. " +
    "Requires an approved plan. " +
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
    this.requiresConfirmation = true;
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
      const restartCmd = `systemctl restart -- ${shellQuote(unit)}`;
      const statusCmd = `systemctl status --no-pager -- ${shellQuote(unit)}`;

      const results = await this.executor.runOnHosts(
        targets,
        async (connId) => {
          await this.executor.execWithSudoFallback(connId, restartCmd);
          const status = await this.executor.exec(connId, statusCmd);
          return `Restarted successfully.\n${status}`;
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
