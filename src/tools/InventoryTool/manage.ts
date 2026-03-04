import { BaseTool } from "../base.js";
import type { ToolResult } from "../../core/types.js";
import { addHost, removeHost, type Host } from "../../config/inventory.js";

export class InventoryAddTool extends BaseTool {
  name = "inventory_add";
  description = `Add or update a host in the machine inventory. After adding, the host becomes available for all remote tools (execute_command, read_config, write_config, service_control, run_healthcheck).

Use this when a user provides server details (IP, username, password) and you need to register it for remote operations. The host name is a friendly alias used for targeting.

If a host with the same name already exists, it will be updated with the new details.`;

  parameters = {
    type: "object",
    properties: {
      name: {
        type: "string",
        description:
          'Friendly name / alias for the host (e.g. "web01", "prod-db")',
      },
      ip: {
        type: "string",
        description: "IP address or hostname of the server",
      },
      username: {
        type: "string",
        description: "SSH username",
      },
      password: {
        type: "string",
        description: "SSH password (if using password auth)",
      },
      port: {
        type: "number",
        description: "SSH port (default: 22)",
      },
      private_key_path: {
        type: "string",
        description: "Path to SSH private key (if using key auth)",
      },
      role: {
        type: "string",
        description:
          'Server role (e.g. "web", "db", "cache", "monitoring")',
      },
      tags: {
        type: "array",
        items: { type: "string" },
        description:
          'Tags for grouping (e.g. ["prod", "hk", "docker"])',
      },
      services: {
        type: "array",
        items: { type: "string" },
        description:
          'Known services running on this host (e.g. ["nginx", "docker", "redis"])',
      },
    },
    required: ["name", "ip", "username"],
  };

  constructor() {
    super();
    this.requiresConfirmation = true;
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const name = (args.name as string).trim();
    const ip = (args.ip as string).trim();
    const username = (args.username as string).trim();

    if (!name || !ip || !username) {
      return {
        toolCallId: "",
        content: "name, ip, and username are required.",
        isError: true,
      };
    }

    const host: Host = {
      ip,
      port: typeof args.port === "number" ? args.port : 22,
      username,
      password: typeof args.password === "string" ? args.password : undefined,
      privateKeyPath:
        typeof args.private_key_path === "string"
          ? args.private_key_path
          : undefined,
      role: typeof args.role === "string" ? args.role : undefined,
      tags: Array.isArray(args.tags)
        ? (args.tags as string[])
        : [],
      services: Array.isArray(args.services)
        ? (args.services as string[])
        : [],
    };

    const result = addHost(name, host);
    return {
      toolCallId: "",
      content: `${result} You can now use remote tools with host="${name}".`,
    };
  }
}

export class InventoryRemoveTool extends BaseTool {
  name = "inventory_remove";
  description =
    "Remove a host from the machine inventory. The host will no longer be available for remote operations.";

  parameters = {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Name of the host to remove",
      },
    },
    required: ["name"],
  };

  constructor() {
    super();
    this.requiresConfirmation = true;
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const name = (args.name as string).trim();
    const result = removeHost(name);
    return { toolCallId: "", content: result };
  }
}
