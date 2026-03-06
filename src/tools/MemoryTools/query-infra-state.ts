import { BaseTool } from "../base.js";
import type { ToolResult } from "../../core/types.js";
import type Database from "better-sqlite3";
import type { Anomaly } from "../../memory/types.js";

type Focus = "latest" | "trends" | "changes" | "baseline" | "anomalies" | "all";

export class QueryInfraStateTool extends BaseTool {
  name = "query_infra_state";
  description =
    "Query stored infrastructure state for a host from the memory database. " +
    "Returns latest snapshots, resource trends, recent changes, computed baselines, and detected anomalies. " +
    "Use this to understand a host's current and historical state.";
  parameters = {
    type: "object",
    properties: {
      host: { type: "string", description: "Host name to query (required)" },
      focus: {
        type: "string",
        enum: ["latest", "trends", "changes", "baseline", "anomalies", "all"],
        description: "What aspect to query (default: all)",
      },
      lookback_days: {
        type: "number",
        description: "How many days to look back (default: 7)",
      },
    },
    required: ["host"],
  };

  private db: Database.Database;

  constructor(db: Database.Database) {
    super();
    this.requiresConfirmation = false;
    this.db = db;
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const host = args.host as string;
      const focus = (args.focus as Focus) || "all";
      const lookbackDays = (args.lookback_days as number) || 7;

      const sections: string[] = [`# Infrastructure State: ${host}\n`];

      if (focus === "all" || focus === "latest") {
        sections.push(this.queryLatest(host));
      }
      if (focus === "all" || focus === "trends") {
        sections.push(this.queryTrends(host, lookbackDays));
      }
      if (focus === "all" || focus === "changes") {
        sections.push(this.queryChanges(host, lookbackDays));
      }
      if (focus === "all" || focus === "baseline") {
        sections.push(this.queryBaseline(host));
      }
      if (focus === "all" || focus === "anomalies") {
        sections.push(this.queryAnomalies(host));
      }

      const result = sections.filter(Boolean).join("\n\n");
      return {
        toolCallId: "",
        content: result || `No data available for host "${host}". Use collect_infra_snapshot to gather data first.`,
      };
    } catch (err) {
      return { toolCallId: "", content: (err as Error).message, isError: true };
    }
  }

  private queryLatest(host: string): string {
    const row = this.db.prepare(
      `SELECT * FROM infra_snapshots WHERE host = ? ORDER BY collected_at DESC LIMIT 1`
    ).get(host) as Record<string, unknown> | undefined;

    if (!row) return "";

    const lines = ["## Latest Snapshot", `Collected: ${row.collected_at}`];
    if (row.cpu_load_1m != null) lines.push(`CPU Load: ${row.cpu_load_1m} / ${row.cpu_load_5m} / ${row.cpu_load_15m} (1m/5m/15m)`);
    if (row.ram_total_mb != null) lines.push(`RAM: ${row.ram_used_mb}MB used / ${row.ram_total_mb}MB total (${row.ram_available_mb}MB available)`);
    if (row.disk_total_gb != null) lines.push(`Disk: ${row.disk_used_gb}GB used / ${row.disk_total_gb}GB total (${row.disk_available_gb}GB available)`);

    if (row.services_json) {
      const svcs = JSON.parse(row.services_json as string) as string[];
      lines.push(`Running services (${svcs.length}): ${svcs.slice(0, 20).join(", ")}${svcs.length > 20 ? "..." : ""}`);
    }
    if (row.open_ports_json) {
      const ports = JSON.parse(row.open_ports_json as string) as string[];
      lines.push(`Open ports (${ports.length}): ${ports.slice(0, 20).join(", ")}${ports.length > 20 ? "..." : ""}`);
    }

    return lines.join("\n");
  }

  private queryTrends(host: string, days: number): string {
    const rows = this.db.prepare(
      `SELECT collected_at, cpu_load_1m, ram_used_mb, ram_total_mb, disk_used_gb, disk_total_gb
       FROM infra_snapshots WHERE host = ? AND collected_at >= datetime('now', ?)
       ORDER BY collected_at DESC LIMIT 20`
    ).all(host, `-${days} days`) as Record<string, unknown>[];

    if (rows.length < 2) return "";

    const lines = ["## Resource Trends", `Last ${days} days (${rows.length} samples):`];
    const cpus = rows.filter((r) => r.cpu_load_1m != null).map((r) => r.cpu_load_1m as number);
    const rams = rows.filter((r) => r.ram_used_mb != null).map((r) => r.ram_used_mb as number);
    const disks = rows.filter((r) => r.disk_used_gb != null).map((r) => r.disk_used_gb as number);

    if (cpus.length > 0) {
      lines.push(`CPU Load (1m): min=${Math.min(...cpus).toFixed(2)}, max=${Math.max(...cpus).toFixed(2)}, avg=${(cpus.reduce((a, b) => a + b, 0) / cpus.length).toFixed(2)}`);
    }
    if (rams.length > 0) {
      const totalMb = rows[0].ram_total_mb as number;
      lines.push(`RAM Used: min=${Math.min(...rams)}MB, max=${Math.max(...rams)}MB, avg=${Math.round(rams.reduce((a, b) => a + b, 0) / rams.length)}MB / ${totalMb}MB`);
    }
    if (disks.length > 0) {
      lines.push(`Disk Used: min=${Math.min(...disks).toFixed(1)}GB, max=${Math.max(...disks).toFixed(1)}GB, latest=${disks[0].toFixed(1)}GB`);
    }

    return lines.join("\n");
  }

  private queryChanges(host: string, days: number): string {
    const rows = this.db.prepare(
      `SELECT timestamp, change_type, description FROM infra_changes
       WHERE host = ? AND timestamp >= datetime('now', ?)
       ORDER BY timestamp DESC LIMIT 20`
    ).all(host, `-${days} days`) as { timestamp: string; change_type: string; description: string }[];

    if (rows.length === 0) return "";

    const lines = [`## Recent Changes (last ${days} days)`];
    for (const r of rows) {
      lines.push(`- [${r.timestamp}] ${r.change_type}: ${r.description}`);
    }
    return lines.join("\n");
  }

  private queryBaseline(host: string): string {
    const rows = this.db.prepare(
      `SELECT metric, avg_value, min_value, max_value, stddev, p95_value, sample_count
       FROM infra_baselines WHERE host = ?`
    ).all(host) as { metric: string; avg_value: number; min_value: number; max_value: number; stddev: number; p95_value: number; sample_count: number }[];

    if (rows.length === 0) return "";

    const lines = ["## Baselines"];
    for (const r of rows) {
      lines.push(`- ${r.metric}: avg=${r.avg_value.toFixed(2)}, range=[${r.min_value.toFixed(2)}, ${r.max_value.toFixed(2)}], stddev=${r.stddev.toFixed(2)}, p95=${r.p95_value.toFixed(2)} (${r.sample_count} samples)`);
    }
    return lines.join("\n");
  }

  private queryAnomalies(host: string): string {
    // Get latest snapshot and check against baselines
    const snapshot = this.db.prepare(
      `SELECT cpu_load_1m, ram_used_mb, disk_used_gb FROM infra_snapshots
       WHERE host = ? ORDER BY collected_at DESC LIMIT 1`
    ).get(host) as { cpu_load_1m: number | null; ram_used_mb: number | null; disk_used_gb: number | null } | undefined;

    if (!snapshot) return "";

    const baselines = this.db.prepare(
      `SELECT metric, avg_value, stddev, sample_count FROM infra_baselines WHERE host = ?`
    ).all(host) as { metric: string; avg_value: number; stddev: number; sample_count: number }[];

    if (baselines.length === 0) return "";

    const anomalies: Anomaly[] = [];
    const metrics: Record<string, number | null> = {
      cpu_load_1m: snapshot.cpu_load_1m,
      ram_used_mb: snapshot.ram_used_mb,
      disk_used_gb: snapshot.disk_used_gb,
    };

    for (const b of baselines) {
      const current = metrics[b.metric];
      if (current == null || b.sample_count < 3 || b.stddev === 0) continue;

      const deviation = Math.abs(current - b.avg_value) / b.stddev;
      if (deviation >= 2) {
        anomalies.push({
          host,
          metric: b.metric,
          current_value: current,
          baseline_avg: b.avg_value,
          baseline_stddev: b.stddev,
          deviation_sigma: deviation,
          severity: deviation >= 3 ? "critical" : "warning",
        });
      }
    }

    if (anomalies.length === 0) return "";

    const lines = ["## Anomalies Detected"];
    for (const a of anomalies) {
      const icon = a.severity === "critical" ? "CRITICAL" : "WARNING";
      lines.push(`- [${icon}] ${a.metric}: current=${a.current_value.toFixed(2)}, baseline avg=${a.baseline_avg.toFixed(2)} (${a.deviation_sigma.toFixed(1)} sigma deviation)`);
    }
    return lines.join("\n");
  }
}
