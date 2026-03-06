import { BaseTool } from "../base.js";
import type { ToolResult } from "../../core/types.js";
import type { SSHManager } from "../../utils/ssh-manager.js";
import { RemoteExecutor } from "../RemoteTools/executor.js";
import { assertServiceName, shellQuote } from "../RemoteTools/sanitize.js";

export class CheckUptimeTool extends BaseTool {
  name = "check_uptime";
  description =
    "Check how long a systemd service has been running (uptime) on remote host(s). " +
    "Returns the active state, PID, and time since activation. " +
    "Target hosts by name, list, or inventory tags.";
  parameters = {
    type: "object",
    properties: {
      service: {
        type: "string",
        description: "Service name to check (e.g. 'nginx', 'docker', 'prometheus')",
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
      const command = `systemctl show --property=ActiveState,SubState,MainPID,ActiveEnterTimestamp --no-pager -- ${shellQuote(unit)}`;

      const results = await this.executor.runOnHosts(
        targets,
        async (connId) => {
          const props = await this.executor.exec(connId, command);

          // Also get human-readable uptime
          let uptime = "";
          try {
            uptime = await this.executor.exec(
              connId,
              `systemctl show --property=ActiveEnterTimestamp --value -- ${shellQuote(unit)}`,
            );
          } catch { /* ignore */ }

          return uptime ? `${props}\nRunning since: ${uptime}` : props;
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
