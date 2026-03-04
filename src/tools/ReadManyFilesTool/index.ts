import * as fs from "node:fs/promises";
import * as path from "node:path";
import { BaseTool } from "../base.js";
import type { ToolResult } from "../../core/types.js";

const MAX_TOTAL_CHARS = 100_000;
const MAX_FILES = 50;

export class ReadManyFilesTool extends BaseTool {
  name = "read_many_files";
  description = `Read the contents of multiple files at once. Accepts either an explicit list of file paths or a glob pattern. Useful for:
- Reading related config files across directories
- Comparing multiple files side by side
- Batch-reading source files for analysis

Results include file headers and are truncated at ${MAX_TOTAL_CHARS} characters total. Maximum ${MAX_FILES} files per call.`;

  parameters = {
    type: "object",
    properties: {
      paths: {
        type: "array",
        items: { type: "string" },
        description: "List of file paths to read",
      },
      pattern: {
        type: "string",
        description:
          'Glob pattern to find files, e.g. "src/**/*.ts", "/etc/nginx/conf.d/*.conf"',
      },
      base_dir: {
        type: "string",
        description:
          "Base directory for glob pattern (default: current directory)",
      },
    },
    required: [],
  };

  constructor() {
    super();
    this.requiresConfirmation = false;
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const explicitPaths = args.paths as string[] | undefined;
    const pattern = args.pattern as string | undefined;
    const baseDir = path.resolve((args.base_dir as string) || ".");

    if (!explicitPaths?.length && !pattern) {
      return {
        toolCallId: "",
        content:
          "Provide either 'paths' (file list) or 'pattern' (glob) argument.",
        isError: true,
      };
    }

    let filePaths: string[];

    if (explicitPaths?.length) {
      filePaths = explicitPaths.map((p) => path.resolve(p));
    } else {
      filePaths = await globFiles(pattern!, baseDir);
    }

    if (!filePaths.length) {
      return {
        toolCallId: "",
        content: pattern
          ? `No files matched pattern: ${pattern}`
          : "No files to read.",
      };
    }

    if (filePaths.length > MAX_FILES) {
      filePaths = filePaths.slice(0, MAX_FILES);
    }

    const sections: string[] = [];
    let totalChars = 0;
    let filesRead = 0;
    let truncated = false;

    for (const fp of filePaths) {
      if (totalChars >= MAX_TOTAL_CHARS) {
        truncated = true;
        break;
      }

      const relPath = path.relative(process.cwd(), fp) || fp;
      let content: string;

      try {
        content = await fs.readFile(fp, "utf-8");
      } catch (err) {
        sections.push(
          `=== ${relPath} ===\n[Error: ${(err as Error).message}]`,
        );
        filesRead++;
        continue;
      }

      const remaining = MAX_TOTAL_CHARS - totalChars;
      if (content.length > remaining) {
        content =
          content.slice(0, remaining) +
          `\n... (truncated, ${content.length} total chars)`;
        truncated = true;
      }

      sections.push(`=== ${relPath} ===\n${content}`);
      totalChars += content.length;
      filesRead++;
    }

    const header = `Read ${filesRead}/${filePaths.length} files`;
    const footer = truncated
      ? `\n--- output truncated at ${MAX_TOTAL_CHARS} chars ---`
      : "";

    return {
      toolCallId: "",
      content: `${header}\n\n${sections.join("\n\n")}${footer}`,
    };
  }
}

async function globFiles(
  pattern: string,
  baseDir: string,
): Promise<string[]> {
  const { glob } = await import("node:fs/promises");

  if (typeof glob !== "function") {
    return globFallback(pattern, baseDir);
  }

  const results: string[] = [];
  try {
    for await (const entry of glob(pattern, { cwd: baseDir })) {
      results.push(path.resolve(baseDir, entry));
      if (results.length >= MAX_FILES) break;
    }
  } catch {
    return globFallback(pattern, baseDir);
  }
  return results;
}

async function globFallback(
  pattern: string,
  baseDir: string,
): Promise<string[]> {
  const { exec } = await import("node:child_process");

  return new Promise((resolve) => {
    const escaped = pattern.replace(/'/g, "'\\''");
    const cmd =
      process.platform === "darwin" || process.platform === "linux"
        ? `find ${baseDir} -path '${escaped}' -type f 2>/dev/null | head -${MAX_FILES}`
        : `ls -d ${path.join(baseDir, pattern)} 2>/dev/null | head -${MAX_FILES}`;

    exec(cmd, { timeout: 10000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err || !stdout.trim()) {
        resolve([]);
        return;
      }
      resolve(
        stdout
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((p) => path.resolve(p)),
      );
    });
  });
}
