import { BaseTool } from "../base.js";
import type { ToolResult } from "../../core/types.js";
import type { SSHManager } from "../../utils/ssh-manager.js";

export class SSHConnectTool extends BaseTool {
  name = "ssh_connect";
  description =
    "Connect to a remote host via SSH. Returns a connection ID for subsequent commands.";
  parameters = {
    type: "object",
    properties: {
      host: {
        type: "string",
        description: "Hostname or IP address of the remote server",
      },
      port: {
        type: "number",
        description: "SSH port (default: 22)",
      },
      username: {
        type: "string",
        description: "SSH username",
      },
      password: {
        type: "string",
        description: "SSH password (optional if using key auth)",
      },
      privateKeyPath: {
        type: "string",
        description:
          "Path to SSH private key file (optional, defaults to ~/.ssh/id_rsa or ~/.ssh/id_ed25519)",
      },
    },
    required: ["host", "username"],
  };

  private sshManager: SSHManager;

  constructor(sshManager: SSHManager) {
    super();
    this.requiresConfirmation = true;
    this.sshManager = sshManager;
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const connectionId = await this.sshManager.connect({
        host: args.host as string,
        port: args.port as number | undefined,
        username: args.username as string,
        password: args.password as string | undefined,
        privateKeyPath: args.privateKeyPath as string | undefined,
      });
      return {
        toolCallId: "",
        content: `Connected to ${args.host} as ${args.username}. Connection ID: ${connectionId}`,
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
