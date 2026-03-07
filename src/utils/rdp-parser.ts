/**
 * RDP file parser — extracts connection parameters from .rdp files
 * commonly downloaded from PAM systems like CyberArk.
 */

import { readFile } from "node:fs/promises";

export interface RdpConfig {
  /** Remote host address */
  address: string;
  /** RDP port (default 3389) */
  port: number;
  /** Username (may be empty if PAM injects credentials) */
  username: string;
  /** Domain (if any) */
  domain: string;
  /** Whether full-screen mode is requested */
  fullScreen: boolean;
  /** Screen width */
  desktopWidth: number;
  /** Screen height */
  desktopHeight: number;
  /** Gateway hostname (for CyberArk PSM gateways) */
  gatewayHostname: string;
  /** All raw key-value pairs from the file */
  raw: Record<string, string>;
}

/**
 * Parse an .rdp file and return structured config.
 * RDP files use the format:  key:type:value  (e.g., "full address:s:10.0.0.1:3389")
 */
export async function parseRdpFile(filePath: string): Promise<RdpConfig> {
  const content = await readFile(filePath, "utf-8");
  return parseRdpContent(content);
}

export function parseRdpContent(content: string): RdpConfig {
  const raw: Record<string, string> = {};

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) continue;

    // RDP format: key:type:value  where type is s (string), i (integer), b (binary)
    const match = trimmed.match(/^([^:]+):([sibt]):(.*)$/i);
    if (match) {
      const key = match[1]!.trim().toLowerCase();
      const value = match[3]!.trim();
      raw[key] = value;
    }
  }

  // "full address" may contain port like "10.0.0.1:3389"
  let address = raw["full address"] ?? "";
  let port = 3389;
  const addrMatch = address.match(/^(.+):(\d+)$/);
  if (addrMatch) {
    address = addrMatch[1]!;
    port = parseInt(addrMatch[2]!, 10);
  }
  if (raw["server port"]) {
    port = parseInt(raw["server port"], 10);
  }

  return {
    address,
    port,
    username: raw["username"] ?? "",
    domain: raw["domain"] ?? "",
    fullScreen: raw["screen mode id"] === "2",
    desktopWidth: parseInt(raw["desktopwidth"] ?? "1920", 10),
    desktopHeight: parseInt(raw["desktopheight"] ?? "1080", 10),
    gatewayHostname: raw["gatewayhostname"] ?? "",
    raw,
  };
}
