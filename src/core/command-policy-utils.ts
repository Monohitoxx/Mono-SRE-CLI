/**
 * Extract the binary key from a command string for sudo escalation tracking.
 * For commands with subcommands (docker, kubectl, systemctl, etc.),
 * includes the subcommand so that e.g. "docker ps" permission errors
 * don't auto-escalate "docker rm".
 * Example: "docker ps -a" -> "docker:ps", "ls -la" -> "ls"
 */
const MULTI_SUBCOMMAND_BINARIES = new Set([
  "docker", "kubectl", "helm", "systemctl", "service",
  "apt", "apt-get", "dnf", "yum", "apk", "pip", "pip3", "npm",
  "ip", "nmcli", "ufw", "iptables", "firewall-cmd",
]);

export function extractBinary(cmd: string): string {
  const tokens = cmd.trim().split(/\s+/);
  const binary = tokens[0] || cmd;
  if (MULTI_SUBCOMMAND_BINARIES.has(binary) && tokens.length > 1) {
    const sub = tokens[1];
    // Skip flags like -v, --help as subcommands
    if (sub && !sub.startsWith("-")) {
      return `${binary}:${sub}`;
    }
  }
  return binary;
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
