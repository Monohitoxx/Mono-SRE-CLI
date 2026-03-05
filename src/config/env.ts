import * as fs from "node:fs";
import * as path from "node:path";
import { config as dotenvConfig } from "dotenv";
import { EnvConfigSchema, type EnvConfig } from "../core/types.js";

function findReasonDir(): string {
  const localReason = path.resolve(process.cwd(), ".reason");
  if (fs.existsSync(localReason)) return localReason;

  const homeReason = path.resolve(
    process.env.HOME || process.env.USERPROFILE || "~",
    ".reason",
  );
  if (fs.existsSync(homeReason)) return homeReason;

  return localReason;
}

export function getReasonDir(): string {
  return findReasonDir();
}

export function loadEnvConfig(): EnvConfig {
  const reasonDir = findReasonDir();
  const envPath = path.join(reasonDir, ".env");

  if (fs.existsSync(envPath)) {
    dotenvConfig({ path: envPath });
  }

  const raw: Record<string, unknown> = {
    PROVIDER: (process.env.PROVIDER || "openai").toLowerCase(),
    MODEL: process.env.MODEL || "gpt-4o",
    APIKEY: process.env.APIKEY || "",
    API_BASE_URL: process.env.API_BASE_URL || undefined,
    TEMPERATURE: optionalFloat("TEMPERATURE"),
    TOP_P: optionalFloat("TOP_P"),
    TOP_K: optionalInt("TOP_K"),
    MAX_TOKENS: optionalInt("MAX_TOKENS"),
    REPETITION_PENALTY: optionalFloat("REPETITION_PENALTY"),
    FREQUENCY_PENALTY: optionalFloat("FREQUENCY_PENALTY"),
    PRESENCE_PENALTY: optionalFloat("PRESENCE_PENALTY"),
    SEED: optionalInt("SEED"),
    SHOW_FLOW: process.env.SHOW_FLOW === "true",
    ENABLE_THINKING: process.env.ENABLE_THINKING === "true",
    DEBUG_STREAM: process.env.DEBUG_STREAM === "true",
  };

  return EnvConfigSchema.parse(raw);
}

function optionalFloat(key: string): number | undefined {
  const val = process.env[key];
  if (val === undefined || val === "") return undefined;
  const n = parseFloat(val);
  return Number.isNaN(n) ? undefined : n;
}

function optionalInt(key: string): number | undefined {
  const val = process.env[key];
  if (val === undefined || val === "") return undefined;
  const n = parseInt(val, 10);
  return Number.isNaN(n) ? undefined : n;
}
