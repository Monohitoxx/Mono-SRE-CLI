import type { Command, CommandContext } from "./types.js";

export const help: Command = {
  name: "help",
  description: "Show available commands and usage",
  isEnabled: true,
  execute: (ctx: CommandContext) => ({
    type: "message",
    content: [
      "Commands:",
      "  /clear  - Clear conversation",
      "  /root   - Toggle root mode (enable sudo)",
      "  /exit   - Exit SRE AI",
      "  /help   - Show this help",
      "",
      `Root mode: ${ctx.rootModeRef.current ? "ENABLED" : "DISABLED"}`,
      "",
      "Just type your question to interact with the AI agent.",
    ].join("\n"),
  }),
};
