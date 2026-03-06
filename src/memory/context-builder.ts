import type Database from "better-sqlite3";

const MAX_MEMORY_CONTEXT_CHARS = 2000;

export class MemoryContextBuilder {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  buildContext(opts: { currentHour: number }): string {
    const sections: string[] = [];

    // Priority 1: Anomalies
    const anomalies = this.getAnomalies();
    if (anomalies) sections.push(anomalies);

    // Priority 2: Recent host states
    const hostStates = this.getRecentHostStates();
    if (hostStates) sections.push(hostStates);

    // Priority 3: Recent infra changes
    const changes = this.getRecentChanges();
    if (changes) sections.push(changes);

    // Priority 4: User habits
    const habits = this.getUserHabits(opts.currentHour);
    if (habits) sections.push(habits);

    if (sections.length === 0) return "";

    let result = "## Memory Context\n\n" + sections.join("\n\n");

    // Enforce character limit
    if (result.length > MAX_MEMORY_CONTEXT_CHARS) {
      result = result.slice(0, MAX_MEMORY_CONTEXT_CHARS - 3) + "...";
    }

    return result;
  }

  private getAnomalies(): string {
    try {
      // For each host with a baseline, check latest snapshot against it
      const baselines = this.db.prepare(
        `SELECT DISTINCT host FROM infra_baselines`
      ).all() as { host: string }[];

      const alerts: string[] = [];

      for (const { host } of baselines) {
        const snapshot = this.db.prepare(
          `SELECT cpu_load_1m, ram_used_mb, disk_used_gb FROM infra_snapshots
           WHERE host = ? ORDER BY collected_at DESC LIMIT 1`
        ).get(host) as { cpu_load_1m: number | null; ram_used_mb: number | null; disk_used_gb: number | null } | undefined;

        if (!snapshot) continue;

        const bRows = this.db.prepare(
          `SELECT metric, avg_value, stddev FROM infra_baselines WHERE host = ? AND sample_count >= 3`
        ).all(host) as { metric: string; avg_value: number; stddev: number }[];

        for (const b of bRows) {
          const val = b.metric === "cpu_load_1m" ? snapshot.cpu_load_1m
            : b.metric === "ram_used_mb" ? snapshot.ram_used_mb
            : b.metric === "disk_used_gb" ? snapshot.disk_used_gb
            : null;
          if (val == null || b.stddev === 0) continue;

          const dev = Math.abs(val - b.avg_value) / b.stddev;
          if (dev >= 2) {
            const sev = dev >= 3 ? "CRITICAL" : "WARNING";
            alerts.push(`[${sev}] ${host}/${b.metric}: ${val.toFixed(1)} (baseline: ${b.avg_value.toFixed(1)})`);
          }
        }
      }

      if (alerts.length === 0) return "";
      return "### Anomalies\n" + alerts.join("\n");
    } catch {
      return "";
    }
  }

  private getRecentHostStates(): string {
    try {
      const rows = this.db.prepare(
        `SELECT host, collected_at, cpu_load_1m, ram_used_mb, ram_total_mb, disk_used_gb, disk_total_gb
         FROM infra_snapshots
         WHERE id IN (SELECT MAX(id) FROM infra_snapshots GROUP BY host)
         ORDER BY collected_at DESC LIMIT 5`
      ).all() as Record<string, unknown>[];

      if (rows.length === 0) return "";

      const lines = ["### Known Host States"];
      for (const r of rows) {
        const parts = [`${r.host}`];
        if (r.cpu_load_1m != null) parts.push(`cpu=${r.cpu_load_1m}`);
        if (r.ram_used_mb != null) parts.push(`ram=${r.ram_used_mb}/${r.ram_total_mb}MB`);
        if (r.disk_used_gb != null) parts.push(`disk=${r.disk_used_gb}/${r.disk_total_gb}GB`);
        lines.push(`- ${parts.join(", ")}`);
      }
      return lines.join("\n");
    } catch {
      return "";
    }
  }

  private getRecentChanges(): string {
    try {
      const rows = this.db.prepare(
        `SELECT host, timestamp, change_type, description FROM infra_changes
         ORDER BY timestamp DESC LIMIT 5`
      ).all() as { host: string; timestamp: string; change_type: string; description: string }[];

      if (rows.length === 0) return "";

      const lines = ["### Recent Changes"];
      for (const r of rows) {
        lines.push(`- ${r.host}: ${r.description} (${r.timestamp.slice(0, 16)})`);
      }
      return lines.join("\n");
    } catch {
      return "";
    }
  }

  private getUserHabits(currentHour: number): string {
    try {
      const parts: string[] = [];

      // Top 5 tools
      const tools = this.db.prepare(
        `SELECT tool_name, COUNT(*) as c FROM user_actions GROUP BY tool_name ORDER BY c DESC LIMIT 5`
      ).all() as { tool_name: string; c: number }[];

      if (tools.length > 0) {
        parts.push("Top tools: " + tools.map((t) => `${t.tool_name}(${t.c})`).join(", "));
      }

      // Common workflows (frequency >= 3)
      const workflows = this.db.prepare(
        `SELECT sequence_json, frequency FROM user_workflows WHERE frequency >= 3 ORDER BY frequency DESC LIMIT 3`
      ).all() as { sequence_json: string; frequency: number }[];

      if (workflows.length > 0) {
        const wfLines = workflows.map((w) => {
          const seq = JSON.parse(w.sequence_json) as string[];
          return `${seq.join("→")}(${w.frequency}x)`;
        });
        parts.push("Workflows: " + wfLines.join("; "));
      }

      if (parts.length === 0) return "";
      return "### User Patterns\n" + parts.join("\n");
    } catch {
      return "";
    }
  }
}
