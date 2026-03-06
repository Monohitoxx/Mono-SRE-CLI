import { ToolRegistry } from "../tools/registry.js";
import type { BaseTool } from "../tools/base.js";
import type { ToolFilterType } from "./types.js";

/**
 * Tools considered safe for read-only subagents.
 * These tools only gather information and cannot modify state.
 */
const READONLY_TOOLS = new Set([
  // Remote read-only
  "execute_command",  // will be wrapped with read-only enforcement
  "read_config",
  "run_healthcheck",
  "inventory_lookup",
  // Infra read-only
  "get_service_status",
  "get_system_metrics",
  "check_port",
  "get_logs",
  "check_disk_usage",
  // Monitor read-only
  "get_alerts",
  "query_metrics",
  "check_uptime",
  "get_incident_timeline",
  // Local read-only
  "shell",  // will be wrapped with read-only enforcement
  "read_file",
  "read_many_files",
  "grep_search",
  // Web
  "web_search",
  "web_fetch",
  // Memory query
  "collect_infra_snapshot",
  "query_user_habits",
  "query_infra_state",
  // Interaction
  "ask_user",
]);

/**
 * Dangerous tools excluded from "full" access filter.
 * These can cause significant system changes that should only
 * be done by the main agent with user confirmation.
 */
const DANGEROUS_TOOLS = new Set([
  "delegate_task",  // prevent recursive subagent spawning
]);

/**
 * Create a filtered ToolRegistry containing only the allowed tools.
 */
export function createFilteredRegistry(
  sourceRegistry: ToolRegistry,
  filterType: ToolFilterType,
  allowedTools?: string[],
  deniedTools?: string[],
): ToolRegistry {
  const filtered = new ToolRegistry();

  const allDefs = sourceRegistry.getDefinitions();

  for (const def of allDefs) {
    const tool = sourceRegistry.getTool(def.name);
    if (!tool) continue;

    if (shouldIncludeTool(def.name, filterType, allowedTools, deniedTools)) {
      filtered.register(tool);
    }
  }

  return filtered;
}

function shouldIncludeTool(
  toolName: string,
  filterType: ToolFilterType,
  allowedTools?: string[],
  deniedTools?: string[],
): boolean {
  switch (filterType) {
    case "readonly":
      return READONLY_TOOLS.has(toolName);

    case "full":
      return !DANGEROUS_TOOLS.has(toolName);

    case "custom":
      if (allowedTools && allowedTools.length > 0) {
        // Whitelist mode
        return allowedTools.includes(toolName);
      }
      if (deniedTools && deniedTools.length > 0) {
        // Blacklist mode
        return !deniedTools.includes(toolName);
      }
      return true;

    case "none":
      // No filtering — all tools available (except recursive delegation)
      return toolName !== "delegate_task";

    default:
      return false;
  }
}
