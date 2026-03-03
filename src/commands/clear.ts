import type { Command } from "./types.js";

export const clear: Command = {
  name: "clear",
  description: "Clear conversation history",
  isEnabled: true,
  execute: () => ({ type: "action", action: "clear" }),
};
