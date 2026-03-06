import type Database from "better-sqlite3";
import type { SSHManager } from "../utils/ssh-manager.js";
import type { HostEntry } from "../config/inventory.js";
import { RemoteExecutor } from "../tools/RemoteTools/executor.js";
import type { InfraSnapshot } from "./types.js";

export class Layer3Collector {
  private db: Database.Database;
  private executor: RemoteExecutor;

  private insertSnapshot: Database.Statement;

  constructor(db: Database.Database, sshManager: SSHManager) {
    this.db = db;
    this.executor = new RemoteExecutor(sshManager);

    this.insertSnapshot = db.prepare(`
      INSERT INTO infra_snapshots (
        host, collected_at, collector,
        cpu_load_1m, cpu_load_5m, cpu_load_15m,
        ram_total_mb, ram_used_mb, ram_available_mb,
        disk_total_gb, disk_used_gb, disk_available_gb,
        packages_json, services_json, open_ports_json, connections_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
  }

  async collectSnapshot(entry: HostEntry, collector = "manual"): Promise<InfraSnapshot> {
    const connId = await this.executor.ensureConnected(entry);
    const now = new Date().toISOString();

    // Run all collectors in parallel
    const [cpu, ram, disk, packages, services, ports] = await Promise.allSettled([
      this.collectCpu(connId),
      this.collectRam(connId),
      this.collectDisk(connId),
      this.collectPackages(connId),
      this.collectServices(connId),
      this.collectPorts(connId),
    ]);

    const cpuData = cpu.status === "fulfilled" ? cpu.value : null;
    const ramData = ram.status === "fulfilled" ? ram.value : null;
    const diskData = disk.status === "fulfilled" ? disk.value : null;
    const pkgData = packages.status === "fulfilled" ? packages.value : null;
    const svcData = services.status === "fulfilled" ? services.value : null;
    const portData = ports.status === "fulfilled" ? ports.value : null;

    const snapshot: InfraSnapshot = {
      host: entry.name,
      collected_at: now,
      collector,
      cpu_load_1m: cpuData?.load1m ?? null,
      cpu_load_5m: cpuData?.load5m ?? null,
      cpu_load_15m: cpuData?.load15m ?? null,
      ram_total_mb: ramData?.totalMb ?? null,
      ram_used_mb: ramData?.usedMb ?? null,
      ram_available_mb: ramData?.availableMb ?? null,
      disk_total_gb: diskData?.totalGb ?? null,
      disk_used_gb: diskData?.usedGb ?? null,
      disk_available_gb: diskData?.availableGb ?? null,
      packages_json: pkgData ? JSON.stringify(pkgData) : null,
      services_json: svcData ? JSON.stringify(svcData) : null,
      open_ports_json: portData ? JSON.stringify(portData) : null,
      connections_json: null,
    };

    this.insertSnapshot.run(
      snapshot.host, snapshot.collected_at, snapshot.collector,
      snapshot.cpu_load_1m, snapshot.cpu_load_5m, snapshot.cpu_load_15m,
      snapshot.ram_total_mb, snapshot.ram_used_mb, snapshot.ram_available_mb,
      snapshot.disk_total_gb, snapshot.disk_used_gb, snapshot.disk_available_gb,
      snapshot.packages_json, snapshot.services_json, snapshot.open_ports_json,
      snapshot.connections_json,
    );

    return snapshot;
  }

  async collectMultiple(entries: HostEntry[], collector = "manual"): Promise<{ host: string; snapshot?: InfraSnapshot; error?: string }[]> {
    const results = await Promise.allSettled(
      entries.map((e) => this.collectSnapshot(e, collector))
    );

    return results.map((r, i) => {
      if (r.status === "fulfilled") {
        return { host: entries[i].name, snapshot: r.value };
      }
      return { host: entries[i].name, error: r.reason?.message || "Unknown error" };
    });
  }

  private async collectCpu(connId: string): Promise<{ load1m: number; load5m: number; load15m: number }> {
    const raw = await this.executor.exec(connId, "cat /proc/loadavg");
    const parts = raw.trim().split(/\s+/);
    return {
      load1m: parseFloat(parts[0]) || 0,
      load5m: parseFloat(parts[1]) || 0,
      load15m: parseFloat(parts[2]) || 0,
    };
  }

  private async collectRam(connId: string): Promise<{ totalMb: number; usedMb: number; availableMb: number }> {
    const raw = await this.executor.exec(connId, "cat /proc/meminfo");
    const lines = raw.split("\n");
    let totalKb = 0, availableKb = 0, freeKb = 0, buffersKb = 0, cachedKb = 0;

    for (const line of lines) {
      const match = line.match(/^(\w+):\s+(\d+)/);
      if (!match) continue;
      const [, key, val] = match;
      const kb = parseInt(val, 10);
      switch (key) {
        case "MemTotal": totalKb = kb; break;
        case "MemAvailable": availableKb = kb; break;
        case "MemFree": freeKb = kb; break;
        case "Buffers": buffersKb = kb; break;
        case "Cached": cachedKb = kb; break;
      }
    }

    const available = availableKb || (freeKb + buffersKb + cachedKb);
    return {
      totalMb: Math.round(totalKb / 1024),
      usedMb: Math.round((totalKb - available) / 1024),
      availableMb: Math.round(available / 1024),
    };
  }

  private async collectDisk(connId: string): Promise<{ totalGb: number; usedGb: number; availableGb: number }> {
    const raw = await this.executor.exec(connId, "df -B1 --total 2>/dev/null || df -k");
    const lines = raw.trim().split("\n");

    // Look for "total" line from --total, or sum up non-tmpfs mounts
    const totalLine = lines.find((l) => /^total\s/i.test(l));
    if (totalLine) {
      const parts = totalLine.trim().split(/\s+/);
      const total = parseInt(parts[1], 10) || 0;
      const used = parseInt(parts[2], 10) || 0;
      const avail = parseInt(parts[3], 10) || 0;
      return {
        totalGb: +(total / 1e9).toFixed(1),
        usedGb: +(used / 1e9).toFixed(1),
        availableGb: +(avail / 1e9).toFixed(1),
      };
    }

    // Fallback: sum all lines except header and tmpfs
    let totalBytes = 0, usedBytes = 0, availBytes = 0;
    for (const line of lines.slice(1)) {
      if (/^(tmpfs|devtmpfs|none)/.test(line)) continue;
      const parts = line.trim().split(/\s+/);
      const multiplier = raw.includes("-B1") ? 1 : 1024; // df -k gives KB
      totalBytes += (parseInt(parts[1], 10) || 0) * multiplier;
      usedBytes += (parseInt(parts[2], 10) || 0) * multiplier;
      availBytes += (parseInt(parts[3], 10) || 0) * multiplier;
    }

    return {
      totalGb: +(totalBytes / 1e9).toFixed(1),
      usedGb: +(usedBytes / 1e9).toFixed(1),
      availableGb: +(availBytes / 1e9).toFixed(1),
    };
  }

  private async collectPackages(connId: string): Promise<string[]> {
    try {
      const raw = await this.executor.exec(connId, "rpm -qa --qf '%{NAME}\\n' 2>/dev/null || dpkg-query -W -f='${Package}\\n' 2>/dev/null || echo ''");
      const pkgs = raw.trim().split("\n").filter(Boolean);
      return pkgs.length > 0 ? pkgs : [];
    } catch {
      return [];
    }
  }

  private async collectServices(connId: string): Promise<string[]> {
    try {
      const raw = await this.executor.exec(connId, "systemctl list-units --type=service --state=running --no-legend 2>/dev/null | awk '{print $1}'");
      return raw.trim().split("\n").filter(Boolean);
    } catch {
      return [];
    }
  }

  private async collectPorts(connId: string): Promise<string[]> {
    try {
      const raw = await this.executor.exec(connId, "ss -tlnp 2>/dev/null | tail -n +2 | awk '{print $4}'");
      return raw.trim().split("\n").filter(Boolean);
    } catch {
      return [];
    }
  }
}
