import pino from "pino";

/** Avoid importing `src/config/env` here so migrations can log without Redis. */
function resolveLevel(): string {
  const explicit = process.env.LOG_LEVEL?.trim();
  if (explicit) return explicit.toLowerCase();
  if (process.env.NODE_ENV === "test") return "silent";
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

export const logger = pino({
  level: resolveLevel(),
  base: undefined,
});
