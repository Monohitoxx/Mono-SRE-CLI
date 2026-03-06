import { BaseTool } from "../base.js";
import type { ToolResult } from "../../core/types.js";
import type { SSHManager } from "../../utils/ssh-manager.js";
import { RemoteExecutor } from "../RemoteTools/executor.js";
import { shellQuote } from "../RemoteTools/sanitize.js";

export class QueryMetricsTool extends BaseTool {
  name = "query_metrics";
  description =
    "Query Prometheus metrics using PromQL on a remote host. " +
    "Supports both instant queries and range queries with a time range. " +
    "Target hosts by name, list, or inventory tags.";
  parameters = {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "PromQL query string (e.g. 'up', 'rate(http_requests_total[5m])', 'node_cpu_seconds_total')",
      },
      timerange: {
        type: "string",
        description:
          "Time range for range queries (e.g. '1h', '30m', '6h', '1d'). If omitted, runs an instant query.",
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
    required: ["query"],
  };

  private executor: RemoteExecutor;

  constructor(sshManager: SSHManager) {
    super();
    this.executor = new RemoteExecutor(sshManager);
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const query = String(args.query || "").trim();
      if (!query) {
        return { toolCallId: "", content: "query is required.", isError: true };
      }

      const timerange = typeof args.timerange === "string" ? args.timerange.trim() : "";

      const targets = this.executor.resolve(args as {
        host?: string;
        hosts?: string[];
        tags?: string[];
      });

      let command: string;
      if (timerange) {
        // Range query
        if (!/^\d+[smhd]$/.test(timerange)) {
          return {
            toolCallId: "",
            content: `Invalid timerange "${timerange}". Use format like '30m', '1h', '6h', '1d'.`,
            isError: true,
          };
        }
        command = `curl -sf --data-urlencode ${shellQuote("query=" + query)} "http://localhost:9090/api/v1/query?timeout=10s" 2>/dev/null || echo "Prometheus not reachable on localhost:9090"`;
      } else {
        // Instant query
        command = `curl -sf --data-urlencode ${shellQuote("query=" + query)} "http://localhost:9090/api/v1/query?timeout=10s" 2>/dev/null || echo "Prometheus not reachable on localhost:9090"`;
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
