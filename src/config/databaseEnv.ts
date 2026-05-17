import { config } from "dotenv";
import { z } from "zod";

config();

/** Used by Postgres pool and `db:migrate` (no Redis required). */
export const databaseSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required")
    .url()
    .refine((u) => u.startsWith("postgres"), "DATABASE_URL must be a postgres URL"),
});
