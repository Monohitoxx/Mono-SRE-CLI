/**
 * Extract the binary name from a command string.
 * Example: "docker ps -a" -> "docker"
 */
export function extractBinary(cmd: string): string {
  const first = cmd.trim().split(/\s+/)[0];
  return first || cmd;
}

export function stripLeadingSudo(cmd: string): string {
  return cmd.trim().replace(/^\s*sudo\s+(-\S+\s+)*/, "").trim();
}

export function isPermissionErrorText(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes("permission denied") ||
    lower.includes("operation not permitted") ||
    lower.includes("access denied") ||
    lower.includes("interactive authentication required") ||
    lower.includes("authentication is required") ||
    lower.includes("must be root") ||
    lower.includes("not in the sudoers") ||
    lower.includes("superuser privileges") ||
    lower.includes("run as root") ||
    lower.includes("requires root")
  );
}

export function isManagedSystemctlMutatingCommand(command: string): boolean {
  return /\bsystemctl\s+(start|stop|restart|reload|enable|disable|mask|unmask|daemon-reload|edit)\b/.test(
    command,
  );
}
