import type { Command, CommandContext, CommandResult } from "./types.js";
import { clear } from "./clear.js";
import { exit } from "./exit.js";
import { root } from "./root.js";
import { help } from "./help.js";

const COMMANDS: Command[] = [clear, exit, root, help];

export function getCommands(): Command[] {
  return COMMANDS.filter((c) => c.isEnabled);
}

export function processCommand(
  input: string,
  ctx: CommandContext,
): CommandResult | undefined {
  if (!input.startsWith("/")) return undefined;

  const name = input.slice(1).trim().toLowerCase();
  const command = COMMANDS.find(
    (c) => c.name === name || c.aliases?.includes(name),
  );

  if (!command) {
    return {
      type: "message",
      content: `Unknown command: ${input}. Type /help for available commands.`,
    };
  }

  if (!command.isEnabled) {
    return {
      type: "message",
      content: `Command ${input} is currently disabled.`,
    };
  }

  return command.execute(ctx);
}

export type { Command, CommandContext, CommandResult } from "./types.js";
