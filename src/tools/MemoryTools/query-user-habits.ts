import { BaseTool } from "../base.js";
import type { ToolResult } from "../../core/types.js";
import type Database from "better-sqlite3";

type Focus = "workflows" | "tool_frequency" | "time_patterns" | "preferences" | "all";

export class QueryUserHabitsTool extends BaseTool {
  name = "query_user_habits";
  description =
    "Query learned user behavior patterns from the memory database. " +
    "Returns tool usage frequency, common workflows, time-of-day patterns, and user preferences. " +
    "Use this to understand how the user typically works and what they prefer.";
  parameters = {
    type: "object",
    properties: {
      focus: {
        type: "string",
        enum: ["workflows", "tool_frequency", "time_patterns", "preferences", "all"],
        description: "What aspect to query (default: all)",
      },
      host: { type: "string", description: "Filter by target host" },
      service: { type: "string", description: "Filter by target service" },
    },
    required: [],
  };

  private db: Database.Database;

  constructor(db: Database.Database) {
    super();
    this.requiresConfirmation = false;
    this.db = db;
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const focus = (args.focus as Focus) || "all";
      const host = args.host as string | undefined;
      const service = args.service as string | undefined;

      const sections: string[] = [];

      if (focus === "all" || focus === "tool_frequency") {
        sections.push(this.queryToolFrequency(host, service));
      }
      if (focus === "all" || focus === "workflows") {
        sections.push(this.queryWorkflows());
      }
      if (focus === "all" || focus === "time_patterns") {
        sections.push(this.queryTimePatterns());
      }
      if (focus === "all" || focus === "preferences") {
        sections.push(this.queryPreferences());
      }

      const result = sections.filter(Boolean).join("\n\n");
      return {
        toolCallId: "",
        content: result || "No user behavior data collected yet. Data accumulates as you use tools.",
      };
    } catch (err) {
      return { toolCallId: "", content: (err as Error).message, isError: true };
    }
  }

  private queryToolFrequency(host?: string, service?: string): string {
    let query = `SELECT tool_name, COUNT(*) as count, SUM(is_error) as errors FROM user_actions WHERE 1=1`;
    const params: unknown[] = [];

    if (host) { query += ` AND target_host = ?`; params.push(host); }
    if (service) { query += ` AND target_service = ?`; params.push(service); }

    query += ` GROUP BY tool_name ORDER BY count DESC LIMIT 15`;

    const rows = this.db.prepare(query).all(...params) as { tool_name: string; count: number; errors: number }[];
    if (rows.length === 0) return "";

    const lines = ["## Tool Usage Frequency"];
    for (const r of rows) {
      const errorRate = r.errors > 0 ? ` (${r.errors} errors)` : "";
      lines.push(`- ${r.tool_name}: ${r.count} calls${errorRate}`);
    }
    return lines.join("\n");
  }

  private queryWorkflows(): string {
    const rows = this.db.prepare(
      `SELECT sequence_json, frequency, avg_duration_ms, typical_hour, typical_target
       FROM user_workflows WHERE frequency >= 2 ORDER BY frequency DESC LIMIT 10`
    ).all() as { sequence_json: string; frequency: number; avg_duration_ms: number | null; typical_hour: number | null; typical_target: string | null }[];

    if (rows.length === 0) return "";

    const lines = ["## Common Workflows"];
    for (const r of rows) {
      const seq = JSON.parse(r.sequence_json) as string[];
      const dur = r.avg_duration_ms ? ` (~${Math.round(r.avg_duration_ms / 1000)}s)` : "";
      const target = r.typical_target ? ` on ${r.typical_target}` : "";
      lines.push(`- ${seq.join(" → ")} (${r.frequency}x${dur}${target})`);
    }
    return lines.join("\n");
  }

  private queryTimePatterns(): string {
    const rows = this.db.prepare(
      `SELECT hour_of_day, COUNT(*) as count FROM user_actions
       GROUP BY hour_of_day ORDER BY count DESC LIMIT 5`
    ).all() as { hour_of_day: number; count: number }[];

    if (rows.length === 0) return "";

    const lines = ["## Active Hours"];
    for (const r of rows) {
      lines.push(`- ${String(r.hour_of_day).padStart(2, "0")}:00 — ${r.count} actions`);
    }
    return lines.join("\n");
  }

  private queryPreferences(): string {
    const rows = this.db.prepare(
      `SELECT key, value, confidence, sample_count FROM user_preferences
       WHERE confidence >= 0.3 ORDER BY confidence DESC LIMIT 10`
    ).all() as { key: string; value: string; confidence: number; sample_count: number }[];

    if (rows.length === 0) return "";

    const lines = ["## User Preferences"];
    for (const r of rows) {
      lines.push(`- ${r.key}: ${r.value} (confidence: ${(r.confidence * 100).toFixed(0)}%, samples: ${r.sample_count})`);
    }
    return lines.join("\n");
  }
}
