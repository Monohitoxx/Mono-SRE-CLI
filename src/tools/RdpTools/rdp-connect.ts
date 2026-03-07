import { BaseTool } from "../base.js";
import type { ToolResult } from "../../core/types.js";
import { parseRdpFile } from "../../utils/rdp-parser.js";
import {
  connectRdp,
  checkDependencies,
  type RdpSessionInfo,
} from "../../utils/rdp-putty-manager.js";

/**
 * Shared session store — keeps track of active RDP sessions
 * so other tools (like putty_command) can reference them.
 */
export const activeSessions = new Map<string, RdpSessionInfo>();

export class RdpConnectTool extends BaseTool {
  name = "rdp_connect";
  description =
    "Open an RDP connection, typically from a PAM system (e.g. CyberArk) .rdp file. " +
    "After connecting, the RDP window will appear and you can use putty_command to send " +
    "commands to the PuTTY session inside the RDP window. " +
    "Requires xfreerdp and xdotool on the local machine.";
  parameters = {
    type: "object",
    properties: {
      rdp_file: {
        type: "string",
        description:
          "Path to an .rdp file (e.g. downloaded from CyberArk). " +
          "If provided, connection settings are extracted from the file.",
      },
      host: {
        type: "string",
        description: "RDP host address (used if rdp_file is not provided).",
      },
      port: {
        type: "number",
        description: "RDP port (default: 3389).",
      },
      username: {
        type: "string",
        description: "Username for RDP login (overrides .rdp file setting).",
      },
      password: {
        type: "string",
        description: "Password for RDP login.",
      },
      domain: {
        type: "string",
        description: "Windows domain (overrides .rdp file setting).",
      },
      full_screen: {
        type: "boolean",
        description: "Launch in full-screen mode (default: true).",
      },
      session_name: {
        type: "string",
        description:
          "A label for this session so you can reference it later in putty_command. " +
          "Defaults to the host address.",
      },
      connect_timeout: {
        type: "number",
        description: "Seconds to wait for the RDP window to appear (default: 30).",
      },
    },
    required: [],
  };

  constructor() {
    super();
    this.requiresConfirmation = true;
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      // Pre-flight: check dependencies
      const depCheck = await checkDependencies();
      if (!depCheck.ok) {
        return {
          toolCallId: "",
          content:
            `Cannot open RDP — missing dependencies: ${depCheck.missing.join(", ")}.\n\n` +
            "To install on Debian/Ubuntu:\n" +
            "  sudo apt install freerdp2-x11 xdotool\n\n" +
            "To install on RHEL/CentOS:\n" +
            "  sudo yum install freerdp xdotool\n\n" +
            "Also ensure you have an X11 display (DISPLAY env var must be set).",
          isError: true,
        };
      }

      const rdpFile = args.rdp_file as string | undefined;
      const rdpConfig = rdpFile ? await parseRdpFile(rdpFile) : undefined;

      const session = await connectRdp({
        rdpFile,
        rdpConfig,
        host: args.host as string | undefined,
        port: args.port as number | undefined,
        username: args.username as string | undefined,
        password: args.password as string | undefined,
        domain: args.domain as string | undefined,
        fullScreen: (args.full_screen as boolean | undefined) ?? true,
        connectTimeout: args.connect_timeout as number | undefined,
      });

      const sessionName =
        (args.session_name as string) ??
        (args.host as string) ??
        rdpConfig?.address ??
        `rdp-${session.pid}`;

      activeSessions.set(sessionName, session);

      const lines = [
        `RDP session connected successfully.`,
        `  Session name : ${sessionName}`,
        `  Target       : ${session.target}`,
        `  Window ID    : ${session.windowId}`,
        `  PID          : ${session.pid}`,
      ];

      if (rdpConfig) {
        lines.push(
          `  RDP file     : ${rdpFile}`,
          `  Address      : ${rdpConfig.address}:${rdpConfig.port}`,
          rdpConfig.gatewayHostname
            ? `  Gateway      : ${rdpConfig.gatewayHostname}`
            : "",
        );
      }

      lines.push(
        "",
        "You can now use putty_command to send commands to the PuTTY session inside this RDP window.",
        `Example: putty_command(session="${sessionName}", command="hostname")`,
      );

      return {
        toolCallId: "",
        content: lines.filter(Boolean).join("\n"),
        isError: false,
      };
    } catch (err) {
      return {
        toolCallId: "",
        content: `Failed to connect RDP: ${(err as Error).message}`,
        isError: true,
      };
    }
  }
}
