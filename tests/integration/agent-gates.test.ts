/**
 * Integration tests for the Agent's 4-layer gate system.
 *
 * Uses a mock AIProvider that returns pre-scripted StreamEvent sequences,
 * and a mock execute_command tool with configurable return values.
 *
 * Gate coverage:
 *   GATE 1 — argument validation (missing required field)
 *   GATE 2 — risk classification / plan-required
 *   GATE 3 — sudo-first rejection + auto-upgrade after permission error
 *   GATE 4 — user confirmation (approve / deny / deny-with-feedback)
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { Agent } from "../../src/core/agent.js";
import type { AgentCallbacks } from "../../src/core/agent.js";
import { ToolRegistry } from "../../src/tools/registry.js";
import { BaseTool } from "../../src/tools/base.js";
import type { AIProvider } from "../../src/providers/base.js";
import type { StreamEvent, ToolCall, ToolResult } from "../../src/core/types.js";

// ─── Mock helpers ─────────────────────────────────────────────────────────

/**
 * Build a mock AIProvider that streams through callSequence in order.
 * Once exhausted, the last sequence is repeated.
 */
function mockProvider(callSequence: StreamEvent[][]): AIProvider {
  let idx = 0;
  return {
    name: "mock",
    model: "mock",
    supportsTools: () => true,
    chat: async function* () {
      const events = callSequence[Math.min(idx, callSequence.length - 1)];
      idx++;
      for (const e of events) yield e;
    },
  };
}

/** Build a tool_call + done stream for a single tool invocation. */
function toolTurn(
  name: string,
  args: Record<string, unknown>,
  id = "tc-1",
  preText = "",
): StreamEvent[] {
  const toolCall: ToolCall = { id, name, arguments: args };
  const events: StreamEvent[] = [];
  if (preText) events.push({ type: "text_delta", text: preText });
  events.push({ type: "tool_call_end", toolCall });
  events.push({ type: "done", message: { role: "assistant", content: preText, toolCalls: [toolCall] } });
  return events;
}

/** Build a text-only (no tools) stream — causes agent loop to wind down. */
function textTurn(text = "Done."): StreamEvent[] {
  return [
    { type: "text_delta", text },
    { type: "done", message: { role: "assistant", content: text } },
  ];
}

// ─── Mock execute_command tool ────────────────────────────────────────────

class MockExecTool extends BaseTool {
  name = "execute_command";
  description = "mock";
  parameters = {
    type: "object",
    required: ["command"],
    properties: {
      command: { type: "string" },
      host: { type: "string" },
    },
  };

  executed: string[] = [];
  private resultFn: (args: Record<string, unknown>) => ToolResult;

  constructor(resultFn?: (args: Record<string, unknown>) => ToolResult) {
    super();
    this.resultFn = resultFn ?? (() => ({ toolCallId: "", content: "ok" }));
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    this.executed.push(args.command as string);
    return this.resultFn(args);
  }
}

// ─── Capture callbacks ────────────────────────────────────────────────────

interface CapturedCallbacks extends AgentCallbacks {
  started: ToolCall[];
  ended: Array<{ toolCall: ToolCall; result: string; isError?: boolean }>;
  done: string[];
  errors: string[];
}

function captureCallbacks(
  confirmFn: (tc: ToolCall) => Promise<boolean | string> = async () => true,
): CapturedCallbacks {
  const started: ToolCall[] = [];
  const ended: Array<{ toolCall: ToolCall; result: string; isError?: boolean }> = [];
  const done: string[] = [];
  const errors: string[] = [];

  return {
    started,
    ended,
    done,
    errors,
    onTextDelta: () => {},
    onReasoningDelta: () => {},
    onToolCallStart: (tc) => started.push(tc),
    onToolCallEnd: (tc, result, isError) => ended.push({ toolCall: tc, result, isError }),
    onConfirmToolCall: confirmFn,
    onUsage: () => {},
    onDone: (msg) => done.push(msg.content),
    onError: (err) => errors.push(err),
  };
}

function makeRegistry(...tools: BaseTool[]): ToolRegistry {
  const r = new ToolRegistry();
  for (const t of tools) r.register(t);
  return r;
}

// ─── GATE 1: Argument validation ─────────────────────────────────────────

describe("GATE 1 — argument validation", () => {
  test("missing required 'command' field → blocked before confirm/exec", async () => {
    const tool = new MockExecTool();
    const registry = makeRegistry(tool);

    // AI sends execute_command without required "command" field
    const provider = mockProvider([
      toolTurn("execute_command", { host: "host1" }), // missing "command"
      textTurn("Let me add the command field."),
    ]);

    const cbs = captureCallbacks();
    await new Agent(provider, registry, "system").run("check host", cbs);

    assert.equal(tool.executed.length, 0, "Tool should not execute when args are invalid");

    const blocked = cbs.ended.find((e) => e.toolCall.name === "execute_command" && e.isError);
    assert.ok(blocked, "Should have an error result for invalid args");
    assert.ok(
      blocked.result.toLowerCase().includes("missing") || blocked.result.toLowerCase().includes("required"),
      `Error should mention missing argument, got: "${blocked.result}"`,
    );
  });
});

// ─── GATE 2: Risk classification ─────────────────────────────────────────

describe("GATE 2 — plan-required enforcement", () => {
  test("apt-get install without approved plan → blocked", async () => {
    const tool = new MockExecTool();
    const registry = makeRegistry(tool);

    const provider = mockProvider([
      toolTurn("execute_command", { command: "apt-get install nginx", host: "h1" }),
      textTurn("I need to create a plan first."),
    ]);

    const cbs = captureCallbacks();
    await new Agent(provider, registry, "system").run("install nginx", cbs);

    assert.equal(tool.executed.length, 0, "Mutating command must not execute without plan");

    const blocked = cbs.ended.find((e) => e.toolCall.name === "execute_command" && e.isError);
    assert.ok(blocked, "Should be blocked by plan gate");
    assert.ok(
      blocked.result.toLowerCase().includes("plan"),
      `Block message should mention 'plan', got: "${blocked.result}"`,
    );
  });

  test("docker run without approved plan → blocked", async () => {
    const tool = new MockExecTool();
    const registry = makeRegistry(tool);

    const provider = mockProvider([
      toolTurn("execute_command", { command: "docker run -d nginx", host: "h1" }),
      textTurn("Need a plan."),
    ]);

    const cbs = captureCallbacks();
    await new Agent(provider, registry, "system").run("run docker", cbs);

    assert.equal(tool.executed.length, 0);
  });

  test("read-only command (df -h) does NOT require plan → executes", async () => {
    const tool = new MockExecTool(() => ({ toolCallId: "", content: "50G used" }));
    const registry = makeRegistry(tool);

    const provider = mockProvider([
      toolTurn("execute_command", { command: "df -h", host: "h1" }),
      textTurn("Disk is 50% used."),
    ]);

    const cbs = captureCallbacks();
    await new Agent(provider, registry, "system").run("check disk", cbs);

    assert.equal(tool.executed[0], "df -h", "Read-only command should execute directly");
    assert.equal(cbs.errors.length, 0);
  });

  test("systemctl status (read-only) → executes without plan", async () => {
    const tool = new MockExecTool(() => ({ toolCallId: "", content: "active (running)" }));
    const registry = makeRegistry(tool);

    const provider = mockProvider([
      toolTurn("execute_command", { command: "systemctl status nginx", host: "h1" }),
      textTurn("Nginx is running."),
    ]);

    const cbs = captureCallbacks();
    await new Agent(provider, registry, "system").run("nginx status", cbs);

    assert.equal(tool.executed[0], "systemctl status nginx");
  });
});

// ─── GATE 3: Sudo-first rejection ────────────────────────────────────────

describe("GATE 3 — sudo-first policy", () => {
  test("sudo on first attempt is blocked with POLICY message", async () => {
    const tool = new MockExecTool();
    const registry = makeRegistry(tool);

    // AI immediately sends sudo df -h — should be blocked
    const provider = mockProvider([
      toolTurn("execute_command", { command: "sudo df -h", host: "h1" }),
      textTurn("I will retry without sudo."),
    ]);

    const cbs = captureCallbacks();
    await new Agent(provider, registry, "system").run("check disk", cbs);

    assert.equal(tool.executed.length, 0, "sudo command must not execute on first attempt");

    const blocked = cbs.ended.find((e) => e.toolCall.name === "execute_command" && e.isError);
    assert.ok(blocked, "Should have policy block result");
    assert.ok(
      blocked.result.toUpperCase().includes("POLICY") || blocked.result.toLowerCase().includes("sudo"),
      `Block message should mention POLICY or sudo, got: "${blocked.result}"`,
    );
  });

  test("non-sudo command on first attempt → executes normally", async () => {
    const tool = new MockExecTool(() => ({ toolCallId: "", content: "root" }));
    const registry = makeRegistry(tool);

    const provider = mockProvider([
      toolTurn("execute_command", { command: "whoami", host: "h1" }),
      textTurn("User is root."),
    ]);

    const cbs = captureCallbacks();
    await new Agent(provider, registry, "system").run("who am I", cbs);

    assert.equal(tool.executed[0], "whoami");
    assert.equal(cbs.errors.length, 0);
  });

  test("after permission error, repeated non-sudo attempt is auto-upgraded to sudo", async () => {
    // Simulates the real flow:
    //   Turn 1: AI sends "df -h" → permission denied
    //   Turn 2: AI sends "df -h" again → agent auto-upgrades to "sudo df -h" → success
    const tool = new MockExecTool((args) => {
      const cmd = args.command as string;
      if (cmd.includes("sudo")) return { toolCallId: "", content: "Filesystem  50G" };
      return { toolCallId: "", content: "bash: df: permission denied", isError: true };
    });
    const registry = makeRegistry(tool);

    const provider = mockProvider([
      toolTurn("execute_command", { command: "df -h", host: "h1" }, "tc-1"),
      toolTurn("execute_command", { command: "df -h", host: "h1" }, "tc-2"), // will be upgraded
      textTurn("Disk usage retrieved."),
    ]);

    const cbs = captureCallbacks();
    await new Agent(provider, registry, "system").run("check disk", cbs);

    assert.ok(tool.executed.length >= 2, `Expected ≥ 2 executions, got ${tool.executed.length}`);
    assert.equal(tool.executed[0], "df -h", "First attempt should be without sudo");
    assert.equal(tool.executed[1], "sudo df -h", "Second attempt should be auto-upgraded");
    assert.equal(cbs.errors.length, 0);
  });

  test("sudo is NOT auto-upgraded before any permission error occurs", async () => {
    // First call: df -h (no sudo), succeeds → no entry in sudoAllowedBinaries
    // Second call: df -h again — should NOT be auto-upgraded (no prior permission error)
    const tool = new MockExecTool(() => ({ toolCallId: "", content: "Filesystem 50G" }));
    const registry = makeRegistry(tool);

    const provider = mockProvider([
      toolTurn("execute_command", { command: "df -h", host: "h1" }, "tc-1"),
      toolTurn("execute_command", { command: "df -h", host: "h1" }, "tc-2"),
      textTurn("Done."),
    ]);

    const cbs = captureCallbacks();
    await new Agent(provider, registry, "system").run("check disk twice", cbs);

    // Both should execute as plain "df -h", no auto-upgrade
    for (const cmd of tool.executed) {
      assert.equal(cmd, "df -h", `Command should not be auto-upgraded, got: "${cmd}"`);
    }
  });

  test("managed systemctl mutating command via execute_command → blocked by policy", async () => {
    // systemctl restart via execute_command is redirected to use service_control instead
    const tool = new MockExecTool();
    const registry = makeRegistry(tool);

    const provider = mockProvider([
      toolTurn("execute_command", { command: "systemctl restart nginx", host: "h1" }),
      textTurn("I should use service_control instead."),
    ]);

    const cbs = captureCallbacks();
    await new Agent(provider, registry, "system").run("restart nginx", cbs);

    assert.equal(tool.executed.length, 0, "systemctl mutating via execute_command should be blocked");

    const blocked = cbs.ended.find((e) => e.toolCall.name === "execute_command" && e.isError);
    assert.ok(blocked, "Should have a policy block result");
    // systemctl restart matches "service-lifecycle" → GATE 2 (plan-required) fires before GATE 3.
    // GATE 3 "use service_control" message only shows when plan is already approved.
    assert.ok(
      blocked.result.toLowerCase().includes("plan") ||
        blocked.result.toLowerCase().includes("service_control"),
      `Should be blocked by policy (plan or service_control), got: "${blocked.result}"`,
    );
  });
});

// ─── GATE 4: User confirmation ────────────────────────────────────────────

describe("GATE 4 — user confirmation", () => {
  test("user approves → tool executes", async () => {
    const tool = new MockExecTool(() => ({ toolCallId: "", content: "50G" }));
    tool.requiresConfirmation = true;
    const registry = makeRegistry(tool);

    const provider = mockProvider([
      toolTurn("execute_command", { command: "df -h", host: "h1" }),
      textTurn("Disk is 50G."),
    ]);

    const cbs = captureCallbacks(async () => true); // always approve
    await new Agent(provider, registry, "system").run("check disk", cbs);

    assert.equal(tool.executed[0], "df -h", "Should execute after user approval");
    assert.equal(cbs.errors.length, 0);
  });

  test("user denies (false) → tool NOT executed, generic denied message sent to AI", async () => {
    const tool = new MockExecTool();
    tool.requiresConfirmation = true;
    const registry = makeRegistry(tool);

    const provider = mockProvider([
      toolTurn("execute_command", { command: "df -h", host: "h1" }),
      textTurn("Understood, skipping."),
    ]);

    const cbs = captureCallbacks(async () => false); // always deny
    await new Agent(provider, registry, "system").run("check disk", cbs);

    assert.equal(tool.executed.length, 0, "Must not execute when denied");

    const denied = cbs.ended.find((e) => e.toolCall.name === "execute_command" && e.isError);
    assert.ok(denied, "Should have an error result for denied tool");
    assert.ok(
      denied.result.toLowerCase().includes("denied"),
      `Denial message should contain 'denied', got: "${denied.result}"`,
    );
  });

  test("user provides text feedback → feedback string forwarded to AI conversation", async () => {
    const tool = new MockExecTool();
    tool.requiresConfirmation = true;
    const registry = makeRegistry(tool);

    const provider = mockProvider([
      toolTurn("execute_command", { command: "df -h", host: "h1" }),
      textTurn("I will check hk02 instead."),
    ]);

    const feedback = "please run this on hk02, not h1";
    const cbs = captureCallbacks(async () => feedback);
    await new Agent(provider, registry, "system").run("check disk", cbs);

    assert.equal(tool.executed.length, 0, "Must not execute when denied with feedback");

    const denied = cbs.ended.find((e) => e.toolCall.name === "execute_command" && e.isError);
    assert.ok(denied, "Should have an error result");
    assert.ok(
      denied.result.includes(feedback),
      `Denied message should include user feedback.\nExpected: "${feedback}"\nGot: "${denied.result}"`,
    );
  });

  test("user provides empty string feedback → treated as plain denial", async () => {
    const tool = new MockExecTool();
    tool.requiresConfirmation = true;
    const registry = makeRegistry(tool);

    const provider = mockProvider([
      toolTurn("execute_command", { command: "df -h", host: "h1" }),
      textTurn("Ok."),
    ]);

    const cbs = captureCallbacks(async () => ""); // empty feedback = same as false
    await new Agent(provider, registry, "system").run("check disk", cbs);

    assert.equal(tool.executed.length, 0);

    const denied = cbs.ended.find((e) => e.toolCall.name === "execute_command" && e.isError);
    assert.ok(denied?.result.toLowerCase().includes("denied"), `Got: "${denied?.result}"`);
  });

  test("confirmation not required → tool executes without asking", async () => {
    let confirmCalled = false;
    const tool = new MockExecTool(() => ({ toolCallId: "", content: "ok" }));
    // requiresConfirmation defaults to false

    const registry = makeRegistry(tool);
    const provider = mockProvider([
      toolTurn("execute_command", { command: "df -h", host: "h1" }),
      textTurn("Done."),
    ]);

    const cbs = captureCallbacks(async () => {
      confirmCalled = true;
      return true;
    });
    await new Agent(provider, registry, "system").run("check disk", cbs);

    assert.equal(confirmCalled, false, "onConfirmToolCall should NOT be called when not required");
    assert.equal(tool.executed[0], "df -h");
  });
});

// ─── Unknown tool ─────────────────────────────────────────────────────────

describe("Unknown tool name", () => {
  test("AI calls a non-existent tool → GATE 1 returns error, no crash", async () => {
    const registry = new ToolRegistry(); // empty registry

    const provider = mockProvider([
      toolTurn("nonexistent_tool", { foo: "bar" }),
      textTurn("That tool doesn't exist."),
    ]);

    const cbs = captureCallbacks();
    await new Agent(provider, registry, "system").run("do something", cbs);

    const err = cbs.ended.find((e) => e.toolCall.name === "nonexistent_tool" && e.isError);
    assert.ok(err, "Should produce an error for unknown tool");
    assert.ok(
      err.result.toLowerCase().includes("unknown") || err.result.toLowerCase().includes("nonexistent"),
      `Error should mention unknown tool, got: "${err.result}"`,
    );
  });
});
