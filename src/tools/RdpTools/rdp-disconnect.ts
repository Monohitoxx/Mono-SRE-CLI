import { BaseTool } from "../base.js";
import type { ToolResult } from "../../core/types.js";
import { activeSessions } from "./rdp-connect.js";
import { disconnectRdp, listRdpWindows } from "../../utils/rdp-putty-manager.js";

export class RdpDisconnectTool extends BaseTool {
  name = "rdp_disconnect";
  description =
    "Disconnect an active RDP session or list all active sessions. " +
    "Use session='*' to disconnect all sessions.";
  parameters = {
    type: "object",
    properties: {
      session: {
        type: "string",
        description:
          "The session name to disconnect. Use '*' to disconnect all sessions. " +
          "Omit to list active sessions without disconnecting.",
      },
    },
    required: [],
  };

  constructor() {
    super();
    this.requiresConfirmation = true;
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const sessionName = args.session as string | undefined;

    // List mode — no session specified
    if (!sessionName) {
      const lines = ["Active RDP sessions:"];
      if (activeSessions.size === 0) {
        lines.push("  (none)");
      } else {
        for (const [name, session] of activeSessions) {
          const alive = session.process.exitCode === null;
          lines.push(
            `  ${name}: target=${session.target}, pid=${session.pid}, ` +
            `windowId=${session.windowId}, status=${alive ? "connected" : "disconnected"}`
          );
        }
      }

      // Also list any RDP windows we can find via xdotool
      const windows = await listRdpWindows();
      if (windows.length > 0) {
        lines.push("", "Detected RDP windows (X11):");
        for (const w of windows) {
          lines.push(`  windowId=${w.windowId}, title="${w.title}"`);
        }
      }

      return { toolCallId: "", content: lines.join("\n"), isError: false };
    }

    // Disconnect all
    if (sessionName === "*") {
      const count = activeSessions.size;
      for (const [name, session] of activeSessions) {
        disconnectRdp(session);
        activeSessions.delete(name);
      }
      return {
        toolCallId: "",
        content: `Disconnected ${count} RDP session(s).`,
        isError: false,
      };
    }

    // Disconnect specific session
    const session = activeSessions.get(sessionName);
    if (!session) {
      return {
        toolCallId: "",
        content: `No active session named "${sessionName}". Active: ${Array.from(activeSessions.keys()).join(", ") || "(none)"}`,
        isError: true,
      };
    }

    disconnectRdp(session);
    activeSessions.delete(sessionName);

    return {
      toolCallId: "",
      content: `RDP session "${sessionName}" disconnected.`,
      isError: false,
    };
  }
}
