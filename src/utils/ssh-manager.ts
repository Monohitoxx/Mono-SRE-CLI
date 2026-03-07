import { Client, type ConnectConfig } from "ssh2";
import type { AuditLogger } from "./audit.js";

export interface SSHConnection {
  id: string;
  host: string;
  username: string;
  password?: string;
  client: Client;
  connectedAt: Date;
  jumpConnectionId?: string;
}

export type SudoGuard = (connectionId: string, command: string) => Promise<boolean>;

const SUDO_TOKEN_RE = /(^|[\s;&|()])sudo(?=\s|$)/;

export class SSHManager {
  private connections = new Map<string, SSHConnection>();
  private tunnelDependents = new Map<string, Set<string>>();
  private timeoutMs = 30000;
  private sudoGuard?: SudoGuard;
  private sudoGuardBypassed = false;
  private audit?: AuditLogger;

  setAuditLogger(audit: AuditLogger) {
    this.audit = audit;
  }

  setTimeout(ms: number) {
    this.timeoutMs = ms;
  }

  setSudoGuard(guard: SudoGuard | undefined) {
    this.sudoGuard = guard;
  }

  /** Skip sudo guard prompts until clearSudoBypass() is called. */
  bypassSudoGuard() {
    this.sudoGuardBypassed = true;
  }

  clearSudoBypass() {
    this.sudoGuardBypassed = false;
  }

  async connect(opts: {
    host: string;
    port?: number;
    username: string;
    password?: string;
    privateKeyPath?: string;
    privateKey?: string;
    sock?: NodeJS.ReadableStream;
    jumpConnectionId?: string;
  }): Promise<string> {
    const id = `${opts.username}@${opts.host}:${opts.port || 22}`;

    if (this.connections.has(id)) {
      return id;
    }

    const client = new Client();

    const connectConfig: ConnectConfig = {
      host: opts.host,
      port: opts.port || 22,
      username: opts.username,
      readyTimeout: this.timeoutMs,
    };

    if (opts.sock) {
      (connectConfig as Record<string, unknown>).sock = opts.sock;
    }

    if (opts.password) {
      connectConfig.password = opts.password;
    } else if (opts.privateKey) {
      connectConfig.privateKey = opts.privateKey;
    } else if (opts.privateKeyPath) {
      const fs = await import("node:fs/promises");
      connectConfig.privateKey = await fs.readFile(opts.privateKeyPath, "utf-8");
    } else {
      const fs = await import("node:fs/promises");
      const os = await import("node:os");
      const path = await import("node:path");
      const defaultKeyPath = path.join(os.default.homedir(), ".ssh", "id_rsa");
      try {
        connectConfig.privateKey = await fs.readFile(defaultKeyPath, "utf-8");
      } catch {
        const ed25519Path = path.join(os.default.homedir(), ".ssh", "id_ed25519");
        try {
          connectConfig.privateKey = await fs.readFile(ed25519Path, "utf-8");
        } catch {
          throw new Error(
            "No authentication method: provide password, privateKey, or ensure ~/.ssh/id_rsa or ~/.ssh/id_ed25519 exists",
          );
        }
      }
    }

    return new Promise<string>((resolve, reject) => {
      client
        .on("ready", () => {
          this.connections.set(id, {
            id,
            host: opts.host,
            username: opts.username,
            password: opts.password,
            client,
            connectedAt: new Date(),
            jumpConnectionId: opts.jumpConnectionId,
          });

          if (opts.jumpConnectionId) {
            if (!this.tunnelDependents.has(opts.jumpConnectionId)) {
              this.tunnelDependents.set(opts.jumpConnectionId, new Set());
            }
            this.tunnelDependents.get(opts.jumpConnectionId)!.add(id);
          }

          this.audit?.log("ssh_connect", {
            connectionId: id,
            host: opts.host,
            username: opts.username,
            ...(opts.jumpConnectionId ? { jumpHost: opts.jumpConnectionId } : {}),
          });
          resolve(id);
        })
        .on("error", (err) => {
          reject(new Error(`SSH connection failed: ${err.message}`));
        })
        .connect(connectConfig);
    });
  }

  async exec(connectionId: string, command: string): Promise<string> {
    const conn = this.connections.get(connectionId);
    if (!conn) {
      throw new Error(`No active SSH connection: ${connectionId}`);
    }

    // Sudo guard: intercept NOPASSWD sudo commands (skip if Layer 2 already approved)
    if (SUDO_TOKEN_RE.test(command)) {
      const cleanCmd = command.replace(SUDO_TOKEN_RE, "$1").trim();
      if (this.sudoGuardBypassed) {
        this.audit?.log("sudo_bypassed", { connectionId, command: cleanCmd, reason: "layer2_approved" });
      } else if (this.sudoGuard) {
        const approved = await this.sudoGuard(connectionId, cleanCmd);
        if (!approved) {
          throw new Error("Sudo execution denied by user.");
        }
      }
    }

    return new Promise<string>((resolve, reject) => {
      conn.client.exec(command, (err, stream) => {
        if (err) {
          reject(new Error(`SSH exec failed: ${err.message}`));
          return;
        }

        let stdout = "";
        let stderr = "";

        stream
          .on("close", (code: number | undefined) => {
            const output = [
              stdout ? `stdout:\n${stdout}` : "",
              stderr ? `stderr:\n${stderr}` : "",
              `exit code: ${code ?? 1}`,
            ]
              .filter(Boolean)
              .join("\n");

            if ((code ?? 1) !== 0) {
              reject(new Error(output || `Command failed with exit code ${code ?? 1}`));
              return;
            }
            resolve(output || "exit code: 0");
          })
          .on("data", (data: Buffer) => {
            stdout += data.toString();
          })
          .stderr.on("data", (data: Buffer) => {
            stderr += data.toString();
          });
      });
    });
  }

  getConnectionPassword(connectionId: string): string | undefined {
    return this.connections.get(connectionId)?.password;
  }

  getConnectionUser(connectionId: string): string | undefined {
    return this.connections.get(connectionId)?.username;
  }

  async execSudo(
    connectionId: string,
    command: string,
    sudoPassword: string,
  ): Promise<string> {
    const conn = this.connections.get(connectionId);
    if (!conn) {
      throw new Error(`No active SSH connection: ${connectionId}`);
    }

    // Sudo guard: second-layer protection (skip if Layer 2 already approved)
    if (this.sudoGuardBypassed) {
      this.audit?.log("sudo_bypassed", { connectionId, command, reason: "layer2_approved" });
    } else if (this.sudoGuard) {
      const approved = await this.sudoGuard(connectionId, command);
      if (!approved) {
        throw new Error("Sudo execution denied by user.");
      }
    }

    const sudoCmd = `sudo -S -p '' ${command}`;

    return new Promise<string>((resolve, reject) => {
      conn.client.exec(sudoCmd, (err, stream) => {
        if (err) {
          reject(new Error(`SSH sudo exec failed: ${err.message}`));
          return;
        }

        stream.write(`${sudoPassword}\n`);

        let stdout = "";
        let stderr = "";

        stream
          .on("close", (code: number | undefined) => {
            const filteredStderr = stderr
              .split("\n")
              .filter((line) => !line.includes("[sudo] password for"))
              .join("\n")
              .trim();

            const output = [
              stdout ? `stdout:\n${stdout}` : "",
              filteredStderr ? `stderr:\n${filteredStderr}` : "",
              `exit code: ${code ?? 1}`,
            ]
              .filter(Boolean)
              .join("\n");
            if ((code ?? 1) !== 0) {
              reject(new Error(output || `Sudo command failed with exit code ${code ?? 1}`));
              return;
            }
            resolve(output || "exit code: 0");
          })
          .on("data", (data: Buffer) => {
            stdout += data.toString();
          })
          .stderr.on("data", (data: Buffer) => {
            stderr += data.toString();
          });
      });
    });
  }

  async createTunnel(
    jumpConnectionId: string,
    targetHost: string,
    targetPort: number,
  ): Promise<NodeJS.ReadableStream> {
    const jumpConn = this.connections.get(jumpConnectionId);
    if (!jumpConn) {
      throw new Error(`Jump host connection not found: ${jumpConnectionId}`);
    }

    return new Promise((resolve, reject) => {
      jumpConn.client.forwardOut(
        "127.0.0.1",
        0,
        targetHost,
        targetPort,
        (err, channel) => {
          if (err) {
            reject(new Error(`Tunnel creation failed via ${jumpConnectionId}: ${err.message}`));
            return;
          }
          resolve(channel as unknown as NodeJS.ReadableStream);
        },
      );
    });
  }

  disconnect(connectionId: string): boolean {
    const conn = this.connections.get(connectionId);
    if (!conn) return false;

    // Cascade: disconnect all targets that depend on this connection
    const dependents = this.tunnelDependents.get(connectionId);
    if (dependents) {
      for (const depId of [...dependents]) {
        this.disconnect(depId);
      }
      this.tunnelDependents.delete(connectionId);
    }

    // Remove self from parent jump host's dependents
    if (conn.jumpConnectionId) {
      const parentDeps = this.tunnelDependents.get(conn.jumpConnectionId);
      if (parentDeps) {
        parentDeps.delete(connectionId);
        if (parentDeps.size === 0) {
          this.tunnelDependents.delete(conn.jumpConnectionId);
        }
      }
    }

    conn.client.end();
    this.connections.delete(connectionId);
    this.audit?.log("ssh_disconnect", { connectionId });
    return true;
  }

  disconnectAll() {
    for (const [id] of this.connections) {
      this.disconnect(id);
    }
  }

  listConnections(): Array<{ id: string; host: string; connectedAt: Date }> {
    return Array.from(this.connections.values()).map((c) => ({
      id: c.id,
      host: c.host,
      connectedAt: c.connectedAt,
    }));
  }

  isConnected(connectionId: string): boolean {
    return this.connections.has(connectionId);
  }
}
