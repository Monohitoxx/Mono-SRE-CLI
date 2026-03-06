import type { Command } from "./types.js";

export const exit: Command = {
  name: "exit",
  aliases: ["quit"],
  description: "Exit Mono",
  isEnabled: true,
  execute: () => ({ type: "action", action: "exit" }),
};
