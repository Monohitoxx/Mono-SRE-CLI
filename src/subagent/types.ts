export type ToolFilterType = "readonly" | "full" | "custom" | "none";

export interface SubagentConfig {
  /** Max agent loop iterations for the subagent */
  maxIterations: number;
  /** Tool filter to apply */
  toolFilter: ToolFilterType;
  /** Custom allow/deny lists when toolFilter is "custom" */
  allowedTools?: string[];
  deniedTools?: string[];
}

export interface SubagentResult {
  /** Whether the subagent completed successfully */
  success: boolean;
  /** The final text output from the subagent */
  output: string;
  /** Execution metadata */
  metadata: SubagentMetadata;
}

export interface SubagentMetadata {
  /** Number of agent loop iterations used */
  steps: number;
  /** Wall-clock duration in milliseconds */
  durationMs: number;
  /** Tool call counts by tool name */
  toolCalls: Record<string, number>;
  /** Whether any tool call errored */
  hadErrors: boolean;
}

export const DEFAULT_SUBAGENT_CONFIG: SubagentConfig = {
  maxIterations: 15,
  toolFilter: "readonly",
};
