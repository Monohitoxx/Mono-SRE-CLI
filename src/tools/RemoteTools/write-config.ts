import { BaseTool } from "../base.js";
import type { ToolResult } from "../../core/types.js";
import type { SSHManager } from "../../utils/ssh-manager.js";
import { RemoteExecutor } from "./executor.js";
import { assertAbsolutePath, shellQuote } from "./sanitize.js";

export class WriteConfigTool extends BaseTool {
  name = "write_config";
  description =
    "Write configuration content to a file on one or more remote hosts. " +
    "Optionally creates a backup of the original file before writing. " +
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
      service: {
        type: "string",
        description: "Service name for context (e.g. 'nginx', 'unbound')",
      },
      config_path: {
        type: "string",
        description: "Absolute path to the config file",
      },
      content: {
        type: "string",
        description: "The full content to write to the config file",
      },
      backup: {
        type: "boolean",
        description: "Create a .bak backup before writing (default: true)",
      },
    },
    required: ["config_path", "content"],
  };

  private executor: RemoteExecutor;

  constructor(sshManager: SSHManager) {
    super();
    this.requiresConfirmation = true;
    this.privilege = "elevated";
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
      const content = String(args.content ?? "");
      const backup = args.backup !== false; // default true
      const backupPath = `${configPath}.bak`;

      const encoded = Buffer.from(content, "utf-8").toString("base64");
      const writeScript = `printf %s ${shellQuote(encoded)} | base64 --decode > ${shellQuote(configPath)}`;
      const writeCmd = `bash -lc ${shellQuote(writeScript)}`;

      const results = await this.executor.runOnHosts(
        targets,
        async (connId) => {
          const steps: string[] = [];

          // Backup if requested
          if (backup) {
            try {
              await this.executor.execWithSudoFallback(
                connId,
                `cp -- ${shellQuote(configPath)} ${shellQuote(backupPath)}`,
              );
              steps.push(`Backup created: ${backupPath}`);
            } catch {
              steps.push(`Warning: could not create backup (file may not exist yet)`);
            }
          }

          await this.executor.execWithSudoFallback(connId, writeCmd);
          steps.push(`Written ${content.length} bytes to ${configPath}`);

          return steps.join("\n");
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
