import type { Command, CommandContext, CommandResult } from "./types.js";
import { clear } from "./clear.js";
import { exit } from "./exit.js";
import { root } from "./root.js";
import { help } from "./help.js";
import { init } from "./init.js";
import { plan } from "./plan.js";

const COMMANDS: Command[] = [clear, exit, root, help, init, plan];

export function getCommands(): Command[] {
  return COMMANDS.filter((c) => c.isEnabled);
}

export function processCommand(
  input: string,
  ctx: CommandContext,
): CommandResult | undefined {
  if (!input.startsWith("/")) return undefined;

  const raw = input.slice(1).trim();
  const spaceIdx = raw.indexOf(" ");
  const name = spaceIdx === -1 ? raw.toLowerCase() : raw.slice(0, spaceIdx).toLowerCase();
  const args = spaceIdx === -1 ? "" : raw.slice(spaceIdx + 1).trim();

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

  return command.execute(ctx, args);
}

export type { Command, CommandContext, CommandResult } from "./types.js";
