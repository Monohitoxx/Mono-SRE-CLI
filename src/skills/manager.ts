import * as path from "node:path";
import type { SkillDefinition } from "../core/types.js";
import { loadSkillsFromDirectory } from "./loader.js";
import { getReasonDir } from "../config/env.js";

export class SkillManager {
  private skills = new Map<string, SkillDefinition>();
  private activeSkills = new Set<string>();

  async loadAll(): Promise<void> {
    const reasonDir = getReasonDir();
    const skillsDir = path.join(reasonDir, "skills");
    const loaded = await loadSkillsFromDirectory(skillsDir);

    for (const skill of loaded) {
      this.skills.set(skill.name, skill);
    }
  }

  getSkill(name: string): SkillDefinition | undefined {
    const lower = name.toLowerCase();
    for (const [key, skill] of this.skills) {
      if (key.toLowerCase() === lower) return skill;
    }
    return undefined;
  }

  listSkills(): SkillDefinition[] {
    return Array.from(this.skills.values());
  }

  activateSkill(name: string): SkillDefinition | undefined {
    const skill = this.getSkill(name);
    if (!skill) return undefined;
    this.activeSkills.add(skill.name);
    return skill;
  }

  isActive(name: string): boolean {
    const skill = this.getSkill(name);
    return skill ? this.activeSkills.has(skill.name) : false;
  }

  getActiveSkills(): SkillDefinition[] {
    return this.listSkills().filter((s) => this.activeSkills.has(s.name));
  }

  /** Prompt fragment: only names + descriptions, NOT full body */
  getSkillCatalogPrompt(): string {
    const skills = this.listSkills();
    if (skills.length === 0) return "";

    const lines = [
      "## Available Skills",
      "Use `activate_skill` to load a skill's full instructions when the user's request matches its domain.",
      "Only the skill name and description are shown here — the full body is loaded on activation.",
      "",
    ];

    for (const skill of skills) {
      const active = this.activeSkills.has(skill.name) ? " ✓ active" : "";
      lines.push(`- **${skill.name}**: ${skill.description}${active}`);
    }

    return lines.join("\n");
  }
}
