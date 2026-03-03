import { BaseTool } from "../base.js";
import type { ToolResult } from "../../core/types.js";
import type { SSHManager } from "../../utils/ssh-manager.js";

export class SSHDisconnectTool extends BaseTool {
  name = "ssh_disconnect";
  description = "Disconnect from a remote SSH session.";
  parameters = {
    type: "object",
    properties: {
      connectionId: {
        type: "string",
        description: "The SSH connection ID to disconnect",
      },
    },
    required: ["connectionId"],
  };

  private sshManager: SSHManager;

  constructor(sshManager: SSHManager) {
    super();
    this.sshManager = sshManager;
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const disconnected = this.sshManager.disconnect(
      args.connectionId as string,
    );
    return {
      toolCallId: "",
      content: disconnected
        ? `Disconnected from ${args.connectionId}`
        : `No active connection: ${args.connectionId}`,
      isError: !disconnected,
    };
  }
}
