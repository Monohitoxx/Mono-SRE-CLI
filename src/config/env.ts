import * as fs from "node:fs";
import * as path from "node:path";
import { config as dotenvConfig } from "dotenv";
import { EnvConfigSchema, type EnvConfig } from "../core/types.js";

function findMonoDir(): string {
  const localMono = path.resolve(process.cwd(), ".mono");
  if (fs.existsSync(localMono)) return localMono;

  const homeMono = path.resolve(
    process.env.HOME || process.env.USERPROFILE || "~",
    ".mono",
  );
  if (fs.existsSync(homeMono)) return homeMono;

  return localMono;
}

export function getMonoDir(): string {
  return findMonoDir();
}

export function loadEnvConfig(): EnvConfig {
  const monoDir = findMonoDir();
  const envPath = path.join(monoDir, ".env");

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
    CONTEXT_LIMIT: optionalInt("CONTEXT_LIMIT"),
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
