import * as fs from "node:fs";
import * as path from "node:path";
import { getReasonDir } from "./env.js";

// ─── Types ───────────────────────────────────────────────────────────────

export interface Host {
  ip: string;
  port?: number;
  username?: string;
  password?: string;
  privateKeyPath?: string;
  role?: string;
  services: string[];
  tags: string[];
}

export interface Inventory {
  hosts: Record<string, Host>;
}

export interface HostEntry {
  name: string;
  host: Host;
}

// ─── File I/O ────────────────────────────────────────────────────────────

function getInventoryPath(): string {
  return path.join(getReasonDir(), "inventory.json");
}

export function loadInventory(): Inventory {
  const inventoryPath = getInventoryPath();

  if (!fs.existsSync(inventoryPath)) {
    return { hosts: {} };
  }

  try {
    const raw = JSON.parse(fs.readFileSync(inventoryPath, "utf-8"));

    // Handle new format
    if (raw.hosts && typeof raw.hosts === "object") {
      return raw as Inventory;
    }

    // Migrate legacy format: { "env": [{ name, host, port, username, password }] }
    const migrated: Inventory = { hosts: {} };
    for (const [env, machines] of Object.entries(raw)) {
      if (!Array.isArray(machines)) continue;
      for (const m of machines as Array<Record<string, unknown>>) {
        const name = (m.name as string) || `${env}_${Object.keys(migrated.hosts).length}`;
        migrated.hosts[name] = {
          ip: (m.host as string) || "",
          port: (m.port as number) || 22,
          username: (m.username as string) || undefined,
          password: (m.password as string) || undefined,
          role: env,
          services: [],
          tags: [env],
        };
      }
    }
    return migrated;
  } catch {
    return { hosts: {} };
  }
}

export function saveInventory(inventory: Inventory): void {
  const inventoryPath = getInventoryPath();
  const dir = path.dirname(inventoryPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(inventoryPath, JSON.stringify(inventory, null, 2), "utf-8");
}

// ─── CRUD ────────────────────────────────────────────────────────────────

export function addHost(name: string, host: Host): string {
  const inventory = loadInventory();

  if (inventory.hosts[name]) {
    Object.assign(inventory.hosts[name], host);
    saveInventory(inventory);
    return `Updated host "${name}".`;
  }

  inventory.hosts[name] = host;
  saveInventory(inventory);
  return `Added host "${name}".`;
}

export function removeHost(name: string): string {
  const inventory = loadInventory();

  if (!inventory.hosts[name]) {
    return `Host "${name}" not found.`;
  }

  delete inventory.hosts[name];
  saveInventory(inventory);
  return `Removed host "${name}".`;
}

export function findHost(name: string): HostEntry | undefined {
  const inventory = loadInventory();
  const host = inventory.hosts[name];
  if (host) return { name, host };
  return undefined;
}

// ─── Query Functions ─────────────────────────────────────────────────────

/**
 * Returns hosts matching ALL given tags (AND logic).
 */
export function queryByTags(tags: string[]): HostEntry[] {
  const inventory = loadInventory();
  const lowerTags = tags.map((t) => t.toLowerCase());
  const results: HostEntry[] = [];

  for (const [name, host] of Object.entries(inventory.hosts)) {
    const hostTags = host.tags.map((t) => t.toLowerCase());
    if (lowerTags.every((t) => hostTags.includes(t))) {
      results.push({ name, host });
    }
  }

  return results;
}

/**
 * Returns hosts that have the given service in their services list.
 */
export function queryByService(service: string): HostEntry[] {
  const inventory = loadInventory();
  const lowerService = service.toLowerCase();
  const results: HostEntry[] = [];

  for (const [name, host] of Object.entries(inventory.hosts)) {
    if (host.services.some((s) => s.toLowerCase() === lowerService)) {
      results.push({ name, host });
    }
  }

  return results;
}

/**
 * Resolve targeting parameters into a list of hosts.
 * Accepts: host (single name), hosts (array of names), tags (array for AND query).
 * At least one must be provided.
 */
export function resolveTargets(args: {
  host?: string;
  hosts?: string[];
  tags?: string[];
}): HostEntry[] {
  const inventory = loadInventory();

  // tags query
  if (args.tags && args.tags.length > 0) {
    return queryByTags(args.tags);
  }

  // multiple hosts
  if (args.hosts && args.hosts.length > 0) {
    const results: HostEntry[] = [];
    for (const name of args.hosts) {
      const host = inventory.hosts[name];
      if (host) {
        results.push({ name, host });
      }
    }
    return results;
  }

  // single host
  if (args.host) {
    const host = inventory.hosts[args.host];
    if (host) {
      return [{ name: args.host, host }];
    }
    return [];
  }

  return [];
}

// ─── Prompt Hints ────────────────────────────────────────────────────────

export function formatInventoryHint(): string {
  const inventory = loadInventory();
  const hostNames = Object.keys(inventory.hosts);

  if (hostNames.length === 0) return "";

  const allTags = new Set<string>();
  const allServices = new Set<string>();
  const allRoles = new Set<string>();

  for (const host of Object.values(inventory.hosts)) {
    host.tags.forEach((t) => allTags.add(t));
    host.services.forEach((s) => allServices.add(s));
    if (host.role) allRoles.add(host.role);
  }

  return [
    "",
    "## Machine Inventory",
    `${hostNames.length} host(s) configured: ${hostNames.join(", ")}`,
    allTags.size > 0 ? `Tags: ${[...allTags].join(", ")}` : "",
    allServices.size > 0 ? `Services: ${[...allServices].join(", ")}` : "",
    allRoles.size > 0 ? `Roles: ${[...allRoles].join(", ")}` : "",
    "",
    "Use the remote tools (execute_command, read_config, write_config, service_control, run_healthcheck) to operate on hosts.",
    "Each tool accepts `host` (single name), `hosts` (array), or `tags` (array, AND logic) for targeting.",
    "Use inventory_lookup to browse available hosts before operating.",
    "Example: service_control({ tags: ['hk', 'prod'], service: 'unbound', action: 'reload' })",
  ]
    .filter(Boolean)
    .join("\n");
}
