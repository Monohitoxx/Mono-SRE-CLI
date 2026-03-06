import type Database from "better-sqlite3";
import type { AuditLogger } from "../utils/audit.js";

// Tools that represent infrastructure mutations (for passive Layer 3 tracking)
const MUTATING_TOOLS = new Set([
  "service_control",
  "restart_service",
  "write_config",
  "execute_command",
  "manage_firewall_rule",
]);

// Actions within service_control that are mutations
const MUTATING_SERVICE_ACTIONS = new Set([
  "start", "stop", "restart", "reload", "enable", "disable", "mask", "unmask",
]);

export class Layer2Collector {
  private db: Database.Database;
  private sessionId: string;
  private lastToolName: string | null = null;
  private pendingCalls = new Map<string, { toolName: string; timestamp: number; host: string | null; service: string | null }>();

  private insertAction: Database.Statement;
  private updateError: Database.Statement;
  private insertChange: Database.Statement;

  constructor(db: Database.Database, sessionId: string) {
    this.db = db;
    this.sessionId = sessionId;

    this.insertAction = db.prepare(`
      INSERT INTO user_actions (session_id, timestamp, tool_name, args_json, target_host, target_service, hour_of_day, day_of_week, is_error, preceding_tool, duration_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NULL)
    `);

    this.updateError = db.prepare(`
      UPDATE user_actions SET is_error = ?, duration_ms = ?
      WHERE session_id = ? AND tool_name = ? AND timestamp = ?
    `);

    this.insertChange = db.prepare(`
      INSERT INTO infra_changes (host, timestamp, change_type, description, performed_by, session_id, tool_name, args_json)
      VALUES (?, ?, ?, ?, 'user', ?, ?, ?)
    `);
  }

  attach(audit: AuditLogger): void {
    audit.addObserver((entry) => {
      try {
        if (entry.event === "tool_call") {
          this.onToolCall(entry);
        } else if (entry.event === "tool_result") {
          this.onToolResult(entry);
        }
      } catch {
        // Never crash the CLI
      }
    });
  }

  private onToolCall(entry: { timestamp: string; sessionId: string; event: string; details: Record<string, unknown> }): void {
    const toolName = entry.details.tool as string;
    if (!toolName) return;

    const args = entry.details.args as Record<string, unknown> | undefined;
    const now = new Date(entry.timestamp);
    const host = extractTargetHost(args);
    const service = extractTargetService(toolName, args);

    this.insertAction.run(
      this.sessionId,
      entry.timestamp,
      toolName,
      args ? JSON.stringify(redactArgs(args)) : null,
      host,
      service,
      now.getHours(),
      now.getDay(),
      this.lastToolName,
    );

    // Track for duration calculation
    const callId = entry.details.id as string || `${toolName}_${entry.timestamp}`;
    this.pendingCalls.set(callId, {
      toolName,
      timestamp: Date.now(),
      host,
      service,
    });

    // Track infra changes for mutating operations
    if (host && isMutatingCall(toolName, args)) {
      const desc = buildChangeDescription(toolName, args);
      this.insertChange.run(
        host,
        entry.timestamp,
        toolName,
        desc,
        this.sessionId,
        toolName,
        args ? JSON.stringify(redactArgs(args)) : null,
      );
    }

    this.lastToolName = toolName;
  }

  private onToolResult(entry: { timestamp: string; details: Record<string, unknown> }): void {
    const callId = entry.details.id as string;
    const isError = entry.details.isError ? 1 : 0;

    if (callId && this.pendingCalls.has(callId)) {
      const pending = this.pendingCalls.get(callId)!;
      const duration = Date.now() - pending.timestamp;
      this.updateError.run(isError, duration, this.sessionId, pending.toolName, new Date(pending.timestamp).toISOString());
      this.pendingCalls.delete(callId);
    }
  }
}

function extractTargetHost(args?: Record<string, unknown>): string | null {
  if (!args) return null;
  if (typeof args.host === "string") return args.host;
  if (Array.isArray(args.hosts) && args.hosts.length > 0) return args.hosts[0] as string;
  if (Array.isArray(args.tags) && args.tags.length > 0) return `tags:${(args.tags as string[]).join(",")}`;
  return null;
}

function extractTargetService(toolName: string, args?: Record<string, unknown>): string | null {
  if (!args) return null;
  if (typeof args.service === "string") return args.service;
  if (typeof args.service_name === "string") return args.service_name;
  if (toolName === "service_control" && typeof args.service === "string") return args.service;
  return null;
}

function redactArgs(args: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (/password|secret|token|key|credential/i.test(k)) {
      result[k] = "[REDACTED]";
    } else {
      result[k] = v;
    }
  }
  return result;
}

function isMutatingCall(toolName: string, args?: Record<string, unknown>): boolean {
  if (!MUTATING_TOOLS.has(toolName)) return false;
  if (toolName === "service_control") {
    const action = args?.action as string | undefined;
    return action ? MUTATING_SERVICE_ACTIONS.has(action) : false;
  }
  if (toolName === "manage_firewall_rule") {
    const action = args?.action as string | undefined;
    return action !== "status";
  }
  return true;
}

function buildChangeDescription(toolName: string, args?: Record<string, unknown>): string {
  if (!args) return toolName;
  switch (toolName) {
    case "service_control":
      return `${args.action} service ${args.service || "unknown"}`;
    case "restart_service":
      return `restart service ${args.service_name || args.service || "unknown"}`;
    case "write_config":
      return `write config ${args.path || "unknown"}`;
    case "execute_command":
      return `execute: ${(args.command as string || "").slice(0, 100)}`;
    case "manage_firewall_rule":
      return `firewall ${args.action}: ${args.rule || ""}`;
    default:
      return toolName;
  }
}
