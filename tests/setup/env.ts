/**
 * Runs before Vitest collects test files — safe defaults so importing `src/`
 * modules never fails on missing `DATABASE_URL` / `REDIS_URL`.
 */
process.env.NODE_ENV = "test";
process.env.PORT = process.env.PORT ?? "3999";
process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://surge:surge_dev_password@127.0.0.1:5432/surge_activity_log";
process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379/0";
