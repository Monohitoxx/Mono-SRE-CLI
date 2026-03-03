import { BaseTool } from "../base.js";
import type { ToolResult } from "../../core/types.js";
import type { SSHManager } from "../../utils/ssh-manager.js";
import { RemoteExecutor } from "./executor.js";
import { assertAbsolutePath, shellQuote } from "./sanitize.js";

export class ReadConfigTool extends BaseTool {
  name = "read_config";
  description =
    "Read a configuration file from one or more remote hosts. " +
    "Returns the file content. Target hosts by name, list, or inventory tags.";
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
        description: "Service name for context (e.g. 'nginx', 'unbound')",
      },
      config_path: {
        type: "string",
        description: "Absolute path to the config file (e.g. '/etc/nginx/nginx.conf')",
      },
    },
    required: ["config_path"],
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

      const configPath = assertAbsolutePath(
        String(args.config_path || ""),
        "config_path",
      );
      const command = `cat -- ${shellQuote(configPath)}`;

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
