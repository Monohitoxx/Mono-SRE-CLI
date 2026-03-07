/**
 * RDP + PuTTY automation manager.
 *
 * Workflow:
 *   1. Launch xfreerdp with an .rdp file (or manual host/port)
 *   2. Wait for the RDP window to appear
 *   3. Locate the PuTTY window inside the RDP session
 *   4. Send keystrokes to PuTTY via xdotool
 *
 * Requirements on the host running Mono CLI:
 *   - xfreerdp (FreeRDP client)
 *   - xdotool  (X11 keyboard/mouse automation)
 *   - An X11 display (DISPLAY env var must be set)
 */

import { spawn, exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import type { ChildProcess } from "node:child_process";
import type { RdpConfig } from "./rdp-parser.js";

const exec = promisify(execCb);

export interface RdpSessionInfo {
  /** xfreerdp process */
  process: ChildProcess;
  /** X11 window ID of the RDP session */
  windowId: string;
  /** PID of the xfreerdp process */
  pid: number;
  /** Connection target for display */
  target: string;
}

export interface RdpConnectOptions {
  /** Path to .rdp file */
  rdpFile?: string;
  /** Or manual connection params */
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  domain?: string;
  /** Parsed RDP config (if rdpFile was pre-parsed) */
  rdpConfig?: RdpConfig;
  /** Full-screen mode (default: true for PuTTY workflow) */
  fullScreen?: boolean;
  /** Window title pattern to match (default: auto-detect) */
  windowTitle?: string;
  /** Seconds to wait for RDP window to appear (default: 30) */
  connectTimeout?: number;
  /** Extra xfreerdp flags */
  extraFlags?: string[];
}

export interface SendCommandOptions {
  /** Delay in ms between keystrokes (default: 50) */
  keystrokeDelay?: number;
  /** Whether to press Enter after the command (default: true) */
  pressEnter?: boolean;
  /** Wait time in ms after sending (default: 500) */
  postDelay?: number;
}

/**
 * Check that required system tools are available.
 */
export async function checkDependencies(): Promise<{ ok: boolean; missing: string[] }> {
  const tools = ["xfreerdp", "xdotool"];
  const missing: string[] = [];

  for (const tool of tools) {
    try {
      await exec(`which ${tool}`);
    } catch {
      missing.push(tool);
    }
  }

  if (!process.env.DISPLAY) {
    missing.push("DISPLAY (X11 environment variable)");
  }

  return { ok: missing.length === 0, missing };
}

/**
 * Build xfreerdp command arguments.
 */
function buildFreerdpArgs(opts: RdpConnectOptions): string[] {
  const args: string[] = [];

  if (opts.rdpFile) {
    args.push(opts.rdpFile);
  } else {
    const host = opts.host ?? opts.rdpConfig?.address ?? "";
    const port = opts.port ?? opts.rdpConfig?.port ?? 3389;
    args.push(`/v:${host}:${port}`);
  }

  const username = opts.username ?? opts.rdpConfig?.username;
  if (username) args.push(`/u:${username}`);

  const domain = opts.domain ?? opts.rdpConfig?.domain;
  if (domain) args.push(`/d:${domain}`);

  if (opts.password) args.push(`/p:${opts.password}`);

  const fullScreen = opts.fullScreen ?? true;
  if (fullScreen) {
    args.push("/f");
  } else {
    const w = opts.rdpConfig?.desktopWidth ?? 1920;
    const h = opts.rdpConfig?.desktopHeight ?? 1080;
    args.push(`/w:${w}`, `/h:${h}`);
  }

  // Security & UX flags
  args.push(
    "/cert:ignore",          // Accept self-signed certs (common in PAM setups)
    "+clipboard",            // Enable clipboard sharing
    "/dynamic-resolution",   // Adapt to window resizing
  );

  if (opts.extraFlags) {
    args.push(...opts.extraFlags);
  }

  return args;
}

/**
 * Launch xfreerdp and wait for the RDP window to appear.
 */
export async function connectRdp(opts: RdpConnectOptions): Promise<RdpSessionInfo> {
  const depCheck = await checkDependencies();
  if (!depCheck.ok) {
    throw new Error(
      `Missing dependencies: ${depCheck.missing.join(", ")}.\n` +
      "Install with: sudo apt install freerdp2-x11 xdotool"
    );
  }

  const args = buildFreerdpArgs(opts);
  const target = opts.host ?? opts.rdpConfig?.address ?? opts.rdpFile ?? "unknown";

  const child = spawn("xfreerdp", args, {
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  if (!child.pid) {
    throw new Error("Failed to launch xfreerdp process");
  }

  // Collect stderr for error reporting
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  const timeout = (opts.connectTimeout ?? 30) * 1000;
  const windowId = await waitForRdpWindow(child, target, timeout, stderr);

  return {
    process: child,
    windowId,
    pid: child.pid,
    target,
  };
}

/**
 * Wait for the xfreerdp window to appear using xdotool.
 */
async function waitForRdpWindow(
  child: ChildProcess,
  target: string,
  timeoutMs: number,
  stderrRef: string,
): Promise<string> {
  const start = Date.now();
  const pollInterval = 1000;

  // Multiple patterns to search for the FreeRDP window
  const searchPatterns = [
    "FreeRDP",
    "xfreerdp",
    target,
  ];

  while (Date.now() - start < timeoutMs) {
    // Check if process died
    if (child.exitCode !== null) {
      throw new Error(
        `xfreerdp exited with code ${child.exitCode}.\n${stderrRef.slice(0, 500)}`
      );
    }

    for (const pattern of searchPatterns) {
      try {
        const { stdout } = await exec(
          `xdotool search --name "${pattern}" 2>/dev/null | head -1`
        );
        const wid = stdout.trim();
        if (wid) return wid;
      } catch {
        // Window not found yet
      }
    }

    await sleep(pollInterval);
  }

  throw new Error(
    `Timeout waiting for RDP window after ${timeoutMs / 1000}s. ` +
    "Ensure xfreerdp can connect to the target."
  );
}

/**
 * Focus the RDP window by its X11 window ID.
 */
export async function focusWindow(windowId: string): Promise<void> {
  await exec(`xdotool windowactivate --sync ${windowId}`);
  await sleep(300);
}

/**
 * Send a text string to the currently focused window using xdotool.
 * This types the string character-by-character.
 */
export async function sendText(
  windowId: string,
  text: string,
  opts: SendCommandOptions = {},
): Promise<void> {
  const delay = opts.keystrokeDelay ?? 50;

  await focusWindow(windowId);

  // xdotool type handles special characters well
  await exec(
    `xdotool type --window ${windowId} --delay ${delay} -- ${escapeShellArg(text)}`
  );

  if (opts.pressEnter !== false) {
    await sleep(100);
    await exec(`xdotool key --window ${windowId} Return`);
  }

  if (opts.postDelay) {
    await sleep(opts.postDelay);
  }
}

/**
 * Send a special key combination (e.g., ctrl+c, alt+F4).
 */
export async function sendKey(windowId: string, key: string): Promise<void> {
  await focusWindow(windowId);
  await exec(`xdotool key --window ${windowId} ${key}`);
}

/**
 * Send a command to PuTTY inside the RDP session.
 * This is the main function for executing commands through the PAM workflow.
 *
 * The approach:
 *   1. Focus the RDP window (which contains PuTTY)
 *   2. Type the command using xdotool
 *   3. Press Enter
 *
 * Since PuTTY is full-screen inside the RDP session,
 * all keystrokes to the RDP window go directly to PuTTY.
 */
export async function sendCommandToPutty(
  session: RdpSessionInfo,
  command: string,
  opts: SendCommandOptions = {},
): Promise<string> {
  await sendText(session.windowId, command, {
    keystrokeDelay: opts.keystrokeDelay ?? 50,
    pressEnter: opts.pressEnter ?? true,
    postDelay: opts.postDelay ?? 500,
  });

  return `Command sent to PuTTY via RDP session [${session.target}]: ${command}`;
}

/**
 * Try to capture PuTTY screen content by selecting all text.
 * This uses Ctrl+A (PuTTY select-all) → clipboard → xclip to read.
 */
export async function capturePuttyScreen(session: RdpSessionInfo): Promise<string> {
  try {
    // Try reading clipboard content that may have been shared via RDP clipboard
    const { stdout } = await exec("xclip -selection clipboard -o 2>/dev/null || xsel --clipboard --output 2>/dev/null || echo '[clipboard unavailable]'");
    return stdout.trim();
  } catch {
    return "[Unable to capture screen content — clipboard sharing may not be available]";
  }
}

/**
 * Disconnect the RDP session.
 */
export function disconnectRdp(session: RdpSessionInfo): void {
  try {
    session.process.kill("SIGTERM");
  } catch {
    // Process may already be dead
  }
}

/**
 * List active RDP-related windows.
 */
export async function listRdpWindows(): Promise<Array<{ windowId: string; title: string }>> {
  try {
    const { stdout } = await exec(
      `xdotool search --name "FreeRDP\\|xfreerdp" 2>/dev/null || true`
    );
    const windowIds = stdout.trim().split("\n").filter(Boolean);
    const results: Array<{ windowId: string; title: string }> = [];

    for (const wid of windowIds) {
      try {
        const { stdout: title } = await exec(`xdotool getwindowname ${wid}`);
        results.push({ windowId: wid, title: title.trim() });
      } catch {
        results.push({ windowId: wid, title: "(unknown)" });
      }
    }

    return results;
  } catch {
    return [];
  }
}

function escapeShellArg(arg: string): string {
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
