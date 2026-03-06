import { BaseTool } from "../base.js";
import type { ToolResult } from "../../core/types.js";
import type { SSHManager } from "../../utils/ssh-manager.js";
import { RemoteExecutor } from "../RemoteTools/executor.js";

export class GetSystemMetricsTool extends BaseTool {
  name = "get_system_metrics";
  description =
    "Get system metrics (CPU load, RAM usage, disk usage) from remote host(s). " +
    "Returns a combined overview of system resource utilization. " +
    "Target hosts by name, list, or inventory tags.";
  parameters = {
    type: "object",
    properties: {
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
    required: [],
  };

  private executor: RemoteExecutor;

  constructor(sshManager: SSHManager) {
    super();
    this.executor = new RemoteExecutor(sshManager);
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const targets = this.executor.resolve(args as {
        host?: string;
        hosts?: string[];
        tags?: string[];
      });

      const results = await this.executor.runOnHosts(
        targets,
        async (connId) => {
          const sections: string[] = [];

          // CPU
          try {
            const cpu = await this.executor.exec(connId, "uptime");
            sections.push(`[CPU Load]\n${cpu}`);
          } catch (err) {
            sections.push(`[CPU Load] ERROR: ${(err as Error).message}`);
          }

          // Memory
          try {
            const mem = await this.executor.exec(
              connId,
              "free -h 2>/dev/null || awk '/MemTotal/{t=$2} /MemAvailable/{a=$2} END{printf \"Total: %dMB  Available: %dMB\\n\",t/1024,a/1024}' /proc/meminfo",
            );
            sections.push(`[Memory]\n${mem}`);
          } catch (err) {
            sections.push(`[Memory] ERROR: ${(err as Error).message}`);
          }

          // Disk
          try {
            const disk = await this.executor.exec(connId, "df -h --total 2>/dev/null || df -h");
            sections.push(`[Disk]\n${disk}`);
          } catch (err) {
            sections.push(`[Disk] ERROR: ${(err as Error).message}`);
          }

          return sections.join("\n\n");
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
