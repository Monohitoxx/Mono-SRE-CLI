import { BaseTool } from "../base.js";
import type { ToolResult } from "../../core/types.js";
import type { Layer3Collector } from "../../memory/layer3-collector.js";
import { resolveTargets } from "../../config/inventory.js";

export class CollectInfraSnapshotTool extends BaseTool {
  name = "collect_infra_snapshot";
  description =
    "Collect a full infrastructure snapshot from remote host(s): CPU load, RAM, disk, installed packages, running services, and open ports. " +
    "Data is stored in the memory database for trend analysis and baseline comparison. " +
    "Target hosts by name, list, or inventory tags.";
  parameters = {
    type: "object",
    properties: {
      host: { type: "string", description: "Single host name from inventory" },
      hosts: { type: "array", items: { type: "string" }, description: "Array of host names" },
      tags: { type: "array", items: { type: "string" }, description: "Query hosts by tags (AND logic)" },
    },
    required: [],
  };

  private collector: Layer3Collector;

  constructor(collector: Layer3Collector) {
    super();
    this.requiresConfirmation = false;
    this.collector = collector;
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const targets = resolveTargets(args as { host?: string; hosts?: string[]; tags?: string[] });
      if (targets.length === 0) {
        return { toolCallId: "", content: "No hosts found matching the specified criteria. Use inventory_lookup to check available hosts.", isError: true };
      }

      const results = await this.collector.collectMultiple(targets);
      const lines: string[] = [`Collected snapshots from ${results.length} host(s):\n`];

      for (const r of results) {
        if (r.error) {
          lines.push(`[${r.host}] ERROR: ${r.error}`);
          continue;
        }
        const s = r.snapshot!;
        lines.push(`[${r.host}]`);
        if (s.cpu_load_1m !== null) lines.push(`  CPU Load: ${s.cpu_load_1m} / ${s.cpu_load_5m} / ${s.cpu_load_15m} (1m/5m/15m)`);
        if (s.ram_total_mb !== null) lines.push(`  RAM: ${s.ram_used_mb}MB used / ${s.ram_total_mb}MB total (${s.ram_available_mb}MB available)`);
        if (s.disk_total_gb !== null) lines.push(`  Disk: ${s.disk_used_gb}GB used / ${s.disk_total_gb}GB total (${s.disk_available_gb}GB available)`);
        if (s.services_json) {
          const svcs = JSON.parse(s.services_json) as string[];
          lines.push(`  Services: ${svcs.length} running`);
        }
        if (s.open_ports_json) {
          const ports = JSON.parse(s.open_ports_json) as string[];
          lines.push(`  Open ports: ${ports.length}`);
        }
        lines.push("");
      }

      return { toolCallId: "", content: lines.join("\n") };
    } catch (err) {
      return { toolCallId: "", content: (err as Error).message, isError: true };
    }
  }
}
