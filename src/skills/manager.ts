import * as path from "node:path";
import type { SkillDefinition } from "../core/types.js";
import { loadSkillsFromDirectory } from "./loader.js";
import { getReasonDir } from "../config/env.js";

export class SkillManager {
  private skills = new Map<string, SkillDefinition>();

  async loadAll(): Promise<void> {
    const reasonDir = getReasonDir();
    const skillsDir = path.join(reasonDir, "skills");
    const loaded = await loadSkillsFromDirectory(skillsDir);

    for (const skill of loaded) {
      this.skills.set(skill.name, skill);
    }
  }

  getSkill(name: string): SkillDefinition | undefined {
    return this.skills.get(name);
  }

  listSkills(): SkillDefinition[] {
    return Array.from(this.skills.values());
  }

  getSkillPrompt(name: string): string | null {
    const skill = this.skills.get(name);
    return skill ? skill.body : null;
  }

  getAllSkillDescriptions(): string {
    const skills = this.listSkills();
    if (skills.length === 0) return "";

    const lines = ["Available skills:"];
    for (const skill of skills) {
      lines.push(`- ${skill.name}: ${skill.description}`);
    }
    return lines.join("\n");
  }
}
