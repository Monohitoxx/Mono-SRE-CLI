import type { Command } from "./types.js";
import {
  addHost,
  removeHost,
  loadInventory,
  type Host,
} from "../config/inventory.js";

const USAGE = [
  "Usage:",
  "  /init add <name>,<ip>,<username>,<password>[,<port>]",
  "  /init list",
  "  /init remove <host_name>",
  "",
  "Examples:",
  "  /init add hk01,10.0.1.1,deploy,mypass",
  "  /init add hk02,10.0.1.2,deploy,mypass,2222",
  "  /init list",
  "  /init remove hk01",
  "",
  "Tags, role, and services can be edited in .reason/inventory.json directly.",
].join("\n");

export const init: Command = {
  name: "init",
  description: "Manage machine inventory",
  isEnabled: true,
  execute: (_ctx, args) => {
    if (!args) {
      return { type: "message", content: USAGE };
    }

    const parts = args.split(/\s+/);
    const subCommand = parts[0];

    switch (subCommand) {
      case "add": {
        const data = parts.slice(1).join(" ");
        return handleAdd(data);
      }
      case "list":
        return listAll();
      case "remove":
      case "rm": {
        const hostName = parts[1];
        if (!hostName) {
          return {
            type: "message",
            content: "Missing host name.\n\n" + USAGE,
          };
        }
        return {
          type: "message",
          content: removeHost(hostName),
        };
      }
      default:
        return { type: "message", content: `Unknown sub-command: ${subCommand}\n\n${USAGE}` };
    }
  },
};

function handleAdd(data: string): { type: "message"; content: string } {
  if (!data) {
    return {
      type: "message",
      content: "Missing host data.\n\n" + USAGE,
    };
  }

  const fields = data.split(",").map((f) => f.trim());

  if (fields.length < 4) {
    return {
      type: "message",
      content:
        "Need at least: name,ip,username,password\n\n" + USAGE,
    };
  }

  const [name, ip, username, password, portStr] = fields;
  const port = portStr ? Number.parseInt(portStr, 10) : 22;

  if (portStr && Number.isNaN(port)) {
    return {
      type: "message",
      content: `Invalid port: ${portStr}`,
    };
  }

  const host: Host = {
    ip,
    port,
    username,
    password,
    services: [],
    tags: [],
  };
  const result = addHost(name, host);

  return { type: "message", content: result };
}

function listAll(): { type: "message"; content: string } {
  const inventory = loadInventory();
  const hostNames = Object.keys(inventory.hosts);

  if (hostNames.length === 0) {
    return {
      type: "message",
      content: "No hosts configured. Use /init add ... to add hosts.",
    };
  }

  const lines: string[] = [`${hostNames.length} host(s):`];
  for (const [name, h] of Object.entries(inventory.hosts)) {
    const tags = h.tags.length > 0 ? ` [${h.tags.join(", ")}]` : "";
    const role = h.role ? ` (${h.role})` : "";
    const services = h.services.length > 0 ? ` services: ${h.services.join(", ")}` : "";
    lines.push(`  ${name}  ${h.ip}:${h.port || 22}  ${h.username || "root"}${role}${tags}${services}`);
  }

  return { type: "message", content: lines.join("\n") };
}
