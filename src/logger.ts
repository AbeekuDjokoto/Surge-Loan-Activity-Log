import { createRequire } from "node:module";
import path from "node:path";

import pino from "pino";

/** Avoid importing `src/config/env` here so migrations can log without Redis. */
function resolveLevel(): string {
  const explicit = process.env.LOG_LEVEL?.trim();
  if (explicit) return explicit.toLowerCase();
  if (process.env.NODE_ENV === "test") return "silent";
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

function isPinoPrettyInstalled(): boolean {
  try {
    createRequire(path.join(process.cwd(), "package.json")).resolve(
      "pino-pretty"
    );
    return true;
  } catch {
    return false;
  }
}

function wantsPrettyStdout(): boolean {
  if (process.env.NODE_ENV === "test") return false;
  if (process.env.NODE_ENV === "production") return false;
  if (process.env.LOG_PRETTY === "0") return false;
  if (
    !(process.env.NODE_ENV === "development" || process.env.LOG_PRETTY === "1")
  )
    return false;
  /** Render / `npm ci --omit=dev` omit `pino-pretty`; fall back to JSON. */
  return isPinoPrettyInstalled();
}

/** Human-readable HTTP lines during `NODE_ENV=development` (npm run dev). Disable with LOG_PRETTY=0. */
export const logger = wantsPrettyStdout()
  ? pino({
      level: resolveLevel(),
      base: undefined,
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: true,
          ignore: "pid,hostname",
          singleLine: true,
        },
      },
    })
  : pino({
      level: resolveLevel(),
      base: undefined,
    });
