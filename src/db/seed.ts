/**
 * Idempotent admin user provisioning (PostgreSQL via DATABASE_URL).
 * Run after `npm run db:migrate`. Configure SEED_ADMIN_* vars (see `.env.example`).
 */
import process from "node:process";
import { z } from "zod";

import { hashPassword } from "../auth/password";
import { pool } from "./pool";

const seedEnvSchema = z.object({
  SEED_ADMIN_EMAIL: z.string().trim().email().max(320),
  SEED_ADMIN_PASSWORD: z.string().min(12).max(200),
  SEED_ADMIN_FULL_NAME: z.string().trim().min(1).max(200),
  SEED_ADMIN_LOCATION: z.string().trim().min(1).max(200),
});

async function run(): Promise<void> {
  const parsed = seedEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error(
      "Seed env invalid:",
      parsed.error.flatten().fieldErrors as Record<string, string[]>
    );
    process.exitCode = 1;
    return;
  }
  const { SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD, SEED_ADMIN_FULL_NAME, SEED_ADMIN_LOCATION } =
    parsed.data;
  const email = SEED_ADMIN_EMAIL.toLowerCase();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    try {
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM users WHERE email = lower(trim($1::text))`,
        [email]
      );

      let userId: string;

      if (existing.rows[0]?.id) {
        userId = existing.rows[0].id;
        console.info(`Seed admin: user exists for ${email}, ensuring admin role only`);
      } else {
        const password_hash = await hashPassword(SEED_ADMIN_PASSWORD);
        const ins = await client.query<{ id: string }>(
          `
        INSERT INTO users (email, password_hash, full_name, location_station)
        VALUES (lower(trim($1::text)), $2, trim($3::text), trim($4::text))
        RETURNING id
        `,
          [email, password_hash, SEED_ADMIN_FULL_NAME, SEED_ADMIN_LOCATION]
        );
        userId = ins.rows[0]?.id ?? "";
        if (!userId) {
          await client.query("ROLLBACK");
          console.error("Seed admin: insert returned no id");
          process.exitCode = 1;
          return;
        }
        console.info(`Seed admin: created user ${email}`);
      }

      await client.query(`DELETE FROM user_roles WHERE user_id = $1::uuid`, [userId]);

      await client.query(
        `
      INSERT INTO user_roles (user_id, role_id)
      SELECT $1::uuid, r.id FROM roles r WHERE r.code = 'admin'
      `,
        [userId]
      );
      await client.query("COMMIT");
      console.info("Seed admin: admin role assigned (user role stripped if present)");
    } catch (inner) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw inner;
    }
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error(err);
  pool.end().catch(() => undefined);
  process.exitCode = 1;
});
