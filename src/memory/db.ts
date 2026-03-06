import Database from "better-sqlite3";
import * as path from "node:path";
import * as fs from "node:fs";
import { getMonoDir } from "../config/env.js";

const CURRENT_VERSION = 1;

const SCHEMA_V1 = `
-- Layer 2: user actions
CREATE TABLE IF NOT EXISTS user_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  args_json TEXT,
  target_host TEXT,
  target_service TEXT,
  hour_of_day INTEGER,
  day_of_week INTEGER,
  is_error INTEGER DEFAULT 0,
  preceding_tool TEXT,
  duration_ms INTEGER
);

-- Layer 2: workflows
CREATE TABLE IF NOT EXISTS user_workflows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sequence_json TEXT NOT NULL,
  frequency INTEGER DEFAULT 1,
  last_seen TEXT NOT NULL,
  avg_duration_ms INTEGER,
  typical_hour INTEGER,
  typical_target TEXT
);

-- Layer 2: preferences
CREATE TABLE IF NOT EXISTS user_preferences (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  confidence REAL DEFAULT 0.5,
  sample_count INTEGER DEFAULT 0,
  updated_at TEXT NOT NULL
);

-- Layer 3: snapshots
CREATE TABLE IF NOT EXISTS infra_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  host TEXT NOT NULL,
  collected_at TEXT NOT NULL,
  collector TEXT DEFAULT 'manual',
  cpu_load_1m REAL, cpu_load_5m REAL, cpu_load_15m REAL,
  ram_total_mb INTEGER, ram_used_mb INTEGER, ram_available_mb INTEGER,
  disk_total_gb REAL, disk_used_gb REAL, disk_available_gb REAL,
  packages_json TEXT,
  services_json TEXT,
  open_ports_json TEXT,
  connections_json TEXT
);

-- Layer 3: changes
CREATE TABLE IF NOT EXISTS infra_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  host TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  change_type TEXT NOT NULL,
  description TEXT NOT NULL,
  performed_by TEXT DEFAULT 'unknown',
  session_id TEXT,
  tool_name TEXT,
  args_json TEXT
);

-- Layer 3: baselines
CREATE TABLE IF NOT EXISTS infra_baselines (
  host TEXT NOT NULL,
  metric TEXT NOT NULL,
  avg_value REAL, min_value REAL, max_value REAL,
  stddev REAL, p95_value REAL,
  sample_count INTEGER DEFAULT 0,
  computed_at TEXT NOT NULL,
  PRIMARY KEY (host, metric)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_user_actions_session ON user_actions(session_id);
CREATE INDEX IF NOT EXISTS idx_user_actions_tool ON user_actions(tool_name);
CREATE INDEX IF NOT EXISTS idx_user_actions_ts ON user_actions(timestamp);
CREATE INDEX IF NOT EXISTS idx_infra_snapshots_host ON infra_snapshots(host, collected_at);
CREATE INDEX IF NOT EXISTS idx_infra_changes_host ON infra_changes(host, timestamp);
`;

export function initMemoryDb(): Database.Database {
  const monoDir = getMonoDir();
  if (!fs.existsSync(monoDir)) {
    fs.mkdirSync(monoDir, { recursive: true });
  }

  const dbPath = path.join(monoDir, "memory.db");
  const db = new Database(dbPath);

  // WAL mode for better concurrent read performance
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 3000");

  const version = db.pragma("user_version", { simple: true }) as number;

  if (version < CURRENT_VERSION) {
    db.exec(SCHEMA_V1);
    db.pragma(`user_version = ${CURRENT_VERSION}`);
  }

  // Cleanup old data
  cleanupOldData(db);

  return db;
}

export function closeMemoryDb(db: Database.Database): void {
  try {
    db.close();
  } catch {
    // Silent fail
  }
}

function cleanupOldData(db: Database.Database): void {
  try {
    // user_actions > 90 days
    db.prepare(
      `DELETE FROM user_actions WHERE timestamp < datetime('now', '-90 days')`
    ).run();

    // infra_snapshots > 30 days, keep last per host per day
    db.prepare(`
      DELETE FROM infra_snapshots
      WHERE id NOT IN (
        SELECT MAX(id) FROM infra_snapshots
        WHERE collected_at < datetime('now', '-30 days')
        GROUP BY host, date(collected_at)
      )
      AND collected_at < datetime('now', '-30 days')
    `).run();
  } catch {
    // Silent fail — cleanup is best-effort
  }
}
