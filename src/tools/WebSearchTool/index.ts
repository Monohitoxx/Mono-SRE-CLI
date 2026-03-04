import { BaseTool } from "../base.js";
import type { ToolResult } from "../../core/types.js";

const SEARCH_TIMEOUT_MS = 10000;

export class WebSearchTool extends BaseTool {
  name = "web_search";
  description = `Search the web for current information. Useful for:
- Looking up error messages or solutions
- Finding latest versions of software packages
- Checking CVEs or security advisories
- Finding documentation or configuration examples
- Researching best practices

Returns a summary with source links.`;

  parameters = {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The search query",
      },
    },
    required: ["query"],
  };

  constructor() {
    super();
    this.requiresConfirmation = false;
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const query = args.query as string;

    try {
      const results = await duckDuckGoSearch(query);
      if (!results.length) {
        return {
          toolCallId: "",
          content: `No results found for: "${query}"`,
        };
      }

      const formatted = results
        .map(
          (r, i) =>
            `${i + 1}. ${r.title}\n   ${r.snippet}\n   ${r.url}`,
        )
        .join("\n\n");

      return {
        toolCallId: "",
        content: `Search results for "${query}":\n\n${formatted}`,
      };
    } catch (err) {
      return {
        toolCallId: "",
        content: `Search failed: ${(err as Error).message}`,
        isError: true,
      };
    }
  }
}

interface SearchResult {
  title: string;
  snippet: string;
  url: string;
}

async function duckDuckGoSearch(query: string): Promise<SearchResult[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

  try {
    const encoded = encodeURIComponent(query);
    const url = `https://html.duckduckgo.com/html/?q=${encoded}`;

    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
    });

    clearTimeout(timeout);

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }

    const html = await resp.text();
    return parseResults(html);
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

function parseResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];

  const linkRegex =
    /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetRegex =
    /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

  const links: { url: string; title: string }[] = [];
  let match;

  while ((match = linkRegex.exec(html)) !== null) {
    const rawUrl = match[1];
    const title = match[2].replace(/<[^>]+>/g, "").trim();
    const url = extractRealUrl(rawUrl);
    if (url && title) {
      links.push({ url, title });
    }
  }

  const snippets: string[] = [];
  while ((match = snippetRegex.exec(html)) !== null) {
    snippets.push(
      match[1]
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim(),
    );
  }

  for (let i = 0; i < Math.min(links.length, 8); i++) {
    results.push({
      title: links[i].title,
      url: links[i].url,
      snippet: snippets[i] || "",
    });
  }

  return results;
}

function extractRealUrl(ddgUrl: string): string {
  try {
    const match = ddgUrl.match(/uddg=([^&]+)/);
    if (match) {
      return decodeURIComponent(match[1]);
    }
    if (ddgUrl.startsWith("http")) {
      return ddgUrl;
    }
  } catch {
    // ignore
  }
  return ddgUrl;
}
