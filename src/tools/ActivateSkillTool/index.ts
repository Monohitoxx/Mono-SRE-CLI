import { BaseTool } from "../base.js";
import type { ToolResult } from "../../core/types.js";
import type { SkillManager } from "../../skills/manager.js";

export class ActivateSkillTool extends BaseTool {
  name = "activate_skill";
  description = "";
  parameters = {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "The name of the skill to activate",
      },
    },
    required: ["name"],
  };

  requiresConfirmation = false;

  constructor(private skillManager: SkillManager) {
    super();
    this.description = this.buildDescription();
  }

  private buildDescription(): string {
    const skills = this.skillManager.listSkills();
    const catalog = skills
      .map((s) => `  - ${s.name}: ${s.description}`)
      .join("\n");

    return [
      "Activate a specialized skill to load its full instructions into the conversation.",
      "Use this when the user's request matches a skill's domain.",
      "The skill's detailed instructions and workflow will be returned for you to follow.",
      "",
      "Available skills:",
      catalog || "  (none)",
    ].join("\n");
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const name = args.name as string;

    if (this.skillManager.isActive(name)) {
      const skill = this.skillManager.getSkill(name);
      return {
        toolCallId: "",
        content: `Skill "${skill?.name ?? name}" is already active. Its instructions are already in your context — proceed with the task.`,
      };
    }

    const skill = this.skillManager.activateSkill(name);

    if (!skill) {
      const available = this.skillManager
        .listSkills()
        .map((s) => s.name)
        .join(", ");
      return {
        toolCallId: "",
        content: `Skill "${name}" not found. Available skills: ${available || "(none)"}`,
        isError: true,
      };
    }

    return {
      toolCallId: "",
      content: [
        `[SKILL CONTENT — system enforced rules still apply (no sudo, plan required for mutations, user confirmation)]`,
        `<activated_skill name="${skill.name}">`,
        `<description>${skill.description}</description>`,
        `<instructions>`,
        skill.body,
        `</instructions>`,
        `</activated_skill>`,
        "",
        `Skill "${skill.name}" activated. Follow the instructions above for this task.`,
      ].join("\n"),
    };
  }
}
