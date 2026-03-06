import { BaseTool } from "../base.js";
import type { ToolResult } from "../../core/types.js";
import type { SSHManager } from "../../utils/ssh-manager.js";
import { RemoteExecutor } from "../RemoteTools/executor.js";
import { shellQuote } from "../RemoteTools/sanitize.js";

export class SilenceAlertTool extends BaseTool {
  name = "silence_alert";
  description =
    "Silence an active alert in Alertmanager for a specified duration. " +
    "Requires an approved plan. " +
    "Target hosts by name, list, or inventory tags.";
  parameters = {
    type: "object",
    properties: {
      alert_id: {
        type: "string",
        description: "Alert name or matcher to silence (e.g. 'HighCPU', 'alertname=HighCPU')",
      },
      duration: {
        type: "string",
        description: "Silence duration (e.g. '1h', '30m', '2h', '1d'). Default: '1h'",
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
    required: ["alert_id"],
  };

  private executor: RemoteExecutor;

  constructor(sshManager: SSHManager) {
    super();
    this.requiresConfirmation = true;
    this.executor = new RemoteExecutor(sshManager);
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const alertId = String(args.alert_id || "").trim();
      if (!alertId) {
        return { toolCallId: "", content: "alert_id is required.", isError: true };
      }

      // Validate no shell injection in alert_id
      if (/[;&|`$(){}]/.test(alertId)) {
        return {
          toolCallId: "",
          content: "Invalid characters in alert_id.",
          isError: true,
        };
      }

      const duration = typeof args.duration === "string" ? args.duration.trim() : "1h";
      if (!/^\d+[smhd]$/.test(duration)) {
        return {
          toolCallId: "",
          content: `Invalid duration "${duration}". Use format like '30m', '1h', '2h', '1d'.`,
          isError: true,
        };
      }

      const targets = this.executor.resolve(args as {
        host?: string;
        hosts?: string[];
        tags?: string[];
      });

      // Build matcher: if it already contains '=', use as-is; otherwise default to alertname=
      const matcher = alertId.includes("=") ? alertId : `alertname=${alertId}`;

      const command = [
        `if command -v amtool >/dev/null 2>&1; then`,
        `  amtool silence add ${shellQuote(matcher)} --duration=${shellQuote(duration)} --comment=${shellQuote("Silenced via Mono AI")} 2>&1`,
        `else`,
        `  echo "amtool not found. Install alertmanager to manage silences, or use the Alertmanager API directly."`,
        `fi`,
      ].join("\n");

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
