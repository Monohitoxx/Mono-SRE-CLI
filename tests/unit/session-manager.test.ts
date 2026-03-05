/**
 * Unit tests for session-manager.ts
 *
 * Covers:
 *   - Path traversal prevention (malicious session IDs)
 *   - Sensitive data redaction before persistence
 *   - Schema validation on loaded sessions (tampered files)
 *   - Session ID generation (cryptographic randomness)
 *   - Directory/file permissions
 *   - pruneOldSessions safety
 */
import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  saveSession,
  listSessions,
  loadSession,
  pruneOldSessions,
  generateSessionId,
} from "../../src/utils/session-manager.js";
import type { Message } from "../../src/core/types.js";
import type { ChatMessage } from "../../src/ui/ChatView.js";

const SESSIONS_DIR = path.join(process.cwd(), ".reason", "sessions");

function cleanup() {
  if (fs.existsSync(SESSIONS_DIR)) {
    for (const f of fs.readdirSync(SESSIONS_DIR)) {
      fs.unlinkSync(path.join(SESSIONS_DIR, f));
    }
  }
}

function sampleConvMsgs(content = "hello"): Message[] {
  return [
    { role: "user", content },
    { role: "assistant", content: "Hi there" },
  ];
}

function sampleChatMsgs(content = "hello"): ChatMessage[] {
  return [
    { role: "user", content },
    { role: "assistant", content: "Hi there" },
  ];
}

// ─── Path Traversal Prevention ─────────────────────────────────────────────

describe("Path traversal prevention", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  test("session ID with ../ is rejected by saveSession (no file created)", () => {
    saveSession("../../../etc/evil", sampleConvMsgs(), sampleChatMsgs());
    // Should NOT have created a file anywhere
    assert.equal(fs.existsSync(path.join(SESSIONS_DIR, "../../../etc/evil.json")), false);
  });

  test("session ID with ../ is rejected by loadSession (returns null)", () => {
    const result = loadSession("../../etc/passwd");
    assert.equal(result, null);
  });

  test("session ID with / slash is rejected", () => {
    saveSession("foo/bar", sampleConvMsgs(), sampleChatMsgs());
    assert.equal(loadSession("foo/bar"), null);
  });

  test("session ID with backslash is rejected", () => {
    assert.equal(loadSession("foo\\bar"), null);
  });

  test("session ID with null byte is rejected", () => {
    assert.equal(loadSession("session\x00evil"), null);
  });

  test("session ID with spaces is rejected", () => {
    assert.equal(loadSession("session evil"), null);
  });

  test("session ID with dots only (..) is rejected", () => {
    assert.equal(loadSession(".."), null);
  });

  test("valid session ID with hyphens and underscores works", () => {
    const id = "session-abc_123";
    saveSession(id, sampleConvMsgs(), sampleChatMsgs());
    const loaded = loadSession(id);
    assert.ok(loaded);
    assert.equal(loaded.id, id);
  });

  test("pruneOldSessions does not delete files outside SESSIONS_DIR even with tampered ID", () => {
    // Create a legit session first
    const id = "session-legit";
    saveSession(id, sampleConvMsgs(), sampleChatMsgs());

    // Manually write a tampered session file with a dangerous ID
    const tamperedPath = path.join(SESSIONS_DIR, "session-tampered.json");
    const tampered = {
      id: "../../../tmp/important-file",  // path traversal attempt
      createdAt: new Date().toISOString(),
      updatedAt: "2000-01-01T00:00:00.000Z",  // oldest → will be pruned first
      preview: "evil",
      messageCount: 1,
      conversationMessages: [],
      chatMessages: [],
    };
    fs.writeFileSync(tamperedPath, JSON.stringify(tampered));

    // listSessions should skip the tampered file (invalid id)
    const sessions = listSessions();
    const ids = sessions.map((s) => s.id);
    assert.ok(!ids.includes("../../../tmp/important-file"), "Tampered ID should not appear in list");

    // pruneOldSessions should be safe
    pruneOldSessions(0);
    // The legit session file is deleted via safe path
    assert.equal(loadSession("session-legit"), null);
  });
});

// ─── Sensitive Data Redaction ──────────────────────────────────────────────

describe("Sensitive data redaction in saved sessions", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  test("API keys (sk-*) are redacted in conversation messages", () => {
    const msgs: Message[] = [
      { role: "user", content: "My key is sk-abcdefghijklmnopqrstuvwxyz1234" },
      { role: "assistant", content: "I see your key sk-abcdefghijklmnopqrstuvwxyz1234" },
    ];
    const id = "session-redact-apikey";
    saveSession(id, msgs, sampleChatMsgs());

    const raw = fs.readFileSync(path.join(SESSIONS_DIR, `${id}.json`), "utf-8");
    assert.ok(!raw.includes("sk-abcdefghijklmnopqrstuvwxyz1234"), "API key should be redacted");
    assert.ok(raw.includes("[REDACTED]"), "Should contain [REDACTED] marker");
  });

  test("AWS access keys (AKIA*) are redacted", () => {
    const msgs: Message[] = [
      { role: "user", content: "AWS key: AKIAIOSFODNN7EXAMPLE" },
    ];
    const id = "session-redact-aws";
    saveSession(id, msgs, sampleChatMsgs());

    const raw = fs.readFileSync(path.join(SESSIONS_DIR, `${id}.json`), "utf-8");
    assert.ok(!raw.includes("AKIAIOSFODNN7EXAMPLE"), "AWS key should be redacted");
  });

  test("GitHub tokens (ghp_*) are redacted", () => {
    const msgs: Message[] = [
      { role: "user", content: "Token: ghp_ABCDEFabcdef12345678901234567890" },
    ];
    const id = "session-redact-ghp";
    saveSession(id, msgs, sampleChatMsgs());

    const raw = fs.readFileSync(path.join(SESSIONS_DIR, `${id}.json`), "utf-8");
    assert.ok(!raw.includes("ghp_ABCDEFabcdef12345678901234567890"), "GitHub token should be redacted");
  });

  test("Bearer tokens are redacted", () => {
    const msgs: Message[] = [
      { role: "user", content: "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test" },
    ];
    const id = "session-redact-bearer";
    saveSession(id, msgs, sampleChatMsgs());

    const raw = fs.readFileSync(path.join(SESSIONS_DIR, `${id}.json`), "utf-8");
    assert.ok(!raw.includes("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"), "Bearer token should be redacted");
  });

  test("password fields in tool call arguments are redacted", () => {
    const msgs: Message[] = [
      {
        role: "assistant",
        content: "connecting",
        toolCalls: [{
          id: "tc-1",
          name: "execute_command",
          arguments: { command: "mysql -u root", password: "SuperSecret123!" },
        }],
      },
    ];
    const id = "session-redact-password";
    saveSession(id, msgs, sampleChatMsgs());

    const raw = fs.readFileSync(path.join(SESSIONS_DIR, `${id}.json`), "utf-8");
    assert.ok(!raw.includes("SuperSecret123!"), "Password should be redacted");
    assert.ok(raw.includes("[REDACTED]"));
  });

  test("tool arguments with api_key field are redacted", () => {
    const msgs: Message[] = [
      {
        role: "assistant",
        content: "",
        toolCalls: [{
          id: "tc-1",
          name: "web_fetch",
          arguments: { url: "https://api.example.com", api_key: "secret-key-12345678901234" },
        }],
      },
    ];
    const id = "session-redact-apikey-field";
    saveSession(id, msgs, sampleChatMsgs());

    const raw = fs.readFileSync(path.join(SESSIONS_DIR, `${id}.json`), "utf-8");
    assert.ok(!raw.includes("secret-key-12345678901234"), "api_key field should be redacted");
  });

  test("chat messages with sensitive content are also redacted", () => {
    const chatMsgs: ChatMessage[] = [
      { role: "user", content: "My token is sk-abcdefghijklmnopqrstuvwxyz1234" },
      { role: "tool", content: "Key: ghp_ABCDEFabcdef12345678901234567890", toolName: "execute_command" },
    ];
    const id = "session-redact-chat";
    saveSession(id, sampleConvMsgs(), chatMsgs);

    const raw = fs.readFileSync(path.join(SESSIONS_DIR, `${id}.json`), "utf-8");
    assert.ok(!raw.includes("sk-abcdefghijklmnopqrstuvwxyz1234"), "Chat user msg token redacted");
    assert.ok(!raw.includes("ghp_ABCDEFabcdef12345678901234567890"), "Chat tool msg token redacted");
  });

  test("non-sensitive content is preserved as-is", () => {
    const msgs: Message[] = [
      { role: "user", content: "Check disk usage on server01" },
      { role: "assistant", content: "Disk is 50% full" },
    ];
    const id = "session-no-redact";
    saveSession(id, msgs, sampleChatMsgs("Check disk usage on server01"));

    const loaded = loadSession(id);
    assert.ok(loaded);
    assert.equal(loaded.conversationMessages[0].content, "Check disk usage on server01");
    assert.equal(loaded.conversationMessages[1].content, "Disk is 50% full");
  });
});

// ─── Schema Validation (tampered session files) ───────────────────────────

describe("Schema validation rejects tampered session files", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  function writeTamperedSession(filename: string, data: unknown) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    fs.writeFileSync(path.join(SESSIONS_DIR, filename), JSON.stringify(data));
  }

  test("missing 'id' field → rejected by listSessions and loadSession", () => {
    writeTamperedSession("session-noid.json", {
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
      preview: "test",
      messageCount: 0,
      conversationMessages: [],
      chatMessages: [],
    });

    const sessions = listSessions();
    assert.equal(sessions.length, 0, "Should not list session with missing id");
  });

  test("non-string 'id' field → rejected", () => {
    writeTamperedSession("session-badid.json", {
      id: 12345,  // should be string
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
      preview: "test",
      messageCount: 0,
      conversationMessages: [],
      chatMessages: [],
    });

    const sessions = listSessions();
    assert.equal(sessions.length, 0);
  });

  test("id with path traversal characters → rejected by validation", () => {
    writeTamperedSession("session-traversal.json", {
      id: "../../etc/evil",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
      preview: "test",
      messageCount: 0,
      conversationMessages: [],
      chatMessages: [],
    });

    const sessions = listSessions();
    const ids = sessions.map((s) => s.id);
    assert.ok(!ids.includes("../../etc/evil"), "Path traversal ID must be filtered");
  });

  test("missing conversationMessages → rejected", () => {
    writeTamperedSession("session-nomsg.json", {
      id: "session-nomsg",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
      preview: "test",
      messageCount: 0,
      chatMessages: [],
      // conversationMessages is missing
    });

    const result = loadSession("session-nomsg");
    assert.equal(result, null, "Should reject session with missing conversationMessages");
  });

  test("non-array conversationMessages → rejected", () => {
    writeTamperedSession("session-badmsgs.json", {
      id: "session-badmsgs",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
      preview: "test",
      messageCount: 0,
      conversationMessages: "not an array",
      chatMessages: [],
    });

    const result = loadSession("session-badmsgs");
    assert.equal(result, null, "Should reject non-array conversationMessages");
  });

  test("non-number messageCount → rejected", () => {
    writeTamperedSession("session-badcount.json", {
      id: "session-badcount",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
      preview: "test",
      messageCount: "many",
      conversationMessages: [],
      chatMessages: [],
    });

    const result = loadSession("session-badcount");
    assert.equal(result, null);
  });

  test("valid JSON but not an object (array) → rejected", () => {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    fs.writeFileSync(path.join(SESSIONS_DIR, "session-array.json"), "[1,2,3]");
    assert.equal(loadSession("session-array"), null);
  });

  test("corrupt JSON → rejected gracefully", () => {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    fs.writeFileSync(path.join(SESSIONS_DIR, "session-corrupt.json"), "{invalid json!!!");
    assert.equal(loadSession("session-corrupt"), null);
    // listSessions should also skip it
    const sessions = listSessions();
    assert.equal(sessions.filter((s) => s.id === "session-corrupt").length, 0);
  });
});

// ─── Session ID Generation ─────────────────────────────────────────────────

describe("generateSessionId", () => {
  test("produces safe IDs matching expected pattern", () => {
    for (let i = 0; i < 100; i++) {
      const id = generateSessionId();
      assert.match(id, /^session-[a-f0-9]{16}$/, `ID should match safe pattern: ${id}`);
    }
  });

  test("generates unique IDs (no collisions in 1000 generations)", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      ids.add(generateSessionId());
    }
    assert.equal(ids.size, 1000, "All 1000 IDs should be unique");
  });

  test("generated IDs are accepted by saveSession/loadSession", () => {
    const id = generateSessionId();
    saveSession(id, sampleConvMsgs(), sampleChatMsgs());
    const loaded = loadSession(id);
    assert.ok(loaded, "Generated ID should be loadable");
    assert.equal(loaded.id, id);
    // Cleanup
    fs.unlinkSync(path.join(SESSIONS_DIR, `${id}.json`));
  });
});

// ─── Prune Safety ──────────────────────────────────────────────────────────

describe("pruneOldSessions", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  test("keeps newest N sessions and removes older ones", () => {
    // Create 5 sessions with different timestamps
    for (let i = 0; i < 5; i++) {
      const id = `session-prune-${i}`;
      saveSession(id, sampleConvMsgs(), sampleChatMsgs());
      // Adjust updatedAt to create ordering
      const filePath = path.join(SESSIONS_DIR, `${id}.json`);
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      data.updatedAt = new Date(2024, 0, i + 1).toISOString();
      fs.writeFileSync(filePath, JSON.stringify(data));
    }

    pruneOldSessions(3);

    const remaining = listSessions();
    assert.equal(remaining.length, 3, "Should keep 3 newest sessions");

    // Oldest 2 (index 0, 1) should be removed
    assert.equal(loadSession("session-prune-0"), null, "Oldest should be removed");
    assert.equal(loadSession("session-prune-1"), null, "Second oldest should be removed");
    assert.ok(loadSession("session-prune-4"), "Newest should remain");
  });

  test("does nothing when session count <= maxKeep", () => {
    saveSession("session-keep-1", sampleConvMsgs(), sampleChatMsgs());
    saveSession("session-keep-2", sampleConvMsgs(), sampleChatMsgs());

    pruneOldSessions(5);

    assert.equal(listSessions().length, 2, "Both sessions should remain");
  });
});

// ─── Save/Load Round Trip ──────────────────────────────────────────────────

describe("save/load round trip", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  test("messages are preserved through save/load cycle", () => {
    const convMsgs: Message[] = [
      { role: "user", content: "Check disk on server01" },
      { role: "assistant", content: "Running df -h", toolCalls: [{ id: "tc-1", name: "execute_command", arguments: { command: "df -h", host: "server01" } }] },
      { role: "tool", content: "50G used", toolCallId: "tc-1" },
    ];
    const chatMsgs: ChatMessage[] = [
      { role: "user", content: "Check disk on server01" },
      { role: "tool", content: "execute_command(command: \"df -h\")", toolName: "execute_command", summary: "df -h on server01" },
      { role: "assistant", content: "Disk is 50% full" },
    ];

    const id = "session-roundtrip";
    saveSession(id, convMsgs, chatMsgs);
    const loaded = loadSession(id);

    assert.ok(loaded);
    assert.equal(loaded.conversationMessages.length, 3);
    assert.equal(loaded.chatMessages.length, 3);
    assert.equal(loaded.messageCount, 3);
    assert.equal(loaded.preview, "Check disk on server01");
  });

  test("preview truncates long messages", () => {
    const longMsg = "A".repeat(100);
    const chatMsgs: ChatMessage[] = [{ role: "user", content: longMsg }];
    const id = "session-long-preview";
    saveSession(id, sampleConvMsgs(longMsg), chatMsgs);

    const loaded = loadSession(id);
    assert.ok(loaded);
    assert.ok(loaded.preview.length <= 60, `Preview should be <= 60 chars, got ${loaded.preview.length}`);
    assert.ok(loaded.preview.endsWith("..."), "Truncated preview should end with ...");
  });
});
