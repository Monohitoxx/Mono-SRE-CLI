import { BaseTool } from "../base.js";
import type { ToolResult } from "../../core/types.js";
import type { SSHManager } from "../../utils/ssh-manager.js";
import { RemoteExecutor } from "./executor.js";
import { assertServiceName, parseStdout, shellQuote } from "./sanitize.js";

const VALID_ACTIONS = new Set([
  "start",
  "stop",
  "restart",
  "reload",
  "status",
  "enable",
  "disable",
]);

const READ_ONLY_ACTIONS = new Set(["status"]);

export class ServiceControlTool extends BaseTool {
  name = "service_control";
  description =
    "Control a systemd service (systemctl) on one or more remote hosts. " +
    "ONLY for systemd unit files — NOT for Docker containers, Kubernetes pods, or Podman containers. " +
    "To manage containers, use execute_command with docker/podman/kubectl instead. " +
    "Supports start, stop, restart, reload, status, enable, disable. " +
    "Target hosts by name, list, or inventory tags.";
  parameters = {
    type: "object",
    properties: {
      host: {
        type: "string",
        description: "Single host name from inventory (e.g. 'hk01')",
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
      service: {
        type: "string",
        description: "Service name (e.g. 'nginx', 'unbound', 'dnsdist')",
      },
      action: {
        type: "string",
        enum: ["start", "stop", "restart", "reload", "status", "enable", "disable"],
        description: "Action to perform on the service",
      },
    },
    required: ["service", "action"],
  };

  private executor: RemoteExecutor;

  constructor(sshManager: SSHManager) {
    super();
    this.requiresConfirmation = true;
    this.executor = new RemoteExecutor(sshManager);
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const action = args.action as string;

    if (!VALID_ACTIONS.has(action)) {
      return {
        toolCallId: "",
        content: `Invalid action "${action}". Valid actions: ${[...VALID_ACTIONS].join(", ")}`,
        isError: true,
      };
    }

    try {
      const service = assertServiceName(String(args.service || ""));
      const targets = this.executor.resolve(args as {
        host?: string;
        hosts?: string[];
        tags?: string[];
      });

      // Pre-flight: verify the service exists as a systemd unit on the first target
      const checkConnId = await this.executor.ensureConnected(targets[0]);
      const unit = service.endsWith(".service") ? service : `${service}.service`;
      let loadState = "";
      try {
        const checkOutput = await this.executor.exec(
          checkConnId,
          `systemctl show --property=LoadState --value -- ${shellQuote(unit)}`,
        );
        loadState = parseStdout(checkOutput).toLowerCase();
      } catch {
        loadState = "not-found";
      }
      if (!loadState || loadState === "not-found") {
        return {
          toolCallId: "",
          content:
            `"${service}" is not a systemd service. ` +
            `If this is a Docker container, Kubernetes pod, or other non-systemd process, ` +
            `use execute_command with the appropriate CLI (docker, kubectl, podman, etc.) instead.`,
          isError: true,
        };
      }

      const command = `systemctl ${action} -- ${shellQuote(unit)}`;

      const results = await this.executor.runOnHosts(
        targets,
        async (connId) => {
          if (READ_ONLY_ACTIONS.has(action)) {
            return this.executor.exec(connId, command);
          }
          return this.executor.execWithSudoFallback(connId, command);
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

export { READ_ONLY_ACTIONS };
