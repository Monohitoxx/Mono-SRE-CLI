import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { BaseTool } from "../base.js";
import type { ToolResult } from "../../core/types.js";

const MEMORY_SECTION = "## Mono Memories";

function getMemoryPath(): string {
  const localPath = path.join(process.cwd(), ".mono", "memory.md");
  const homePath = path.join(os.homedir(), ".mono", "memory.md");

  try {
    fsSync.accessSync(path.dirname(localPath));
    return localPath;
  } catch {
    return homePath;
  }
}

export class MemoryTool extends BaseTool {
  name = "save_memory";
  description = `Save a fact, preference, or piece of information to persistent memory. Saved memories are automatically loaded in future sessions. Use this to remember:
- User preferences (e.g. "User prefers to use docker compose v2")
- Server details (e.g. "Production server uses RHEL 9.4 with nginx")
- Project conventions (e.g. "Config files are in /opt/app/conf/")
- Frequently used credentials hints (NEVER save actual passwords)
- Architecture decisions or troubleshooting notes

Each fact should be a clear, self-contained statement.`;

  parameters = {
    type: "object",
    properties: {
      fact: {
        type: "string",
        description: "A clear, self-contained fact to remember",
      },
    },
    required: ["fact"],
  };

  constructor() {
    super();
    this.requiresConfirmation = true;
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const fact = sanitize(args.fact as string);

    if (!fact) {
      return {
        toolCallId: "",
        content: "Empty fact — nothing saved.",
        isError: true,
      };
    }

    const memoryPath = getMemoryPath();

    try {
      await fs.mkdir(path.dirname(memoryPath), { recursive: true });

      let content = "";
      try {
        content = await fs.readFile(memoryPath, "utf-8");
      } catch {
        // file doesn't exist yet
      }

      if (!content.includes(MEMORY_SECTION)) {
        content = content.trim()
          ? `${content.trim()}\n\n${MEMORY_SECTION}\n`
          : `${MEMORY_SECTION}\n`;
      }

      const entry = `- ${fact}`;

      if (content.includes(entry)) {
        return {
          toolCallId: "",
          content: `Already saved: "${fact}"`,
        };
      }

      content = content.trimEnd() + `\n${entry}\n`;
      await fs.writeFile(memoryPath, content, "utf-8");

      return {
        toolCallId: "",
        content: `Saved to memory: "${fact}"`,
      };
    } catch (err) {
      return {
        toolCallId: "",
        content: `Failed to save memory: ${(err as Error).message}`,
        isError: true,
      };
    }
  }
}

export async function loadMemories(): Promise<string> {
  const paths = [
    path.join(process.cwd(), ".mono", "memory.md"),
    path.join(os.homedir(), ".mono", "memory.md"),
  ];

  const memories: string[] = [];
  const seen = new Set<string>();

  for (const p of paths) {
    try {
      const content = await fs.readFile(p, "utf-8");
      if (content.trim() && !seen.has(content.trim())) {
        seen.add(content.trim());
        memories.push(content.trim());
      }
    } catch {
      // file doesn't exist
    }
  }

  return memories.join("\n\n");
}

function sanitize(text: string): string {
  return text
    .replace(/\n/g, " ")
    .replace(/[#*`]/g, "")
    .trim();
}
