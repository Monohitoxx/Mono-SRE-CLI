import type { ToolRegistry } from "../tools/registry.js";

export type CommandResult =
  | { type: "message"; content: string }
  | { type: "action"; action: "exit" | "clear" | "compact" | "resume" }
  | null;

export interface CommandContext {
  toolRegistry: ToolRegistry;
  rootModeRef: { current: boolean };
  setRootMode: (enabled: boolean) => void;
  planModeRef: { current: boolean };
  setPlanMode: (enabled: boolean) => void;
}

export interface Command {
  name: string;
  aliases?: string[];
  description: string;
  isEnabled: boolean;
  execute: (ctx: CommandContext, args: string) => CommandResult;
}
