import * as path from "node:path";
import * as fs from "node:fs/promises";
import { exec } from "node:child_process";
import { BaseTool } from "../base.js";
import type { ToolResult } from "../../core/types.js";

const MAX_MATCHES = 200;
const SEARCH_TIMEOUT_MS = 15000;

export class GrepTool extends BaseTool {
  name = "grep_search";
  description = `Search file contents using a regular expression pattern. Returns matching lines with file paths and line numbers. Useful for:
- Finding function definitions, variable usages, or import statements
- Searching configuration files for specific settings
- Locating error messages or log patterns
- Exploring codebases or config directories

Results are limited to ${MAX_MATCHES} matches. Use 'include' to narrow file types.`;

  parameters = {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description:
          "Regular expression pattern to search for (POSIX ERE syntax)",
      },
      path: {
        type: "string",
        description:
          "Directory or file path to search in (default: current directory)",
      },
      include: {
        type: "string",
        description:
          'Glob pattern to filter files, e.g. "*.ts", "*.yaml", "*.conf"',
      },
    },
    required: ["pattern"],
  };

  constructor() {
    super();
    this.requiresConfirmation = false;
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const pattern = args.pattern as string;
    const searchPath = path.resolve((args.path as string) || ".");
    const include = (args.include as string) || undefined;

    try {
      await fs.access(searchPath);
    } catch {
      return {
        toolCallId: "",
        content: `Path not found: ${searchPath}`,
        isError: true,
      };
    }

    const stat = await fs.stat(searchPath);

    try {
      const result = stat.isDirectory()
        ? await searchDirectory(pattern, searchPath, include)
        : await searchSingleFile(pattern, searchPath);

      if (!result.length) {
        return {
          toolCallId: "",
          content: `No matches found for pattern: ${pattern}`,
        };
      }

      const truncated = result.length >= MAX_MATCHES;
      const output = result
        .map((m) => `${m.file}:${m.line}:${m.text}`)
        .join("\n");

      return {
        toolCallId: "",
        content: truncated
          ? `${output}\n\n--- showing first ${MAX_MATCHES} matches (more exist) ---`
          : output,
      };
    } catch (err) {
      return {
        toolCallId: "",
        content: `Search error: ${(err as Error).message}`,
        isError: true,
      };
    }
  }
}

interface GrepMatch {
  file: string;
  line: number;
  text: string;
}

async function searchDirectory(
  pattern: string,
  dir: string,
  include?: string,
): Promise<GrepMatch[]> {
  const isGit = await isGitRepo(dir);

  if (isGit) {
    try {
      return await gitGrep(pattern, dir, include);
    } catch {
      // fallback
    }
  }

  try {
    return await systemGrep(pattern, dir, include);
  } catch {
    // fallback
  }

  return jsGrep(pattern, dir, include);
}

async function searchSingleFile(
  pattern: string,
  filePath: string,
): Promise<GrepMatch[]> {
  const content = await fs.readFile(filePath, "utf-8");
  const re = new RegExp(pattern, "gi");
  const lines = content.split("\n");
  const matches: GrepMatch[] = [];
  const relPath = path.relative(process.cwd(), filePath) || filePath;

  for (let i = 0; i < lines.length && matches.length < MAX_MATCHES; i++) {
    if (re.test(lines[i])) {
      matches.push({ file: relPath, line: i + 1, text: lines[i] });
      re.lastIndex = 0;
    }
  }
  return matches;
}

function isGitRepo(dir: string): Promise<boolean> {
  return new Promise((resolve) => {
    exec("git rev-parse --is-inside-work-tree", { cwd: dir }, (err) => {
      resolve(!err);
    });
  });
}

function gitGrep(
  pattern: string,
  dir: string,
  include?: string,
): Promise<GrepMatch[]> {
  return new Promise((resolve, reject) => {
    const includeArgs = include ? ` -- '${include}'` : "";
    const cmd = `git grep -n -I -E '${shellEscape(pattern)}'${includeArgs}`;

    exec(
      cmd,
      { cwd: dir, timeout: SEARCH_TIMEOUT_MS, maxBuffer: 5 * 1024 * 1024 },
      (err, stdout) => {
        if (err && !stdout) return reject(err);
        resolve(parseGrepOutput(stdout, dir));
      },
    );
  });
}

function systemGrep(
  pattern: string,
  dir: string,
  include?: string,
): Promise<GrepMatch[]> {
  return new Promise((resolve, reject) => {
    const includeArg = include ? ` --include='${include}'` : "";
    const cmd = `grep -rn -I -E '${shellEscape(pattern)}'${includeArg} .`;

    exec(
      cmd,
      { cwd: dir, timeout: SEARCH_TIMEOUT_MS, maxBuffer: 5 * 1024 * 1024 },
      (err, stdout) => {
        if (err && !stdout) return reject(err);
        resolve(parseGrepOutput(stdout, dir));
      },
    );
  });
}

async function jsGrep(
  pattern: string,
  dir: string,
  include?: string,
): Promise<GrepMatch[]> {
  const re = new RegExp(pattern, "gi");
  const matches: GrepMatch[] = [];
  const includeRe = include ? globToRegex(include) : null;

  async function walk(d: string) {
    if (matches.length >= MAX_MATCHES) return;

    let entries;
    try {
      entries = await fs.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (matches.length >= MAX_MATCHES) return;

      if (entry.name.startsWith(".") || entry.name === "node_modules") {
        continue;
      }

      const full = path.join(d, entry.name);

      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        if (includeRe && !includeRe.test(entry.name)) continue;

        try {
          const content = await fs.readFile(full, "utf-8");
          const lines = content.split("\n");
          const relPath = path.relative(process.cwd(), full);

          for (
            let i = 0;
            i < lines.length && matches.length < MAX_MATCHES;
            i++
          ) {
            if (re.test(lines[i])) {
              matches.push({
                file: relPath,
                line: i + 1,
                text: lines[i],
              });
              re.lastIndex = 0;
            }
          }
        } catch {
          // skip binary/unreadable files
        }
      }
    }
  }

  await walk(dir);
  return matches;
}

function parseGrepOutput(stdout: string, dir: string): GrepMatch[] {
  const results: GrepMatch[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    const match = line.match(/^(.+?):(\d+):(.*)$/);
    if (match && results.length < MAX_MATCHES) {
      const file = match[1].startsWith("./") ? match[1].slice(2) : match[1];
      results.push({
        file,
        line: parseInt(match[2], 10),
        text: match[3],
      });
    }
  }
  return results;
}

function shellEscape(s: string): string {
  return s.replace(/'/g, "'\\''");
}

function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}
