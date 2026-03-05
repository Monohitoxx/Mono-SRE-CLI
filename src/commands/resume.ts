import type { Command } from "./types.js";

export const resume: Command = {
  name: "resume",
  description: "Resume a previous session",
  isEnabled: true,
  execute: () => ({ type: "action", action: "resume" }),
};
