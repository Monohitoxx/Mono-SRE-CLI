import { BaseTool } from "../base.js";
import type { ToolResult } from "../../core/types.js";
import type { SSHManager } from "../../utils/ssh-manager.js";
import { RemoteExecutor } from "../RemoteTools/executor.js";
import { assertAbsolutePath, shellQuote } from "../RemoteTools/sanitize.js";

export class CheckDiskUsageTool extends BaseTool {
  name = "check_disk_usage";
  description =
    "Check disk usage for a specific path on remote host(s). " +
    "Returns both the filesystem-level usage (df) and directory-level usage (du) for the given path. " +
    "Target hosts by name, list, or inventory tags.";
  parameters = {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Absolute path to check (e.g. '/var/log', '/home', '/')",
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
    required: ["path"],
  };

  private executor: RemoteExecutor;

  constructor(sshManager: SSHManager) {
    super();
    this.executor = new RemoteExecutor(sshManager);
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const targetPath = assertAbsolutePath(String(args.path || ""), "path");
      const targets = this.executor.resolve(args as {
        host?: string;
        hosts?: string[];
        tags?: string[];
      });

      const quoted = shellQuote(targetPath);

      const results = await this.executor.runOnHosts(
        targets,
        async (connId) => {
          const sections: string[] = [];

          // Filesystem usage
          try {
            const df = await this.executor.exec(connId, `df -h ${quoted}`);
            sections.push(`[Filesystem]\n${df}`);
          } catch (err) {
            sections.push(`[Filesystem] ERROR: ${(err as Error).message}`);
          }

          // Directory usage (top-level, max depth 1)
          try {
            const du = await this.executor.exec(
              connId,
              `du -h --max-depth=1 ${quoted} 2>/dev/null | sort -rh | head -15`,
            );
            sections.push(`[Directory Usage]\n${du}`);
          } catch (err) {
            sections.push(`[Directory Usage] ERROR: ${(err as Error).message}`);
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
