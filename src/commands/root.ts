import type { Command } from "./types.js";

export const root: Command = {
  name: "root",
  description: "Toggle root mode (enable/disable sudo privileges)",
  isEnabled: true,
  execute: (ctx) => {
    const newState = !ctx.rootModeRef.current;
    ctx.setRootMode(newState);
    ctx.toolRegistry.setRootEnabled(newState);
    return {
      type: "message",
      content: newState
        ? "Root mode ENABLED - sudo commands will be allowed."
        : "Root mode DISABLED - sudo commands will require approval.",
    };
  },
};
