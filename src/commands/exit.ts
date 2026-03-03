import type { Command } from "./types.js";

export const exit: Command = {
  name: "exit",
  aliases: ["quit"],
  description: "Exit SRE AI",
  isEnabled: true,
  execute: () => ({ type: "action", action: "exit" }),
};
