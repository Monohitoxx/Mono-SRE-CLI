// ─── Layer 2: User Behavior ─────────────────────────────────────────────

export interface UserAction {
  id?: number;
  session_id: string;
  timestamp: string;
  tool_name: string;
  args_json: string | null;
  target_host: string | null;
  target_service: string | null;
  hour_of_day: number;
  day_of_week: number;
  is_error: number;
  preceding_tool: string | null;
  duration_ms: number | null;
}

export interface UserWorkflow {
  id?: number;
  sequence_json: string; // JSON array of tool names
  frequency: number;
  last_seen: string;
  avg_duration_ms: number | null;
  typical_hour: number | null;
  typical_target: string | null;
}

export interface UserPreference {
  key: string;
  value: string;
  confidence: number;
  sample_count: number;
  updated_at: string;
}

// ─── Layer 3: Infrastructure ────────────────────────────────────────────

export interface InfraSnapshot {
  id?: number;
  host: string;
  collected_at: string;
  collector: string;
  cpu_load_1m: number | null;
  cpu_load_5m: number | null;
  cpu_load_15m: number | null;
  ram_total_mb: number | null;
  ram_used_mb: number | null;
  ram_available_mb: number | null;
  disk_total_gb: number | null;
  disk_used_gb: number | null;
  disk_available_gb: number | null;
  packages_json: string | null;
  services_json: string | null;
  open_ports_json: string | null;
  connections_json: string | null;
}

export interface InfraChange {
  id?: number;
  host: string;
  timestamp: string;
  change_type: string;
  description: string;
  performed_by: string;
  session_id: string | null;
  tool_name: string | null;
  args_json: string | null;
}

export interface InfraBaseline {
  host: string;
  metric: string;
  avg_value: number;
  min_value: number;
  max_value: number;
  stddev: number;
  p95_value: number;
  sample_count: number;
  computed_at: string;
}

export interface Anomaly {
  host: string;
  metric: string;
  current_value: number;
  baseline_avg: number;
  baseline_stddev: number;
  deviation_sigma: number;
  severity: "warning" | "critical";
}
