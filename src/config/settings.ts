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

export interface CommandCheckResult {
  allowed: boolean;
  reason?: string;
}

export function isCommandAllowed(command: string, settings: Settings): boolean {
  return checkCommand(command, settings).allowed;
}

export function checkCommand(command: string, settings: Settings): CommandCheckResult {
  const { allow, deny } = settings.commands;
  const raw = command.trim();
  const normalized = raw.replace(/^\s*sudo\s+(-\S+\s+)*/, "").trim();

  // Deny list applies to the full command string
  for (const pattern of deny) {
    if (raw.includes(pattern) || normalized.includes(pattern)) {
      return { allowed: false, reason: `Matched deny pattern: "${pattern}"` };
    }
  }

  if (allow.length === 0) return { allowed: true };

  // Split compound commands (&&, ||, ;, |) and validate each segment
  const segments = normalized
    .split(/\s*(?:&&|\|\||[;|])\s*/)
    .filter((s) => s.length > 0);

  for (const segment of segments) {
    const seg = segment.replace(/^\s*sudo\s+(-\S+\s+)*/, "").trim();
    const binary = seg.split(/\s+/)[0] || seg;
    // Extract basename so "/home/user/bin/kafka-topics" matches allowlist "kafka-topics"
    const binaryName = binary.includes("/") ? binary.split("/").pop()! : binary;
    const matched = allow.some(
      (pattern) =>
        seg === pattern ||
        seg.startsWith(`${pattern} `) ||
        binaryName === pattern ||
        binaryName.startsWith(`${pattern} `),
    );
    if (!matched) {
      return {
        allowed: false,
        reason: `"${binaryName}" is not in the command allowlist. Run each command separately (no &&, ||, ;, |). Allowed commands include: ${allow.slice(0, 15).join(", ")}...`,
      };
    }
  }

  return { allowed: true };
}
