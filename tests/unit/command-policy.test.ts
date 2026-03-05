/**
 * Unit tests for command-policy-utils:
 * extractBinary, stripLeadingSudo, isPermissionErrorText,
 * isManagedSystemctlMutatingCommand.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  extractBinary,
  stripLeadingSudo,
  isPermissionErrorText,
  isManagedSystemctlMutatingCommand,
} from "../../src/core/command-policy-utils.js";

// ─── extractBinary ────────────────────────────────────────────────────────

describe("extractBinary", () => {
  test("simple command with flags", () => assert.equal(extractBinary("df -h"), "df"));
  test("command with multiple flags", () => assert.equal(extractBinary("ps aux -e"), "ps"));
  test("absolute path command", () => assert.equal(extractBinary("/usr/bin/df -h"), "/usr/bin/df"));
  test("relative path command", () => assert.equal(extractBinary("./my-script.sh arg"), "./my-script.sh"));
  test("leading whitespace stripped", () => assert.equal(extractBinary("  ls -la"), "ls"));
  test("single word (no args)", () => assert.equal(extractBinary("nginx"), "nginx"));
  test("empty string returns empty", () => assert.equal(extractBinary(""), ""));
  test("tabs as separator", () => assert.equal(extractBinary("df\t-h"), "df"));
});

// ─── stripLeadingSudo ─────────────────────────────────────────────────────

describe("stripLeadingSudo", () => {
  test("strips plain sudo", () => assert.equal(stripLeadingSudo("sudo df -h"), "df -h"));
  // regex strips "-u " flag but NOT its argument ("root"), leaving "root df -h"
  test("strips sudo -u flag (argument remains)", () => assert.equal(stripLeadingSudo("sudo -u root df -h"), "root df -h"));
  test("strips sudo -n flag", () => assert.equal(stripLeadingSudo("sudo -n ls"), "ls"));
  test("no sudo → unchanged", () => assert.equal(stripLeadingSudo("df -h"), "df -h"));
  test("leading whitespace stripped", () => assert.equal(stripLeadingSudo("  sudo df -h"), "df -h"));
  test("sudo with just command word", () => assert.equal(stripLeadingSudo("sudo nginx"), "nginx"));
  test("double sudo stripped once", () => {
    // Only leading sudo is stripped; inner sudo remains
    assert.equal(stripLeadingSudo("sudo sudo apt-get install nginx"), "sudo apt-get install nginx");
  });
});

// ─── isPermissionErrorText ────────────────────────────────────────────────

describe("isPermissionErrorText — truthy cases", () => {
  const truthy = [
    "permission denied",
    "PERMISSION DENIED",
    "bash: /etc/hosts: Permission denied",
    "operation not permitted",
    "Operation Not Permitted",
    "access denied",
    "Access Denied for user 'root'@'localhost'",
    "interactive authentication required",
    "authentication is required to reload 'org.freedesktop.systemd1'",
    "must be root",
    "Error: must be root to run",
    "not in the sudoers file. This incident will be reported.",
    // dnf/rpm/yum on RHEL/CentOS/Fedora
    "Error: This command has to be run with superuser privileges (under the root user on most systems).",
    "Error: This command has to be run with superuser privileges",
    "This operation requires superuser privileges",
    "you need to run as root",
    "requires root access to proceed",
    // multi-line output ending with permission error
    "Reading file contents...\nbash: /var/log/secure: permission denied",
  ];

  for (const text of truthy) {
    test(`detects: "${text.slice(0, 60)}"`, () => {
      assert.equal(isPermissionErrorText(text), true, `Should detect permission error in: "${text}"`);
    });
  }
});

describe("isPermissionErrorText — falsy cases (not a permission error)", () => {
  const falsy = [
    "",
    "success",
    "command not found",
    "no such file or directory",
    "connection refused",
    "timeout",
    "disk full",
    "Error: package not found",
    "WARNING: running as root",
    "0 upgraded, 1 newly installed",
  ];

  for (const text of falsy) {
    test(`not a permission error: "${text.slice(0, 60)}"`, () => {
      assert.equal(isPermissionErrorText(text), false, `Should NOT detect permission error in: "${text}"`);
    });
  }
});

// ─── isManagedSystemctlMutatingCommand ───────────────────────────────────

describe("isManagedSystemctlMutatingCommand — managed mutating commands", () => {
  const managed = [
    "systemctl start nginx",
    "systemctl stop nginx",
    "systemctl restart nginx",
    "systemctl reload nginx",
    "systemctl enable nginx",
    "systemctl disable nginx",
    "systemctl mask nginx",
    "systemctl unmask nginx",
    "systemctl daemon-reload",
    "systemctl edit nginx.service",
    // with sudo prefix — pattern still matches inner text
    "sudo systemctl restart nginx",
    // with extra whitespace
    "  systemctl stop nginx",
  ];

  for (const cmd of managed) {
    test(`managed: "${cmd}"`, () => {
      assert.equal(
        isManagedSystemctlMutatingCommand(cmd),
        true,
        `"${cmd}" should be treated as managed systemctl mutating command`,
      );
    });
  }
});

describe("isManagedSystemctlMutatingCommand — NOT managed (read-only or other)", () => {
  const notManaged = [
    "systemctl status nginx",
    "systemctl is-active nginx",
    "systemctl is-enabled nginx",
    "systemctl is-failed nginx",
    "systemctl show nginx",
    "systemctl list-units",
    "systemctl list-unit-files",
    "service nginx restart",       // uses "service", not "systemctl"
    "df -h",
    "ps aux",
    "journalctl -u nginx",
    "",
  ];

  for (const cmd of notManaged) {
    test(`not managed: "${cmd}"`, () => {
      assert.equal(
        isManagedSystemctlMutatingCommand(cmd),
        false,
        `"${cmd}" should NOT be treated as managed systemctl mutating command`,
      );
    });
  }
});
