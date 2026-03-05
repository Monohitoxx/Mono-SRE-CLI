import { z } from "zod";

export const ProviderName = z.enum(["openai", "anthropic"]);
export type ProviderName = z.infer<typeof ProviderName>;

export const EnvConfigSchema = z.object({
  PROVIDER: ProviderName,
  MODEL: z.string().min(1),
  APIKEY: z.string().default(""),
  API_BASE_URL: z.string().optional(),

  TEMPERATURE: z.number().min(0).max(2).optional(),
  TOP_P: z.number().min(0).max(1).optional(),
  TOP_K: z.number().int().optional(),
  MAX_TOKENS: z.number().int().positive().optional(),
  REPETITION_PENALTY: z.number().min(0).optional(),
  FREQUENCY_PENALTY: z.number().min(-2).max(2).optional(),
  PRESENCE_PENALTY: z.number().min(-2).max(2).optional(),
  SEED: z.number().int().optional(),

  CONTEXT_LIMIT: z.number().int().positive().default(131072),

  SHOW_FLOW: z.boolean().default(false),
  ENABLE_THINKING: z.boolean().default(false),
  DEBUG_STREAM: z.boolean().default(false),
});
export type EnvConfig = z.infer<typeof EnvConfigSchema>;

export const CommandPolicySchema = z.object({
  allow: z.array(z.string()).default([]),
  deny: z.array(z.string()).default([]),
});

export const SSHSettingsSchema = z.object({
  default_user: z.string().default("root"),
  known_hosts: z.string().default("~/.ssh/known_hosts"),
  timeout: z.number().default(30000),
});

export const SettingsSchema = z.object({
  commands: CommandPolicySchema.default({}),
  ssh: SSHSettingsSchema.default({}),
});
export type Settings = z.infer<typeof SettingsSchema>;

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  content: string;
  isError?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export type StreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "reasoning_delta"; text: string }
  | { type: "thinking_boundary" }
  | { type: "tool_call_start"; toolCall: ToolCall }
  | { type: "tool_call_delta"; toolCallId: string; arguments: string }
  | { type: "tool_call_end"; toolCall: ToolCall }
  | { type: "usage"; usage: TokenUsage }
  | { type: "done"; message: Message }
  | { type: "error"; error: string };

export interface SkillDefinition {
  name: string;
  description: string;
  body: string;
  location: string;
}
