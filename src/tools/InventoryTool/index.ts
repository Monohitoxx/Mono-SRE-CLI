import { BaseTool } from "../base.js";
import type { ToolResult } from "../../core/types.js";
import { loadInventory, type Host } from "../../config/inventory.js";

type MatchType = "exact" | "fuzzy";

interface MatchResult {
  name: string;
  host: Host;
  matchType: MatchType;
}

/** Split a string into lowercase tokens by common separators */
function tokenize(s: string): string[] {
  return s.toLowerCase().split(/[\s_\-./]+/).filter(Boolean);
}

/**
 * Score how well a query matches a host entry.
 */
function matchHost(
  query: string,
  name: string,
  h: Host,
): MatchType | null {
  const lowerQuery = query.toLowerCase();
  const fields = [
    name,
    h.ip,
    h.username || "",
    h.role || "",
    ...h.services,
    ...h.tags,
  ];
  const lowerFields = fields.map((f) => f.toLowerCase());

  // exact: query is a substring of any field
  if (lowerFields.some((f) => f.includes(lowerQuery))) {
    return "exact";
  }

  // fuzzy: all query tokens found across any field
  const queryTokens = tokenize(query);
  if (queryTokens.length < 2) return null;

  const allFieldTokens = lowerFields.flatMap((f) => tokenize(f));
  const allFieldText = allFieldTokens.join(" ");

  const allFound = queryTokens.every((qt) =>
    allFieldTokens.some((ft) => ft.includes(qt)) || allFieldText.includes(qt),
  );

  return allFound ? "fuzzy" : null;
}

export class InventoryLookupTool extends BaseTool {
  name = "inventory_lookup";
  description =
    "Search the machine inventory by name, IP, role, service, or tag. " +
    "Supports fuzzy matching. Use '*' to list all hosts. " +
    "Use this tool to discover available hosts before running remote operations.";
  parameters = {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Search keyword: host name, IP address, role, service, or tag. " +
          "Use '*' to list all hosts.",
      },
    },
    required: ["query"],
  };

  constructor() {
    super();
    this.requiresConfirmation = false;
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const query = String(args.query || "").trim();

    if (!query) {
      return {
        toolCallId: "",
        content: "Please provide a search query (host name, IP, role, service, or tag).",
        isError: true,
      };
    }

    const inventory = loadInventory();
    const hostNames = Object.keys(inventory.hosts);

    if (hostNames.length === 0) {
      return {
        toolCallId: "",
        content: "Inventory is empty. No hosts configured.",
      };
    }

    const matches: MatchResult[] = [];

    for (const [name, host] of Object.entries(inventory.hosts)) {
      if (query === "*") {
        matches.push({ name, host, matchType: "exact" });
        continue;
      }

      const mt = matchHost(query, name, host);
      if (mt) {
        matches.push({ name, host, matchType: mt });
      }
    }

    if (matches.length === 0) {
      return {
        toolCallId: "",
        content: `No hosts found matching "${query}". Available hosts: ${hostNames.join(", ")}. Try '*' to list all.`,
      };
    }

    // sort: exact matches first
    matches.sort((a, b) =>
      (a.matchType === "exact" ? -1 : 1) - (b.matchType === "exact" ? -1 : 1),
    );

    const lines: string[] = [`Found ${matches.length} host(s):\n`];

    for (const { name, host: h, matchType } of matches) {
      const tag = matchType === "fuzzy" ? " (fuzzy match)" : "";
      lines.push(`${name}${tag}`);
      lines.push(`  ip: ${h.ip}`);
      lines.push(`  port: ${h.port || 22}`);
      lines.push(`  username: ${h.username || "(default)"}`);
      if (h.role) lines.push(`  role: ${h.role}`);
      if (h.services.length > 0) lines.push(`  services: ${h.services.join(", ")}`);
      if (h.tags.length > 0) lines.push(`  tags: ${h.tags.join(", ")}`);
      lines.push(`  auth: ${h.password ? "password" : "key-based"}`);
      lines.push("");
    }

    return {
      toolCallId: "",
      content: lines.join("\n"),
    };
  }
}
