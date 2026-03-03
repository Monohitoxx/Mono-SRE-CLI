import type { SSHManager } from "../../utils/ssh-manager.js";
import { resolveTargets, type HostEntry } from "../../config/inventory.js";

export interface HostResult {
  host: string;
  output: string;
  isError: boolean;
}

const SUDO_TOKEN_RE = /(^|[\s;&|()])sudo(?=\s|$)/;

export function detectSudo(command: string | undefined | null): boolean {
  if (!command) return false;
  return SUDO_TOKEN_RE.test(command);
}

function startsWithSudo(command: string): boolean {
  return /^\s*sudo\b/.test(command);
}

function stripLeadingSudo(command: string): string {
  return command.replace(/^\s*sudo\s+(-\S+\s+)*/, "").trim();
}

function hasPermissionError(output: string): boolean {
  const lower = output.toLowerCase();
  return (
    lower.includes("permission denied") ||
    lower.includes("operation not permitted") ||
    lower.includes("access denied") ||
    lower.includes("interactive authentication required") ||
    lower.includes("authentication is required") ||
    lower.includes("must be root") ||
    lower.includes("not in the sudoers")
  );
}

export class RemoteExecutor {
  private sshManager: SSHManager;

  constructor(sshManager: SSHManager) {
    this.sshManager = sshManager;
  }

  /**
   * Resolve host/hosts/tags args into HostEntry[].
   * Throws if no targets found.
   */
  resolve(args: {
    host?: string;
    hosts?: string[];
    tags?: string[];
  }): HostEntry[] {
    const targets = resolveTargets(args);
    if (targets.length === 0) {
      const desc = args.tags
        ? `tags [${args.tags.join(", ")}]`
        : args.hosts
          ? `hosts [${args.hosts.join(", ")}]`
          : `host "${args.host}"`;
      throw new Error(
        `No hosts found matching ${desc}. Use inventory_lookup to check available hosts.`,
      );
    }
    return targets;
  }

  /**
   * Ensure SSH connection to a host, return connectionId.
   * Reuses existing connections via SSHManager.
   */
  async ensureConnected(entry: HostEntry): Promise<string> {
    const { host } = entry;
    const connectionId = `${host.username || "root"}@${host.ip}:${host.port || 22}`;

    if (this.sshManager.isConnected(connectionId)) {
      return connectionId;
    }

    return this.sshManager.connect({
      host: host.ip,
      port: host.port || 22,
      username: host.username || "root",
      password: host.password,
      privateKeyPath: host.privateKeyPath,
    });
  }

  /**
   * Run a function on multiple hosts in parallel (fan-out).
   * Each host failure is caught and returned in HostResult, so one host
   * failing doesn't block others.
   */
  async runOnHosts(
    targets: HostEntry[],
    fn: (connectionId: string, entry: HostEntry) => Promise<string>,
  ): Promise<HostResult[]> {
    const tasks = targets.map(async (entry): Promise<HostResult> => {
      try {
        const connectionId = await this.ensureConnected(entry);
        const output = await fn(connectionId, entry);
        return { host: entry.name, output, isError: false };
      } catch (err) {
        return {
          host: entry.name,
          output: (err as Error).message,
          isError: true,
        };
      }
    });

    return Promise.all(tasks);
  }

  /**
   * Execute a command, handling sudo automatically.
   * If command starts with "sudo", strips the prefix and routes through execSudo.
   * Embedded sudo (e.g. "cmd && sudo x") is blocked to prevent guard bypass.
   */
  async exec(connectionId: string, command: string): Promise<string> {
    const trimmed = command.trim();
    if (!trimmed) {
      throw new Error("Command is empty.");
    }

    if (startsWithSudo(trimmed)) {
      const stripped = stripLeadingSudo(trimmed);
      if (!stripped) {
        throw new Error("Invalid sudo command.");
      }
      return this.execSudo(connectionId, stripped);
    }

    if (detectSudo(trimmed)) {
      throw new Error(
        "Embedded sudo is not allowed. Provide the command without sudo; escalation is handled automatically.",
      );
    }

    return this.sshManager.exec(connectionId, trimmed);
  }

  /**
   * Execute a command with sudo.
   * - If password available: sends password via stdin to `sudo -S`
   * - If no password: uses `sudo <cmd>` directly (works with NOPASSWD sudoers)
   */
  async execSudo(connectionId: string, command: string): Promise<string> {
    const trimmed = command.trim();
    if (!trimmed) {
      throw new Error("Command is empty.");
    }
    if (detectSudo(trimmed)) {
      throw new Error("Do not include sudo inside execSudo command.");
    }

    const password = this.sshManager.getConnectionPassword(connectionId);
    if (password) {
      return this.sshManager.execSudo(connectionId, trimmed, password);
    }
    // No password — try NOPASSWD sudo
    return this.sshManager.exec(connectionId, `sudo ${trimmed}`);
  }

  /**
   * Try command without sudo first, then retry with sudo only on permission errors.
   */
  async execWithSudoFallback(connectionId: string, command: string): Promise<string> {
    try {
      return await this.exec(connectionId, command);
    } catch (err) {
      const msg = (err as Error).message;
      if (!hasPermissionError(msg)) {
        throw err;
      }
      return this.execSudo(connectionId, command);
    }
  }

  /**
   * Format multi-host results into a readable string.
   */
  static formatResults(results: HostResult[]): string {
    if (results.length === 1) {
      const r = results[0];
      const prefix = r.isError ? "[ERROR] " : "";
      return `[${r.host}] ${prefix}${r.output}`;
    }

    const lines: string[] = [];
    const succeeded = results.filter((r) => !r.isError);
    const failed = results.filter((r) => r.isError);

    lines.push(`Executed on ${results.length} host(s): ${succeeded.length} succeeded, ${failed.length} failed\n`);

    for (const r of results) {
      const status = r.isError ? "FAIL" : "OK";
      lines.push(`── [${r.host}] ${status} ──`);
      lines.push(r.output);
      lines.push("");
    }

    return lines.join("\n");
  }
}
