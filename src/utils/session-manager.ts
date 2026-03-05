import fs from "node:fs";
import path from "node:path";
import type { Message } from "../core/types.js";
import type { ChatMessage } from "../ui/ChatView.js";

const SESSIONS_DIR = path.join(process.cwd(), ".reason", "sessions");

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
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

function extractPreview(chatMessages: ChatMessage[]): string {
  const firstUser = chatMessages.find((m) => m.role === "user");
  if (!firstUser) return "(empty session)";
  const text = firstUser.content.trim();
  return text.length > 60 ? text.slice(0, 57) + "..." : text;
}

export function saveSession(
  id: string,
  conversationMessages: Message[],
  chatMessages: ChatMessage[],
): void {
  ensureSessionsDir();
  const filePath = path.join(SESSIONS_DIR, `${id}.json`);
  const now = new Date().toISOString();

  // Try to read existing session for createdAt
  let createdAt = now;
  try {
    const existing = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (existing.createdAt) createdAt = existing.createdAt;
  } catch {
    // New session
  }

  const data: SessionData = {
    id,
    createdAt,
    updatedAt: now,
    preview: extractPreview(chatMessages),
    messageCount: chatMessages.length,
    conversationMessages,
    chatMessages,
  };

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

export function listSessions(): SessionInfo[] {
  ensureSessionsDir();
  const files = fs.readdirSync(SESSIONS_DIR).filter((f) => f.endsWith(".json"));

  const sessions: SessionInfo[] = [];
  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(SESSIONS_DIR, file), "utf-8");
      const data = JSON.parse(raw) as SessionData;
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
  const filePath = path.join(SESSIONS_DIR, `${id}.json`);
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as SessionData;
  } catch {
    return null;
  }
}

export function pruneOldSessions(maxKeep: number): void {
  const sessions = listSessions();
  if (sessions.length <= maxKeep) return;

  const toRemove = sessions.slice(maxKeep);
  for (const session of toRemove) {
    const filePath = path.join(SESSIONS_DIR, `${session.id}.json`);
    try {
      fs.unlinkSync(filePath);
    } catch {
      // Ignore removal errors
    }
  }
}
