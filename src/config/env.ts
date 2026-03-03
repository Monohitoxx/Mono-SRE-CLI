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

  const raw = {
    PROVIDER: (process.env.PROVIDER || "openai").toLowerCase(),
    MODEL: process.env.MODEL || "gpt-4o",
    APIKEY: process.env.APIKEY || "",
    API_BASE_URL: process.env.API_BASE_URL || undefined,
  };

  return EnvConfigSchema.parse(raw);
}
