import { config } from "dotenv";
import { z } from "zod";

import { databaseSchema } from "./databaseEnv";

config();

/** Short-lived bearer token durations: e.g. "15m", "1h"; refresh: e.g. "7d", "86400s" (digits + smhd suffix). */
const durationSuffixSchema = z
  .string()
  .regex(
    /^[1-9]\d*[smhd]$/,
    "must be digits followed by unit s, m, h, or d (e.g. 15m, 7d)"
  );

const serverEnvSchema = databaseSchema.extend({
  // Keep `test` for Vitest; optional `development` for local verbose API errors.
  // Deployed builds should use `production`.
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("production"),
  PORT: z.coerce.number().int().positive().default(3000),
  REDIS_URL: z
    .string()
    .min(1, "REDIS_URL is required")
    .url()
    .refine(
      (u) => u.startsWith("redis://") || u.startsWith("rediss://"),
      "REDIS_URL must be a redis:// or rediss:// URL"
    ),
  // Comma-separated browser origins. Required for cross-origin browser access to the API.
  // Same-origin tools (curl, server-side `fetch`, `/api-docs` on this host) work without it.
  CORS_ORIGINS: z.string().optional(),
  JWT_ACCESS_SECRET: z
    .string()
    .min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
  JWT_REFRESH_SECRET: z
    .string()
    .min(32, "JWT_REFRESH_SECRET must be at least 32 characters"),
  ACCESS_TOKEN_EXPIRES_IN: durationSuffixSchema.default("15m"),
  REFRESH_TOKEN_EXPIRES_IN: durationSuffixSchema.default("7d"),
  /** `console` logs reset links; `smtp` sends mail (requires SMTP_* and MAIL_FROM). */
  EMAIL_MODE: z.enum(["console", "smtp"]).default("console"),
  /** SPA reset page without query string; override in production. */
  PASSWORD_RESET_URL_BASE: z
    .string()
    .url()
    .default("http://localhost:5173/reset-password"),
  PASSWORD_RESET_TOKEN_TTL_HOURS: z.coerce.number().int().positive().max(168).default(1),
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().positive().max(65535).optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SECURE: z.coerce.boolean().default(false),
  MAIL_FROM: z.string().min(1).optional(),
})
  .superRefine((data, ctx) => {
    if (data.EMAIL_MODE !== "smtp") return;
    const need = (
      key: keyof typeof data,
      message: string
    ): void => {
      const v = data[key];
      if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message,
          path: [key as string],
        });
      }
    };
    need("SMTP_HOST", "SMTP_HOST is required when EMAIL_MODE=smtp");
    need("MAIL_FROM", "MAIL_FROM is required when EMAIL_MODE=smtp");
  });

export type Env = z.infer<typeof serverEnvSchema>;

function loadServerEnv(): Env {
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error(parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment variables");
  }
  return parsed.data;
}

export const env = loadServerEnv();
