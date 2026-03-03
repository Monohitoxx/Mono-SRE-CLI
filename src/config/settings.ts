import * as fs from "node:fs";
import * as path from "node:path";
import { SettingsSchema, type Settings } from "../core/types.js";
import { getReasonDir } from "./env.js";

export function loadSettings(): Settings {
  const settingsPath = path.join(getReasonDir(), "settings.json");

  if (!fs.existsSync(settingsPath)) {
    return SettingsSchema.parse({});
  }

  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    return SettingsSchema.parse(raw);
  } catch {
    return SettingsSchema.parse({});
  }
}

export function isCommandAllowed(command: string, settings: Settings): boolean {
  const { allow, deny } = settings.commands;

  for (const pattern of deny) {
    if (command.includes(pattern)) return false;
  }

  if (allow.length === 0) return true;

  for (const pattern of allow) {
    if (command.startsWith(pattern)) return true;
  }

  return false;
}
