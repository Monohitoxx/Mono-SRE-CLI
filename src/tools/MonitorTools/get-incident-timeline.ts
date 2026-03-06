import { BaseTool } from "../base.js";
import type { ToolResult } from "../../core/types.js";
import type { SSHManager } from "../../utils/ssh-manager.js";
import { RemoteExecutor } from "../RemoteTools/executor.js";
import { shellQuote } from "../RemoteTools/sanitize.js";

export class GetIncidentTimelineTool extends BaseTool {
  name = "get_incident_timeline";
  description =
    "Get the timeline of a monitoring incident by querying Alertmanager alert history and journal logs. " +
    "Provides a chronological view of when alerts fired, resolved, and related system events. " +
    "Target hosts by name, list, or inventory tags.";
  parameters = {
    type: "object",
    properties: {
      incident_id: {
        type: "string",
        description:
          "Incident identifier — can be an alert name (e.g. 'HighCPU'), " +
          "an alertname matcher (e.g. 'alertname=HighCPU'), " +
          "or a service name to search journal logs for.",
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
    required: ["incident_id"],
  };

  private executor: RemoteExecutor;

  constructor(sshManager: SSHManager) {
    super();
    this.executor = new RemoteExecutor(sshManager);
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const incidentId = String(args.incident_id || "").trim();
      if (!incidentId) {
        return { toolCallId: "", content: "incident_id is required.", isError: true };
      }

      if (/[;&|`$(){}]/.test(incidentId)) {
        return {
          toolCallId: "",
          content: "Invalid characters in incident_id.",
          isError: true,
        };
      }

      const targets = this.executor.resolve(args as {
        host?: string;
        hosts?: string[];
        tags?: string[];
      });

      const results = await this.executor.runOnHosts(
        targets,
        async (connId) => {
          const sections: string[] = [];

          // 1. Alertmanager history
          try {
            const alertCmd = [
              `if command -v amtool >/dev/null 2>&1; then`,
              `  echo "=== Alertmanager History ==="`,
              `  amtool alert query ${shellQuote(incidentId.includes("=") ? incidentId : `alertname=${incidentId}`)} 2>/dev/null`,
              `else`,
              `  echo "=== Alertmanager API ==="`,
              `  curl -sf "http://localhost:9093/api/v2/alerts?filter=${shellQuote(incidentId.includes("=") ? incidentId : `alertname="${incidentId}"`)}" 2>/dev/null || echo "(Alertmanager not reachable)"`,
              `fi`,
            ].join("\n");
            const alerts = await this.executor.exec(connId, alertCmd);
            sections.push(alerts);
          } catch (err) {
            sections.push(`[Alertmanager] ERROR: ${(err as Error).message}`);
          }

          // 2. Journal logs for the service/incident
          try {
            const journalCmd = `echo "=== Journal Logs (last 2h) ===" && journalctl --since "2 hours ago" --no-pager -n 50 -g ${shellQuote(incidentId)} 2>/dev/null || echo "(No matching journal entries)"`;
            const journal = await this.executor.exec(connId, journalCmd);
            sections.push(journal);
          } catch (err) {
            sections.push(`[Journal] ERROR: ${(err as Error).message}`);
          }

          // 3. Recent system events
          try {
            const eventsCmd = `echo "=== Recent System Events ===" && journalctl --since "2 hours ago" --no-pager -n 20 -p err 2>/dev/null || echo "(No recent error events)"`;
            const events = await this.executor.exec(connId, eventsCmd);
            sections.push(events);
          } catch (err) {
            sections.push(`[Events] ERROR: ${(err as Error).message}`);
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
