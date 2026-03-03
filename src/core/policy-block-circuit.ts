import type { AuditLogger } from "../utils/audit.js";
import type { Message, ToolCall } from "./types.js";

interface PolicyBlockHandleInput {
  toolCall: ToolCall;
  code: string;
  baseMessage: string;
  nextAction: string;
  addToolResult: (toolCallId: string, content: string, isError?: boolean) => void;
  addAssistant: (message: Message) => void;
  onToolCallStart: (toolCall: ToolCall) => void;
  onToolCallEnd: (toolCall: ToolCall, result: string, isError?: boolean) => void;
  onDone: (message: Message) => void;
  audit?: AuditLogger;
}

export class PolicyBlockCircuit {
  private policyBlockCounts = new Map<string, number>();
  private circuitOpenPolicyKeys = new Set<string>();
  private lastPolicyBlockKey: string | null = null;
  private repeatedPolicyBlockStreak = 0;

  private static readonly POLICY_BLOCK_DEDUP_AFTER = 2;
  private static readonly POLICY_BLOCK_CIRCUIT_OPEN_AFTER = 3;
  private static readonly POLICY_BLOCK_ABORT_STREAK = 6;

  resetTurnGuards() {
    this.policyBlockCounts.clear();
    this.circuitOpenPolicyKeys.clear();
    this.lastPolicyBlockKey = null;
    this.repeatedPolicyBlockStreak = 0;
  }

  resetPolicyBlockStreak() {
    this.lastPolicyBlockKey = null;
    this.repeatedPolicyBlockStreak = 0;
  }

  handle(input: PolicyBlockHandleInput): boolean {
    const {
      toolCall,
      code,
      baseMessage,
      nextAction,
      addToolResult,
      addAssistant,
      onToolCallStart,
      onToolCallEnd,
      onDone,
      audit,
    } = input;

    const key = buildPolicyBlockKey(toolCall, code);
    const count = (this.policyBlockCounts.get(key) ?? 0) + 1;
    this.policyBlockCounts.set(key, count);

    if (this.lastPolicyBlockKey === key) {
      this.repeatedPolicyBlockStreak += 1;
    } else {
      this.lastPolicyBlockKey = key;
      this.repeatedPolicyBlockStreak = 1;
    }

    let output = baseMessage;
    let mode: "normal" | "deduped" | "circuit-open" = "normal";

    if (this.circuitOpenPolicyKeys.has(key)) {
      mode = "circuit-open";
      output = [
        `CIRCUIT OPEN: Repeated blocked call ignored (${count}x).`,
        `Blocked call: ${toolCall.name}`,
        `Reason: ${code}`,
        `Next action: ${nextAction}`,
      ].join("\n");
    } else if (count >= PolicyBlockCircuit.POLICY_BLOCK_CIRCUIT_OPEN_AFTER) {
      mode = "circuit-open";
      this.circuitOpenPolicyKeys.add(key);
      output = [
        `CIRCUIT BREAKER: Same policy-blocked call seen ${count} times.`,
        `Blocked call: ${toolCall.name}`,
        `Reason: ${code}`,
        `Do NOT retry this exact call.`,
        `Next action: ${nextAction}`,
      ].join("\n");
    } else if (count >= PolicyBlockCircuit.POLICY_BLOCK_DEDUP_AFTER) {
      mode = "deduped";
      output = [
        `POLICY BLOCK (deduped): Same call was blocked ${count} times.`,
        `Reason: ${code}`,
        `Do NOT retry this exact call.`,
        `Next action: ${nextAction}`,
      ].join("\n");
    }

    onToolCallStart(toolCall);
    addToolResult(toolCall.id, output, true);
    onToolCallEnd(toolCall, output, true);

    audit?.log("policy_block", {
      tool: toolCall.name,
      args: toolCall.arguments,
      code,
      count,
      streak: this.repeatedPolicyBlockStreak,
      mode,
      key,
    });

    if (this.repeatedPolicyBlockStreak >= PolicyBlockCircuit.POLICY_BLOCK_ABORT_STREAK) {
      const finalMessage = [
        "Stopped this run to prevent a policy-block retry loop.",
        `Blocked call: ${toolCall.name}`,
        `Reason: ${code}`,
        `Required next action: ${nextAction}`,
      ].join("\n");
      addAssistant({ role: "assistant", content: finalMessage });
      onDone({ role: "assistant", content: finalMessage });
      audit?.log("policy_circuit_breaker_trip", {
        tool: toolCall.name,
        code,
        count,
        streak: this.repeatedPolicyBlockStreak,
        key,
      });
      return true;
    }

    return false;
  }
}

function buildPolicyBlockKey(toolCall: ToolCall, code: string): string {
  return `${code}:${toolCall.name}:${stableStringify(toolCall.arguments)}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(
    ([a], [b]) => a.localeCompare(b),
  );
  return `{${entries
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
    .join(",")}}`;
}
