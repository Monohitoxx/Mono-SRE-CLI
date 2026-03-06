import type Database from "better-sqlite3";

export class Layer2Analyzer {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Analyze recent sessions to find repeated tool sequences (3-7 steps).
   * Updates user_workflows table.
   */
  analyzeWorkflows(lookbackSessions = 20): void {
    // Get recent sessions
    const sessions = this.db.prepare(
      `SELECT DISTINCT session_id FROM user_actions ORDER BY timestamp DESC LIMIT ?`
    ).all(lookbackSessions) as { session_id: string }[];

    if (sessions.length === 0) return;

    const sessionIds = sessions.map((s) => s.session_id);
    const placeholders = sessionIds.map(() => "?").join(",");

    // Get tool sequences per session
    const actions = this.db.prepare(
      `SELECT session_id, tool_name, target_host, hour_of_day, timestamp
       FROM user_actions WHERE session_id IN (${placeholders})
       ORDER BY session_id, timestamp`
    ).all(...sessionIds) as { session_id: string; tool_name: string; target_host: string | null; hour_of_day: number; timestamp: string }[];

    // Group by session
    const grouped = new Map<string, typeof actions>();
    for (const a of actions) {
      if (!grouped.has(a.session_id)) grouped.set(a.session_id, []);
      grouped.get(a.session_id)!.push(a);
    }

    // Extract subsequences of length 3-7 using sliding window
    const seqCounts = new Map<string, { count: number; hosts: string[]; hours: number[]; durations: number[] }>();

    for (const [, sessionActions] of grouped) {
      const toolNames = sessionActions.map((a) => a.tool_name);

      for (let windowSize = 3; windowSize <= Math.min(7, toolNames.length); windowSize++) {
        for (let i = 0; i <= toolNames.length - windowSize; i++) {
          const seq = toolNames.slice(i, i + windowSize);
          const key = JSON.stringify(seq);

          if (!seqCounts.has(key)) {
            seqCounts.set(key, { count: 0, hosts: [], hours: [], durations: [] });
          }
          const entry = seqCounts.get(key)!;
          entry.count++;
          const host = sessionActions[i].target_host;
          if (host) entry.hosts.push(host);
          entry.hours.push(sessionActions[i].hour_of_day);
        }
      }
    }

    // Upsert workflows with frequency >= 2
    const upsert = this.db.prepare(`
      INSERT INTO user_workflows (sequence_json, frequency, last_seen, avg_duration_ms, typical_hour, typical_target)
      VALUES (?, ?, ?, NULL, ?, ?)
      ON CONFLICT(id) DO UPDATE SET frequency = excluded.frequency, last_seen = excluded.last_seen
    `);

    // First, find existing workflows by sequence
    const findExisting = this.db.prepare(
      `SELECT id FROM user_workflows WHERE sequence_json = ?`
    );

    const updateExisting = this.db.prepare(
      `UPDATE user_workflows SET frequency = ?, last_seen = ?, typical_hour = ?, typical_target = ? WHERE id = ?`
    );

    const insertNew = this.db.prepare(
      `INSERT INTO user_workflows (sequence_json, frequency, last_seen, typical_hour, typical_target) VALUES (?, ?, ?, ?, ?)`
    );

    const now = new Date().toISOString();

    const transaction = this.db.transaction(() => {
      for (const [seqJson, data] of seqCounts) {
        if (data.count < 2) continue;

        const typicalHour = mode(data.hours);
        const typicalTarget = mode(data.hosts) || null;

        const existing = findExisting.get(seqJson) as { id: number } | undefined;
        if (existing) {
          updateExisting.run(data.count, now, typicalHour, typicalTarget, existing.id);
        } else {
          insertNew.run(seqJson, data.count, now, typicalHour, typicalTarget);
        }
      }
    });

    transaction();
  }

  /**
   * Analyze user actions to derive preferences.
   * Updates user_preferences table.
   */
  updatePreferences(): void {
    const now = new Date().toISOString();
    const upsert = this.db.prepare(`
      INSERT INTO user_preferences (key, value, confidence, sample_count, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, confidence = excluded.confidence,
        sample_count = excluded.sample_count, updated_at = excluded.updated_at
    `);

    const transaction = this.db.transaction(() => {
      // Preferred working hours
      const hourRows = this.db.prepare(
        `SELECT hour_of_day, COUNT(*) as c FROM user_actions GROUP BY hour_of_day ORDER BY c DESC LIMIT 1`
      ).get() as { hour_of_day: number; c: number } | undefined;

      if (hourRows) {
        const total = (this.db.prepare(`SELECT COUNT(*) as c FROM user_actions`).get() as { c: number }).c;
        const confidence = Math.min(hourRows.c / Math.max(total, 1), 1);
        upsert.run("preferred_hour", String(hourRows.hour_of_day), confidence, total, now);
      }

      // Most used tools
      const topTool = this.db.prepare(
        `SELECT tool_name, COUNT(*) as c FROM user_actions GROUP BY tool_name ORDER BY c DESC LIMIT 1`
      ).get() as { tool_name: string; c: number } | undefined;

      if (topTool) {
        upsert.run("most_used_tool", topTool.tool_name, 0.8, topTool.c, now);
      }

      // Most targeted host
      const topHost = this.db.prepare(
        `SELECT target_host, COUNT(*) as c FROM user_actions WHERE target_host IS NOT NULL GROUP BY target_host ORDER BY c DESC LIMIT 1`
      ).get() as { target_host: string; c: number } | undefined;

      if (topHost) {
        const hostTotal = (this.db.prepare(`SELECT COUNT(*) as c FROM user_actions WHERE target_host IS NOT NULL`).get() as { c: number }).c;
        upsert.run("most_targeted_host", topHost.target_host, topHost.c / Math.max(hostTotal, 1), topHost.c, now);
      }

      // Error rate
      const errorStats = this.db.prepare(
        `SELECT COUNT(*) as total, SUM(is_error) as errors FROM user_actions`
      ).get() as { total: number; errors: number };

      if (errorStats.total > 0) {
        const rate = (errorStats.errors / errorStats.total * 100).toFixed(1);
        upsert.run("error_rate_percent", rate, 0.9, errorStats.total, now);
      }
    });

    transaction();
  }
}

function mode<T>(arr: T[]): T | undefined {
  if (arr.length === 0) return undefined;
  const counts = new Map<T, number>();
  for (const v of arr) {
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  let maxCount = 0;
  let maxVal: T | undefined;
  for (const [v, c] of counts) {
    if (c > maxCount) { maxCount = c; maxVal = v; }
  }
  return maxVal;
}
