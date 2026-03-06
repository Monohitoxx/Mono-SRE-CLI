import * as fs from "node:fs";
import * as path from "node:path";
import { getMonoDir } from "../config/env.js";

let enabled = false;
let logPath = "";
let seq = 0;

export function initStreamDebug(enable: boolean) {
  enabled = enable;
  if (enabled) {
    logPath = path.join(getMonoDir(), "stream-debug.log");
    try { fs.writeFileSync(logPath, ""); } catch {}
  }
}

export function streamDebugNewRequest() {
  if (!enabled) return;
  seq = 0;
  const sep = "\n" + "=".repeat(80) + "\n";
  try {
    fs.appendFileSync(logPath, `${sep}[${new Date().toISOString()}] NEW STREAM REQUEST\n${sep}`);
  } catch {}
}

export function sd(label: string, data?: unknown) {
  if (!enabled) return;
  seq++;
  const line = data !== undefined
    ? `[${seq}] ${label}: ${JSON.stringify(data)}\n`
    : `[${seq}] ${label}\n`;
  try { fs.appendFileSync(logPath, line); } catch {}
}
