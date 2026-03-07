import { BaseTool } from "../base.js";
import type { ToolResult } from "../../core/types.js";
import { activeSessions } from "./rdp-connect.js";
import {
  sendCommandToPutty,
  sendKey,
  capturePuttyScreen,
  focusWindow,
  type SendCommandOptions,
} from "../../utils/rdp-putty-manager.js";

export class PuttyCommandTool extends BaseTool {
  name = "putty_command";
  description =
    "Send a command to a PuTTY terminal running inside an RDP session. " +
    "Use rdp_connect first to establish the RDP session, then use this tool to " +
    "type commands into PuTTY for troubleshooting. " +
    "The command is sent as keystrokes — PuTTY receives it as if a human typed it. " +
    "NOTE: Output capture is best-effort via clipboard; for reliable output, " +
    "redirect command output to a file and read it back via the PuTTY session.";
  parameters = {
    type: "object",
    properties: {
      session: {
        type: "string",
        description:
          "The session name used when connecting with rdp_connect. " +
          "Use rdp_list_sessions to see active sessions.",
      },
      command: {
        type: "string",
        description:
          "The command to type into PuTTY. Will be followed by Enter key by default.",
      },
      special_key: {
        type: "string",
        description:
          "Send a special key instead of a command. " +
          "Examples: 'ctrl+c' (interrupt), 'ctrl+d' (EOF), 'ctrl+z' (suspend), " +
          "'ctrl+l' (clear screen), 'Up' (previous command), 'Tab' (autocomplete), " +
          "'ctrl+a' (beginning of line), 'ctrl+e' (end of line).",
      },
      keystroke_delay: {
        type: "number",
        description: "Milliseconds between keystrokes (default: 50). Increase for slow connections.",
      },
      no_enter: {
        type: "boolean",
        description: "If true, do not press Enter after the command (default: false).",
      },
      capture_output: {
        type: "boolean",
        description:
          "Attempt to capture PuTTY screen content via clipboard (default: false). " +
          "This is best-effort and may not always work.",
      },
    },
    required: ["session"],
  };

  constructor() {
    super();
    this.requiresConfirmation = true;
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const sessionName = args.session as string;
    const command = args.command as string | undefined;
    const specialKey = args.special_key as string | undefined;
    const captureOutput = args.capture_output as boolean | undefined;

    if (!command && !specialKey) {
      return {
        toolCallId: "",
        content: "Either 'command' or 'special_key' must be provided.",
        isError: true,
      };
    }

    const session = activeSessions.get(sessionName);
    if (!session) {
      const available = Array.from(activeSessions.keys());
      return {
        toolCallId: "",
        content:
          `No active RDP session named "${sessionName}".\n` +
          (available.length > 0
            ? `Active sessions: ${available.join(", ")}`
            : "No active sessions. Use rdp_connect first."),
        isError: true,
      };
    }

    // Check if the process is still alive
    if (session.process.exitCode !== null) {
      activeSessions.delete(sessionName);
      return {
        toolCallId: "",
        content:
          `RDP session "${sessionName}" has disconnected (exit code: ${session.process.exitCode}). ` +
          "Use rdp_connect to reconnect.",
        isError: true,
      };
    }

    try {
      const lines: string[] = [];

      if (specialKey) {
        await focusWindow(session.windowId);
        await sendKey(session.windowId, specialKey);
        lines.push(`Sent key [${specialKey}] to PuTTY session "${sessionName}".`);
      }

      if (command) {
        const opts: SendCommandOptions = {
          keystrokeDelay: args.keystroke_delay as number | undefined,
          pressEnter: !(args.no_enter as boolean),
          postDelay: 500,
        };
        const result = await sendCommandToPutty(session, command, opts);
        lines.push(result);
      }

      if (captureOutput) {
        // Wait a bit for command to produce output
        await new Promise((r) => setTimeout(r, 1000));
        const screen = await capturePuttyScreen(session);
        lines.push("", "--- Captured output (best-effort) ---", screen);
      }

      return {
        toolCallId: "",
        content: lines.join("\n"),
        isError: false,
      };
    } catch (err) {
      return {
        toolCallId: "",
        content: `Failed to send command to PuTTY: ${(err as Error).message}`,
        isError: true,
      };
    }
  }
}
