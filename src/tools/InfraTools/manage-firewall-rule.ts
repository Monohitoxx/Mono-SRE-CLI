import { BaseTool } from "../base.js";
import type { ToolResult } from "../../core/types.js";
import type { SSHManager } from "../../utils/ssh-manager.js";
import { RemoteExecutor } from "../RemoteTools/executor.js";
import { shellQuote } from "../RemoteTools/sanitize.js";

const VALID_ACTIONS = new Set(["allow", "deny", "delete", "status"]);
const READ_ONLY_ACTIONS = new Set(["status"]);

export class ManageFirewallRuleTool extends BaseTool {
  name = "manage_firewall_rule";
  description =
    "Manage UFW firewall rules on remote host(s). " +
    "Actions: allow (open a port/rule), deny (block a port/rule), delete (remove a rule), status (show current rules). " +
    "Requires an approved plan for mutating actions. " +
    "Target hosts by name, list, or inventory tags.";
  parameters = {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["allow", "deny", "delete", "status"],
        description: "Firewall action to perform",
      },
      rule: {
        type: "string",
        description:
          "Firewall rule specification (e.g. '80/tcp', '443', '22/tcp from 10.0.0.0/8'). Not required for 'status' action.",
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
    required: ["action"],
  };

  private executor: RemoteExecutor;

  constructor(sshManager: SSHManager) {
    super();
    this.requiresConfirmation = true;
    this.executor = new RemoteExecutor(sshManager);
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const action = String(args.action || "").trim();
      if (!VALID_ACTIONS.has(action)) {
        return {
          toolCallId: "",
          content: `Invalid action "${action}". Valid actions: ${[...VALID_ACTIONS].join(", ")}`,
          isError: true,
        };
      }

      const rule = typeof args.rule === "string" ? args.rule.trim() : "";

      if (!READ_ONLY_ACTIONS.has(action) && !rule) {
        return {
          toolCallId: "",
          content: `A rule is required for action "${action}". Example: "80/tcp", "443", "22/tcp from 10.0.0.0/8"`,
          isError: true,
        };
      }

      // Validate rule doesn't contain shell injection
      if (rule && /[;&|`$(){}]/.test(rule)) {
        return {
          toolCallId: "",
          content: "Invalid characters in rule. Only port numbers, protocols, IP ranges, and 'from'/'to' keywords are allowed.",
          isError: true,
        };
      }

      const targets = this.executor.resolve(args as {
        host?: string;
        hosts?: string[];
        tags?: string[];
      });

      let command: string;
      if (action === "status") {
        command = "ufw status numbered";
      } else if (action === "delete") {
        command = `ufw delete ${rule}`;
      } else {
        command = `ufw ${action} ${rule}`;
      }

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
