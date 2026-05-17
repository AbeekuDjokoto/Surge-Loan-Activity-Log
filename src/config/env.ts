import { config } from "dotenv";
import { z } from "zod";

import { databaseSchema } from "./databaseEnv";

config();

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
