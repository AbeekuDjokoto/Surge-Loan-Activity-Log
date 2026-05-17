/**
 * Runs before Vitest collects test files — safe defaults so importing `src/`
 * modules never fails on missing `DATABASE_URL` / `REDIS_URL`.
 */

import "../../src/webcrypto-bootstrap";

process.env.NODE_ENV = "test";
process.env.PORT = process.env.PORT ?? "3999";
process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://surge:surge_dev_password@127.0.0.1:5432/surge_activity_log_test";
process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379/0";

/** Stable test secrets — never use outside automated tests */
process.env.JWT_ACCESS_SECRET =
  process.env.JWT_ACCESS_SECRET ?? "0123456789abcdef0123456789abcdef_access";
process.env.JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET ??
  "0123456789abcdef0123456789abcdef_refresh";
process.env.ACCESS_TOKEN_EXPIRES_IN =
  process.env.ACCESS_TOKEN_EXPIRES_IN ?? "15m";
process.env.REFRESH_TOKEN_EXPIRES_IN =
  process.env.REFRESH_TOKEN_EXPIRES_IN ?? "7d";
process.env.EMAIL_MODE = process.env.EMAIL_MODE ?? "console";
process.env.PASSWORD_RESET_URL_BASE =
  process.env.PASSWORD_RESET_URL_BASE ??
  "http://localhost:5173/reset-password";
