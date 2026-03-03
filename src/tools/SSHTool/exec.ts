import { BaseTool } from "../base.js";
import type { ToolResult } from "../../core/types.js";
import type { SSHManager } from "../../utils/ssh-manager.js";

export class SSHExecTool extends BaseTool {
  name = "ssh_exec";
  description =
    "Execute a command on a remote host via an existing SSH connection. If the command requires root privileges, include 'sudo' at the start - the password will be handled automatically using the SSH login password. Do NOT manually construct password piping like 'echo pw | sudo -S'.";
  parameters = {
    type: "object",
    properties: {
      connectionId: {
        type: "string",
        description:
          "The SSH connection ID returned by ssh_connect (format: user@host:port)",
      },
      command: {
        type: "string",
        description:
          "The command to execute. Prefix with 'sudo' for root privileges - password handling is automatic.",
      },
    },
    required: ["connectionId", "command"],
  };

  private sshManager: SSHManager;

  constructor(sshManager: SSHManager) {
    super();
    this.requiresConfirmation = true;
    this.sshManager = sshManager;
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const connectionId = args.connectionId as string;
    let command = args.command as string;

    const needsSudo = detectSudo(command);

    if (needsSudo) {
      command = stripSudoPrefix(command);
      this.privilege = "root";

      const password = this.sshManager.getConnectionPassword(connectionId);
      if (!password) {
        return {
          toolCallId: "",
          content:
            "This command requires sudo but no password is available. The SSH connection was established with key authentication. Please ask the user for the sudo password, then reconnect with ssh_connect using the password parameter.",
          isError: true,
        };
      }

      try {
        const output = await this.sshManager.execSudo(
          connectionId,
          command,
          password,
        );
        return { toolCallId: "", content: output };
      } catch (err) {
        return {
          toolCallId: "",
          content: (err as Error).message,
          isError: true,
        };
      }
    }

    try {
      const output = await this.sshManager.exec(connectionId, command);
      return { toolCallId: "", content: output };
    } catch (err) {
      return {
        toolCallId: "",
        content: (err as Error).message,
        isError: true,
      };
    }
  }
}

export function detectSudo(command: string | undefined | null): boolean {
  if (!command) return false;
  const trimmed = command.trim();
  if (trimmed.startsWith("sudo ")) return true;
  if (/echo\s+.*\|\s*sudo\s/.test(trimmed)) return true;
  if (trimmed.includes("| sudo ")) return true;
  return false;
}

function stripSudoPrefix(command: string): string {
  let cmd = command.trim();
  const pipePattern = /^echo\s+.*?\|\s*sudo\s+-S\s+/;
  if (pipePattern.test(cmd)) {
    cmd = cmd.replace(pipePattern, "");
    return cmd;
  }
  cmd = cmd.replace(/^sudo\s+(-\S+\s+)*/, "");
  return cmd;
}
