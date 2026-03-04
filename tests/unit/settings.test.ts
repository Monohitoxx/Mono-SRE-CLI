/**
 * Unit tests for checkCommand (command allow/deny policy).
 * Covers: empty allowlist, deny list, allowlist enforcement,
 * sudo stripping, compound commands, and priority rules.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { checkCommand } from "../../src/config/settings.js";
import type { Settings } from "../../src/core/types.js";

function settings(allow: string[] = [], deny: string[] = []): Settings {
  return {
    commands: { allow, deny },
    ssh: { default_user: "root", known_hosts: "~/.ssh/known_hosts", timeout: 30000 },
  };
}

// ─── Empty allowlist (allow all) ─────────────────────────────────────────

describe("empty allowlist → every command is allowed", () => {
  test("ordinary read command", () => {
    assert.equal(checkCommand("df -h", settings()).allowed, true);
  });

  test("mutating command still allowed (policy not in settings)", () => {
    assert.equal(checkCommand("apt-get install nginx", settings()).allowed, true);
  });

  test("sudo command allowed when no list configured", () => {
    assert.equal(checkCommand("sudo shutdown -h now", settings()).allowed, true);
  });

  test("empty string is allowed", () => {
    assert.equal(checkCommand("", settings()).allowed, true);
  });
});

// ─── Deny list ────────────────────────────────────────────────────────────

describe("deny list blocks matching commands", () => {
  test("exact full-command match is blocked", () => {
    const r = checkCommand("rm -rf /", settings([], ["rm -rf /"]));
    assert.equal(r.allowed, false);
    assert.ok(r.reason?.includes("rm -rf /"), `Expected reason to mention pattern, got: ${r.reason}`);
  });

  test("partial substring match is blocked", () => {
    const r = checkCommand("rm -rf /var/log", settings([], ["rm -rf"]));
    assert.equal(r.allowed, false);
  });

  test("sudo-prefixed command is stripped before deny check", () => {
    // raw "sudo rm -rf /" includes "rm -rf /" → blocked
    const r = checkCommand("sudo rm -rf /", settings([], ["rm -rf /"]));
    assert.equal(r.allowed, false);
  });

  test("command NOT in deny list passes", () => {
    assert.equal(checkCommand("ls -la", settings([], ["rm -rf /"])).allowed, true);
  });

  test("multiple deny patterns: first match blocks", () => {
    const r = checkCommand("mkfs.ext4 /dev/sdb", settings([], ["rm -rf", "mkfs"]));
    assert.equal(r.allowed, false);
    assert.ok(r.reason?.includes("mkfs"));
  });
});

// ─── Allowlist enforcement ────────────────────────────────────────────────

describe("allowlist enforcement", () => {
  const allow = ["df", "ls", "cat", "ps", "free", "hostname"];

  test("allowed binary with flags passes", () => {
    assert.equal(checkCommand("df -h", settings(allow)).allowed, true);
  });

  test("allowed binary with path argument passes", () => {
    assert.equal(checkCommand("ls -la /etc", settings(allow)).allowed, true);
  });

  test("binary NOT in allowlist is blocked", () => {
    const r = checkCommand("curl https://example.com", settings(allow));
    assert.equal(r.allowed, false);
    assert.ok(r.reason?.includes("curl"), `Reason should name the blocked binary: ${r.reason}`);
    assert.ok(r.reason?.includes("allowlist"), `Reason should mention allowlist: ${r.reason}`);
  });

  test("apt-get not in allowlist → blocked", () => {
    const r = checkCommand("apt-get install nginx", settings(allow));
    assert.equal(r.allowed, false);
    assert.ok(r.reason?.includes("apt-get"));
  });

  test("wget not in allowlist → blocked", () => {
    assert.equal(checkCommand("wget https://example.com/file", settings(allow)).allowed, false);
  });

  test("rm not in allowlist → blocked", () => {
    assert.equal(checkCommand("rm -rf /tmp/old", settings(allow)).allowed, false);
  });
});

// ─── Sudo stripping in allowlist ─────────────────────────────────────────

describe("sudo prefix is stripped before allowlist check", () => {
  const allow = ["df", "ls"];

  test("sudo + allowed binary → allowed", () => {
    assert.equal(checkCommand("sudo df -h", settings(allow)).allowed, true);
  });

  test("sudo -u root: regex strips '-u ' but leaves 'root' as binary → blocked", () => {
    // stripLeadingSudo("sudo -u root ls /root") → "root ls /root"
    // binary = "root", which is not in allow list
    const r = checkCommand("sudo -u root ls /root", settings(allow));
    assert.equal(r.allowed, false);
    assert.ok(r.reason?.includes("root"), `Reason should name binary "root", got: ${r.reason}`);
  });

  test("sudo + disallowed binary → blocked", () => {
    const r = checkCommand("sudo curl https://evil.com", settings(allow));
    assert.equal(r.allowed, false);
    assert.ok(r.reason?.includes("curl"));
  });

  test("sudo + rm not in allowlist → blocked", () => {
    assert.equal(checkCommand("sudo rm -rf /tmp", settings(allow)).allowed, false);
  });
});

// ─── Compound commands ────────────────────────────────────────────────────

describe("compound commands — each segment validated", () => {
  const allow = ["df", "ls", "cat"];

  test("&& chain: both allowed → allowed", () => {
    // "df -h && ls /etc" → segments ["df -h", "ls /etc"] — both in allow
    assert.equal(checkCommand("df -h && ls /etc", settings(allow)).allowed, true);
  });

  test("&& chain: one disallowed → blocked", () => {
    const r = checkCommand("ls -la && curl https://evil.com", settings(allow));
    assert.equal(r.allowed, false);
    assert.ok(r.reason?.includes("curl"));
  });

  test("; chain: one disallowed → blocked", () => {
    const r = checkCommand("ls; rm -rf /", settings(allow));
    assert.equal(r.allowed, false);
    assert.ok(r.reason?.includes("rm"));
  });

  test("|| chain: one disallowed → blocked", () => {
    const r = checkCommand("df -h || wget https://evil.com", settings(allow));
    assert.equal(r.allowed, false);
  });

  test("pipe: both sides validated individually", () => {
    // "df -h | grep sda" → segments ["df -h", "grep sda"] → "grep" not in allow → blocked
    const r = checkCommand("df -h | grep sda", settings(allow));
    assert.equal(r.allowed, false);
    assert.ok(r.reason?.includes("grep"));
  });

  test("pipe: add grep to allow → passes", () => {
    assert.equal(
      checkCommand("df -h | grep sda", settings([...allow, "grep"])).allowed,
      true,
    );
  });
});

// ─── Deny takes priority over allow ──────────────────────────────────────

describe("deny list takes priority over allow list", () => {
  test("command in both allow and deny → blocked", () => {
    const r = checkCommand("df -h", settings(["df"], ["df"]));
    assert.equal(r.allowed, false);
    assert.ok(r.reason?.includes("df"));
  });

  test("deny pattern matching full command string wins", () => {
    // deny "rm -rf" — even if "rm" was somehow in allow
    const r = checkCommand("rm -rf /tmp", settings(["rm"], ["rm -rf"]));
    assert.equal(r.allowed, false);
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────────

describe("edge cases", () => {
  test("whitespace-only command with allowlist → allowed (empty after trim)", () => {
    // Split gives [""] after filter → no segments → passes
    assert.equal(checkCommand("   ", settings(["df"])).allowed, true);
  });

  test("command exactly matching allow pattern (no flags)", () => {
    assert.equal(checkCommand("df", settings(["df"])).allowed, true);
  });

  test("command that is a prefix of allowed but longer binary → blocked", () => {
    // allow = ["df"] but command is "dfu" → binary "dfu" !== "df" → blocked
    const r = checkCommand("dfu /dev/sda", settings(["df"]));
    assert.equal(r.allowed, false);
  });
});
