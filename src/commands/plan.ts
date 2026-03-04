import type { Command } from "./types.js";

export const plan: Command = {
  name: "plan",
  description: "Toggle plan mode — forces deep reasoning and a to-do list before every task",
  isEnabled: true,
  execute: (ctx) => {
    const newState = !ctx.planModeRef.current;
    ctx.setPlanMode(newState);
    return {
      type: "message",
      content: newState
        ? "Plan mode ENABLED — every task will require a detailed plan with a to-do list before execution. Type /plan again to exit."
        : "Plan mode DISABLED — returning to normal mode.",
    };
  },
};
