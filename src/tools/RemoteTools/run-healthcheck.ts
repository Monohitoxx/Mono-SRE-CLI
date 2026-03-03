import { BaseTool } from "../base.js";
import type { ToolResult } from "../../core/types.js";
import type { SSHManager } from "../../utils/ssh-manager.js";
import { RemoteExecutor } from "./executor.js";
import {
  assertHttpUrl,
  assertServiceName,
  parsePort,
  parseStdout,
  shellQuote,
} from "./sanitize.js";

/**
 * Supported check types:
 * - "ping"           — ping localhost
 * - "port:<num>"     — check if port is listening
 * - "http(s)://<url>" — curl a URL
 * - "service:<name>" — systemctl is-active <name>
 * - "disk"           — df -h
 * - "memory"         — free -h
 * - "cpu"            — uptime (load average)
 */
function buildCheckCommand(check: string): { label: string; command: string } {
  const trimmed = check.trim();

  if (trimmed === "ping") {
    return { label: "Ping", command: "ping -c 1 -W 2 localhost && echo OK || echo FAIL" };
  }

  if (trimmed === "disk") {
    return { label: "Disk", command: "df -h --output=target,pcent,avail | head -20" };
  }

  if (trimmed === "memory") {
    return { label: "Memory", command: "free -h" };
  }

  if (trimmed === "cpu") {
    return { label: "CPU Load", command: "uptime" };
  }

  if (trimmed.startsWith("port:")) {
    const port = parsePort(trimmed.slice(5));
    return {
      label: `Port ${port}`,
      command: `ss -tlnp | grep ':${port} ' && echo "LISTENING" || echo "NOT LISTENING"`,
    };
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    const url = assertHttpUrl(trimmed);
    return {
      label: `HTTP ${url}`,
      command: `curl -s -o /dev/null -w "HTTP %{http_code} (%{time_total}s)" --max-time 5 ${shellQuote(url)}`,
    };
  }

  if (trimmed.startsWith("service:")) {
    const svc = assertServiceName(trimmed.slice(8));
    return {
      label: `Service ${svc}`,
      command: `systemctl is-active -- ${shellQuote(svc)} && echo "RUNNING" || echo "NOT RUNNING"`,
    };
  }

  throw new Error(
    `Unsupported check "${check}". Allowed: ping, port:<num>, http(s)://<url>, service:<name>, disk, memory, cpu`,
  );
}

export class RunHealthcheckTool extends BaseTool {
  name = "run_healthcheck";
  description =
    "Run health checks on one or more remote hosts. " +
    "Supported checks: ping, port:<num>, http(s)://<url>, service:<name>, disk, memory, cpu. " +
    "Multiple checks can be run at once. " +
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
      checks: {
        type: "array",
        items: { type: "string" },
        description:
          "List of checks to run. Types: 'ping', 'port:<num>', 'http(s)://<url>', 'service:<name>', 'disk', 'memory', 'cpu'",
      },
    },
    required: ["checks"],
  };

  private executor: RemoteExecutor;

  constructor(sshManager: SSHManager) {
    super();
    this.requiresConfirmation = false;
    this.executor = new RemoteExecutor(sshManager);
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const targets = this.executor.resolve(args as {
        host?: string;
        hosts?: string[];
        tags?: string[];
      });

      const checks = (args.checks as string[]) || [];
      if (checks.length === 0) {
        return {
          toolCallId: "",
          content: "No checks specified. Use: ping, port:<num>, http(s)://<url>, service:<name>, disk, memory, cpu",
          isError: true,
        };
      }

      const checkDefs = checks.map(buildCheckCommand);

      const results = await this.executor.runOnHosts(
        targets,
        async (connId) => {
          const lines: string[] = [];

          for (const { label, command } of checkDefs) {
            try {
              const output = await this.executor.exec(connId, command);
              const stdout = parseStdout(output);
              lines.push(`[${label}] ${stdout || "OK"}`);
            } catch (err) {
              lines.push(`[${label}] ERROR: ${(err as Error).message}`);
            }
          }

          return lines.join("\n");
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
