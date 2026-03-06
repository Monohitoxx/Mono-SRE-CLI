import * as fs from "node:fs";
import * as path from "node:path";
import { getMonoDir } from "../config/env.js";

const LOG_FILE = "mono-ai.log";

function getLogPath(): string {
  return path.join(getMonoDir(), LOG_FILE);
}

function timestamp(): string {
  return new Date().toISOString();
}

export function logDebug(message: string, ...args: unknown[]) {
  const line = `[${timestamp()}] DEBUG: ${message} ${args.length ? JSON.stringify(args) : ""}\n`;
  try {
    fs.appendFileSync(getLogPath(), line);
  } catch {
    // silent fail
  }
}

export function logError(message: string, error?: unknown) {
  const errStr = error instanceof Error ? error.message : String(error || "");
  const line = `[${timestamp()}] ERROR: ${message} ${errStr}\n`;
  try {
    fs.appendFileSync(getLogPath(), line);
  } catch {
    // silent fail
  }
}

export function logInfo(message: string) {
  const line = `[${timestamp()}] INFO: ${message}\n`;
  try {
    fs.appendFileSync(getLogPath(), line);
  } catch {
    // silent fail
  }
}
