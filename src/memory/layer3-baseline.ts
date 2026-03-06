import type Database from "better-sqlite3";
import type { Anomaly } from "./types.js";

const METRICS = ["cpu_load_1m", "ram_used_mb", "disk_used_gb"] as const;

export class Layer3Baseline {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Compute baselines for a host from historical snapshots.
   * Requires at least 3 samples to compute.
   */
  computeBaselines(host: string, lookbackDays = 30): void {
    const upsert = this.db.prepare(`
      INSERT INTO infra_baselines (host, metric, avg_value, min_value, max_value, stddev, p95_value, sample_count, computed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(host, metric) DO UPDATE SET
        avg_value = excluded.avg_value, min_value = excluded.min_value,
        max_value = excluded.max_value, stddev = excluded.stddev,
        p95_value = excluded.p95_value, sample_count = excluded.sample_count,
        computed_at = excluded.computed_at
    `);

    const now = new Date().toISOString();

    const transaction = this.db.transaction(() => {
      for (const metric of METRICS) {
        const rows = this.db.prepare(
          `SELECT ${metric} as val FROM infra_snapshots
           WHERE host = ? AND ${metric} IS NOT NULL
           AND collected_at >= datetime('now', ?)
           ORDER BY ${metric} ASC`
        ).all(host, `-${lookbackDays} days`) as { val: number }[];

        if (rows.length < 3) continue;

        const values = rows.map((r) => r.val);
        const avg = values.reduce((a, b) => a + b, 0) / values.length;
        const min = values[0];
        const max = values[values.length - 1];
        const variance = values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / values.length;
        const stddev = Math.sqrt(variance);
        const p95Index = Math.floor(values.length * 0.95);
        const p95 = values[Math.min(p95Index, values.length - 1)];

        upsert.run(host, metric, avg, min, max, stddev, p95, values.length, now);
      }
    });

    transaction();
  }

  /**
   * Detect anomalies by comparing a snapshot against baselines.
   * Returns anomalies where deviation >= 2 sigma.
   */
  detectAnomalies(host: string, snapshot: { cpu_load_1m?: number | null; ram_used_mb?: number | null; disk_used_gb?: number | null }): Anomaly[] {
    const baselines = this.db.prepare(
      `SELECT metric, avg_value, stddev, sample_count FROM infra_baselines WHERE host = ? AND sample_count >= 3`
    ).all(host) as { metric: string; avg_value: number; stddev: number; sample_count: number }[];

    const anomalies: Anomaly[] = [];
    const metricValues: Record<string, number | null | undefined> = {
      cpu_load_1m: snapshot.cpu_load_1m,
      ram_used_mb: snapshot.ram_used_mb,
      disk_used_gb: snapshot.disk_used_gb,
    };

    for (const b of baselines) {
      const val = metricValues[b.metric];
      if (val == null || b.stddev === 0) continue;

      const deviation = Math.abs(val - b.avg_value) / b.stddev;
      if (deviation >= 2) {
        anomalies.push({
          host,
          metric: b.metric,
          current_value: val,
          baseline_avg: b.avg_value,
          baseline_stddev: b.stddev,
          deviation_sigma: deviation,
          severity: deviation >= 3 ? "critical" : "warning",
        });
      }
    }

    return anomalies;
  }
}
