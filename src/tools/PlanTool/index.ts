import { BaseTool } from "../base.js";
import type { ToolResult } from "../../core/types.js";

export interface PlanStep {
  id: number;
  title: string;
  description: string;
}

export interface PlanData {
  title: string;
  steps: PlanStep[];
}

export class PlanTool extends BaseTool {
  name = "plan";
  description = `Create a structured execution plan for complex infrastructure tasks. The plan will be displayed to the user for approval before any execution begins.

Use this tool when the task involves:
- Installing or configuring software (nginx, docker, k8s, etc.)
- Deploying services or applications
- System configuration changes (network, firewall, users, etc.)
- Multi-step troubleshooting that requires careful sequencing
- Any operation that could impact a production system

Do NOT use this tool for:
- Simple health checks or status queries
- Reading logs or files
- Single-command operations
- Information gathering

The plan MUST include:
1. Pre-flight checks (network, resources, OS, existing services)
2. Clear execution steps in order
3. A verification step at the end to confirm success

IMPORTANT: Do NOT include 'sudo' in plan step descriptions. The system handles privilege escalation automatically — write commands without sudo (e.g. 'docker stop X', not 'sudo docker stop X').`;

  parameters = {
    type: "object",
    properties: {
      title: {
        type: "string",
        description:
          "Short title describing the overall task (e.g. 'Install Nginx on RHEL 9')",
      },
      steps: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "number", description: "Step number (1-based)" },
            title: {
              type: "string",
              description: "Short step title",
            },
            description: {
              type: "string",
              description:
                "What this step does and why (include specific commands if known)",
            },
          },
          required: ["id", "title", "description"],
        },
        description: "Ordered list of execution steps",
      },
    },
    required: ["title", "steps"],
  };

  constructor() {
    super();
    this.requiresConfirmation = true;
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const title = safeString(args.title, "Untitled Plan");
    const steps = safeSteps(args.steps);

    const formatted = [
      `Plan approved: ${title}`,
      `${steps.length} steps to execute.`,
      "",
      ...steps.map((s) => `  ${s.id}. ${s.title}`),
      "",
      "INSTRUCTIONS — follow these strictly:",
      "1. Start with a brief message to the user (e.g. 'Starting nginx installation on test_ubuntu...').",
      "2. Execute ALL steps NOW in sequence. Do NOT stop to wait for user input between steps.",
      "3. Each response must follow this pattern:",
      "   a) A brief status message (1 sentence) telling the user what you're doing",
      "   b) think (reason about what you are about to do)",
      "   c) plan_progress(action='start', step=N) — only when starting a new step",
      "   d) exactly ONE action tool call (execute_command, service_control, etc.)",
      "   Wait for the result, then in your next response: brief status + think + next action or plan_progress(action='done', step=N).",
      "4. NEVER call more than ONE action tool per response. If a step needs multiple commands, use separate responses with a think before each.",
      "5. Only do what the step describes. Do NOT add extra commands (e.g. don't run 'apt update' when the step says 'Remove package').",
      "6. Every response MUST include tool calls — never send text-only while steps remain.",
      "7. Continue until ALL steps are completed. End with a summary of what was done.",
      "8. Do NOT add sudo to commands — even if a command output suggests it. The system handles sudo escalation automatically.",
      "9. Do NOT chain commands with && or ; — run each command in a separate tool call. Pipes (|) for filtering are OK.",
    ].join("\n");

    return {
      toolCallId: "",
      content: formatted,
    };
  }
}

export function formatPlanForDisplay(args: Record<string, unknown>): string {
  const title = safeString(args.title, "Untitled Plan");
  const steps = safeSteps(args.steps);

  if (steps.length === 0) {
    return `Plan: ${title}\n\n  (no steps provided)`;
  }

  const lines = [`Plan: ${title}`, ""];
  for (const step of steps) {
    lines.push(`  ${step.id}. ${step.title}`);
    if (step.description) {
      lines.push(`     ${step.description}`);
    }
  }
  return lines.join("\n");
}

function safeString(val: unknown, fallback: string): string {
  if (typeof val === "string" && val.trim()) return val;
  return fallback;
}

function safeSteps(val: unknown): PlanStep[] {
  if (!Array.isArray(val)) return [];
  return val
    .filter((s): s is Record<string, unknown> => s && typeof s === "object")
    .map((s, i) => ({
      id: typeof s.id === "number" ? s.id : i + 1,
      title: safeString(s.title, `Step ${i + 1}`),
      description: typeof s.description === "string" ? s.description : "",
    }));
}
