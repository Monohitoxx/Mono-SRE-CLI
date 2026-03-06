import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { Message } from "../core/types.js";
import type { ChatMessage } from "../ui/ChatView.js";

const SESSIONS_DIR = path.join(process.cwd(), ".mono", "sessions");

// Only allow safe characters in session IDs (alphanumeric, dash, underscore)
const SAFE_ID_RE = /^[a-zA-Z0-9_-]+$/;

// Redact sensitive content in stored messages
const SENSITIVE_KEY_RE =
  /(password|passwd|secret|token|api[_-]?key|private[_-]?key|authorization|cookie|credential)/i;
const TOKEN_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bghp_[A-Za-z0-9]{20,}\b/g,
  /\bBearer\s+[A-Za-z0-9._-]{16,}\b/gi,
];

export interface SessionData {
  id: string;
  createdAt: string;
  updatedAt: string;
  preview: string;
  messageCount: number;
  conversationMessages: Message[];
  chatMessages: ChatMessage[];
}

export interface SessionInfo {
  id: string;
  updatedAt: string;
  preview: string;
  messageCount: number;
}

function ensureSessionsDir() {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true, mode: 0o700 });
}

/** Validate session ID is safe (no path traversal) */
function validateId(id: string): boolean {
  return SAFE_ID_RE.test(id);
}

/** Resolve session file path with path traversal guard */
function resolveSessionPath(id: string): string | null {
  if (!validateId(id)) return null;
  const filePath = path.resolve(SESSIONS_DIR, `${id}.json`);
  // Double-check the resolved path is still inside SESSIONS_DIR
  if (!filePath.startsWith(path.resolve(SESSIONS_DIR) + path.sep)) return null;
  return filePath;
}

/** Redact sensitive tokens from a string */
function redactString(value: string): string {
  let result = value;
  for (const re of TOKEN_PATTERNS) {
    result = result.replace(re, "[REDACTED]");
  }
  return result;
}

/** Redact sensitive fields in tool call arguments */
function redactArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (SENSITIVE_KEY_RE.test(k)) {
      out[k] = "[REDACTED]";
    } else if (typeof v === "string") {
      out[k] = redactString(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Redact sensitive content in messages before persisting */
function redactMessages<T extends { content: string; toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }> }>(
  messages: T[],
): T[] {
  return messages.map((m) => {
    const redacted = { ...m, content: redactString(m.content) };
    if (redacted.toolCalls) {
      redacted.toolCalls = redacted.toolCalls.map((tc) => ({
        ...tc,
        arguments: redactArgs(tc.arguments),
      }));
    }
    return redacted;
  });
}

function extractPreview(chatMessages: ChatMessage[]): string {
  const firstUser = chatMessages.find((m) => m.role === "user");
  if (!firstUser) return "(empty session)";
  const text = firstUser.content.trim();
  return text.length > 60 ? text.slice(0, 57) + "..." : text;
}

/** Validate loaded session data has expected shape */
function isValidSessionData(data: unknown): data is SessionData {
  if (data === null || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.id === "string" &&
    validateId(d.id) &&
    typeof d.createdAt === "string" &&
    typeof d.updatedAt === "string" &&
    typeof d.preview === "string" &&
    typeof d.messageCount === "number" &&
    Array.isArray(d.conversationMessages) &&
    Array.isArray(d.chatMessages)
  );
}

export function generateSessionId(): string {
  return `session-${crypto.randomBytes(8).toString("hex")}`;
}

export function saveSession(
  id: string,
  conversationMessages: Message[],
  chatMessages: ChatMessage[],
): void {
  const filePath = resolveSessionPath(id);
  if (!filePath) return; // Invalid id, refuse to write

  ensureSessionsDir();
  const now = new Date().toISOString();

  // Try to read existing session for createdAt
  let createdAt = now;
  try {
    const existing = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (typeof existing.createdAt === "string") createdAt = existing.createdAt;
  } catch {
    // New session
  }

  const redactedConv = redactMessages(conversationMessages);
  const redactedChat = redactMessages(chatMessages);

  const data: SessionData = {
    id,
    createdAt,
    updatedAt: now,
    preview: extractPreview(redactedChat),
    messageCount: chatMessages.length,
    conversationMessages: redactedConv,
    chatMessages: redactedChat,
  };

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  // Ensure file is only readable by owner
  fs.chmodSync(filePath, 0o600);
}

export function listSessions(): SessionInfo[] {
  ensureSessionsDir();
  const files = fs.readdirSync(SESSIONS_DIR).filter((f) => f.endsWith(".json"));

  const sessions: SessionInfo[] = [];
  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(SESSIONS_DIR, file), "utf-8");
      const data = JSON.parse(raw);
      if (!isValidSessionData(data)) continue; // Skip invalid/tampered files
      sessions.push({
        id: data.id,
        updatedAt: data.updatedAt,
        preview: data.preview,
        messageCount: data.messageCount,
      });
    } catch {
      // Skip corrupt files
    }
  }

  // Sort by updatedAt descending (newest first)
  sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return sessions;
}

export function loadSession(id: string): SessionData | null {
  const filePath = resolveSessionPath(id);
  if (!filePath) return null; // Invalid id, refuse to read

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw);
    if (!isValidSessionData(data)) return null;
    return data;
  } catch {
    return null;
  }
}

export function pruneOldSessions(maxKeep: number): void {
  const sessions = listSessions(); // listSessions already validates IDs
  if (sessions.length <= maxKeep) return;

  const toRemove = sessions.slice(maxKeep);
  for (const session of toRemove) {
    // Use resolveSessionPath for safe deletion (re-validates id)
    const filePath = resolveSessionPath(session.id);
    if (!filePath) continue;
    try {
      fs.unlinkSync(filePath);
    } catch {
      // Ignore removal errors
    }
  }
}
