import { BaseTool } from "../base.js";
import type { ToolResult } from "../../core/types.js";

const MAX_CONTENT_LENGTH = 20000;
const FETCH_TIMEOUT_MS = 15000;

export class WebFetchTool extends BaseTool {
  name = "web_fetch";
  description = `Fetch and read the content of a URL. Returns the text content of a web page, API endpoint, or raw file. Useful for:
- Reading documentation pages
- Checking API endpoints or health URLs
- Downloading configuration examples
- Reading raw files from GitHub (use raw.githubusercontent.com)

Supports HTTP and HTTPS. Content is truncated to ${MAX_CONTENT_LENGTH} characters.`;

  parameters = {
    type: "object",
    properties: {
      url: {
        type: "string",
        description:
          "The URL to fetch (must start with http:// or https://)",
      },
    },
    required: ["url"],
  };

  constructor() {
    super();
    this.requiresConfirmation = true;
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const rawUrl = args.url as string;

    if (!rawUrl.startsWith("http://") && !rawUrl.startsWith("https://")) {
      return {
        toolCallId: "",
        content: "URL must start with http:// or https://",
        isError: true,
      };
    }

    const url = normalizeGitHubUrl(rawUrl);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        FETCH_TIMEOUT_MS,
      );

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mono-AI-CLI/1.0",
          Accept: "text/html,text/plain,application/json,*/*",
        },
      });

      clearTimeout(timeout);

      if (!response.ok) {
        return {
          toolCallId: "",
          content: `HTTP ${response.status} ${response.statusText}`,
          isError: true,
        };
      }

      const contentType = response.headers.get("content-type") || "";
      const rawText = await response.text();

      let text: string;
      if (contentType.includes("text/html")) {
        text = stripHtml(rawText);
      } else {
        text = rawText;
      }

      if (text.length > MAX_CONTENT_LENGTH) {
        text =
          text.slice(0, MAX_CONTENT_LENGTH) +
          `\n\n--- truncated (${rawText.length} total chars) ---`;
      }

      return {
        toolCallId: "",
        content: `[${url}]\n\n${text}`,
      };
    } catch (err) {
      const msg = (err as Error).name === "AbortError"
        ? `Timeout after ${FETCH_TIMEOUT_MS / 1000}s`
        : (err as Error).message;
      return {
        toolCallId: "",
        content: `Fetch failed: ${msg}`,
        isError: true,
      };
    }
  }
}

function normalizeGitHubUrl(url: string): string {
  const blobMatch = url.match(
    /^https:\/\/github\.com\/([^/]+\/[^/]+)\/blob\/(.+)$/,
  );
  if (blobMatch) {
    return `https://raw.githubusercontent.com/${blobMatch[1]}/${blobMatch[2]}`;
  }
  return url;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}
