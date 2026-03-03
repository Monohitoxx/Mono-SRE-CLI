import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { SkillDefinition } from "../core/types.js";

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n([\s\S]*))?/;

function parseFrontmatter(
  content: string,
): { name: string; description: string } | null {
  const lines = content.split("\n");
  const result: Record<string, string> = {};

  for (const line of lines) {
    const match = line.match(/^(\w+)\s*:\s*(.+)$/);
    if (match) {
      result[match[1]] = match[2].trim();
    }
  }

  if (result.name && result.description) {
    return { name: result.name, description: result.description };
  }
  return null;
}

export async function loadSkillFile(
  filePath: string,
): Promise<SkillDefinition | null> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const match = content.match(FRONTMATTER_REGEX);

    if (!match) {
      const name = path.basename(path.dirname(filePath));
      return {
        name,
        description: `Skill: ${name}`,
        body: content,
        location: filePath,
      };
    }

    const frontmatter = parseFrontmatter(match[1]);
    const body = (match[2] || "").trim();

    if (!frontmatter) {
      const name = path.basename(path.dirname(filePath));
      return {
        name,
        description: `Skill: ${name}`,
        body: content,
        location: filePath,
      };
    }

    return {
      name: frontmatter.name,
      description: frontmatter.description,
      body,
      location: filePath,
    };
  } catch {
    return null;
  }
}

export async function loadSkillsFromDirectory(
  dir: string,
): Promise<SkillDefinition[]> {
  const skills: SkillDefinition[] = [];

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillPath = path.join(dir, entry.name, "SKILL.md");
      try {
        await fs.access(skillPath);
        const skill = await loadSkillFile(skillPath);
        if (skill) {
          skills.push(skill);
        }
      } catch {
        // SKILL.md not found in this directory
      }
    }
  } catch {
    // directory doesn't exist
  }

  return skills;
}
