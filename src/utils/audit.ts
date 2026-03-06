import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const SENSITIVE_KEY_RE =
  /(password|passwd|secret|token|api[_-]?key|private[_-]?key|authorization|cookie|credential)/i;
const TOKEN_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bghp_[A-Za-z0-9]{20,}\b/g,
  /\bBearer\s+[A-Za-z0-9._-]{16,}\b/gi,
];

interface AuditEntry {
  timestamp: string;
  sessionId: string;
  event: string;
  details: Record<string, unknown>;
}

export type AuditObserver = (entry: AuditEntry) => void;

export class AuditLogger {
  readonly sessionId: string;
  private filePath: string;
  private observers: AuditObserver[] = [];

  constructor(baseDir: string = ".mono") {
    this.sessionId = randomUUID().slice(0, 8);
    if (!existsSync(baseDir)) {
      mkdirSync(baseDir, { recursive: true });
    }
    this.filePath = join(baseDir, "audit.jsonl");
  }

  addObserver(fn: AuditObserver): void {
    this.observers.push(fn);
  }

  log(event: string, details: Record<string, unknown>): void {
    try {
      const entry: AuditEntry = {
        timestamp: new Date().toISOString(),
        sessionId: this.sessionId,
        event,
        details: redactValue(details) as Record<string, unknown>,
      };
      appendFileSync(this.filePath, JSON.stringify(entry) + "\n");
      for (const obs of this.observers) {
        try { obs(entry); } catch { /* never crash */ }
      }
    } catch {
      // Silent fail — never crash the CLI
    }
  }
}

function redactValue(value: unknown, keyHint?: string): unknown {
  if (keyHint && SENSITIVE_KEY_RE.test(keyHint)) {
    return "[REDACTED]";
  }

  if (typeof value === "string") {
    let result = value;
    for (const re of TOKEN_PATTERNS) {
      result = result.replace(re, "[REDACTED]");
    }
    return result;
  }

  if (Array.isArray(value)) {
    return value.map((v) => redactValue(v));
  }

  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactValue(v, k);
    }
    return out;
  }

  return value;
}
