import type { Command } from "./types.js";

export const compact: Command = {
  name: "compact",
  description: "Compact conversation history (summarize to reduce tokens)",
  isEnabled: true,
  execute: () => ({ type: "action", action: "compact" }),
};
