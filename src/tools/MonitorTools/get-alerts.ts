import { BaseTool } from "../base.js";
import type { ToolResult } from "../../core/types.js";
import type { SSHManager } from "../../utils/ssh-manager.js";
import { RemoteExecutor } from "../RemoteTools/executor.js";
import { shellQuote } from "../RemoteTools/sanitize.js";

const VALID_SEVERITIES = new Set(["critical", "warning", "info", "all"]);

export class GetAlertsTool extends BaseTool {
  name = "get_alerts";
  description =
    "Get active alerts from Alertmanager on a remote host. " +
    "Can filter by severity (critical/warning/info/all) and/or service name. " +
    "Target hosts by name, list, or inventory tags.";
  parameters = {
    type: "object",
    properties: {
      severity: {
        type: "string",
        enum: ["critical", "warning", "info", "all"],
        description: "Filter by alert severity (default: 'all')",
      },
      service: {
        type: "string",
        description: "Filter alerts by service/job name (optional)",
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

      const severity = typeof args.severity === "string" ? args.severity.trim() : "all";
      if (!VALID_SEVERITIES.has(severity)) {
        return {
          toolCallId: "",
          content: `Invalid severity "${severity}". Valid: ${[...VALID_SEVERITIES].join(", ")}`,
          isError: true,
        };
      }

      const service = typeof args.service === "string" ? args.service.trim() : "";

      // Build amtool or curl command to query Alertmanager API
      let command = "curl -sf http://localhost:9093/api/v2/alerts";
      const filters: string[] = [];
      if (severity !== "all") {
        filters.push(`severity=${shellQuote(severity)}`);
      }
      if (service) {
        filters.push(`service=${shellQuote(service)}`);
      }

      // Use amtool if available, fall back to curl + jq
      command = [
        `if command -v amtool >/dev/null 2>&1; then`,
        `  amtool alert query${severity !== "all" ? ` severity=${shellQuote(severity)}` : ""}${service ? ` service=${shellQuote(service)}` : ""} 2>/dev/null`,
        `else`,
        `  curl -sf http://localhost:9093/api/v2/alerts 2>/dev/null`,
        `  || curl -sf http://localhost:9090/api/v1/alerts 2>/dev/null`,
        `  || echo "No Alertmanager or Prometheus found on default ports (9093/9090)"`,
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
