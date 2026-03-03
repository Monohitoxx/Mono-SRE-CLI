import { Client, type ConnectConfig } from "ssh2";

export interface SSHConnection {
  id: string;
  host: string;
  username: string;
  password?: string;
  client: Client;
  connectedAt: Date;
}

export class SSHManager {
  private connections = new Map<string, SSHConnection>();
  private timeoutMs = 30000;

  setTimeout(ms: number) {
    this.timeoutMs = ms;
  }

  async connect(opts: {
    host: string;
    port?: number;
    username: string;
    password?: string;
    privateKeyPath?: string;
    privateKey?: string;
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

    return new Promise<string>((resolve, reject) => {
      conn.client.exec(command, (err, stream) => {
        if (err) {
          reject(new Error(`SSH exec failed: ${err.message}`));
          return;
        }

        let stdout = "";
        let stderr = "";

        stream
          .on("close", (code: number) => {
            const output = [
              stdout ? `stdout:\n${stdout}` : "",
              stderr ? `stderr:\n${stderr}` : "",
              `exit code: ${code}`,
            ]
              .filter(Boolean)
              .join("\n");
            resolve(output);
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

    const sudoCmd = `echo '${sudoPassword.replace(/'/g, "'\\''")}' | sudo -S ${command}`;

    return new Promise<string>((resolve, reject) => {
      conn.client.exec(sudoCmd, (err, stream) => {
        if (err) {
          reject(new Error(`SSH sudo exec failed: ${err.message}`));
          return;
        }

        let stdout = "";
        let stderr = "";

        stream
          .on("close", (code: number) => {
            const filteredStderr = stderr
              .split("\n")
              .filter((line) => !line.includes("[sudo] password for"))
              .join("\n")
              .trim();

            const output = [
              stdout ? `stdout:\n${stdout}` : "",
              filteredStderr ? `stderr:\n${filteredStderr}` : "",
              `exit code: ${code}`,
            ]
              .filter(Boolean)
              .join("\n");
            resolve(output);
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

  disconnect(connectionId: string): boolean {
    const conn = this.connections.get(connectionId);
    if (!conn) return false;

    conn.client.end();
    this.connections.delete(connectionId);
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
