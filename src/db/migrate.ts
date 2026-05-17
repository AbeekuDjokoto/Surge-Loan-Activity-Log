import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import type { PoolClient } from "pg";

import { pool } from "./pool";

const MIGRATIONS_DIR = path.join(process.cwd(), "migrations");

async function ensureMigrationTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

async function getAppliedFilenames(client: PoolClient): Promise<Set<string>> {
  const { rows } = await client.query<{ filename: string }>(
    `SELECT filename FROM schema_migrations`
  );
  return new Set(rows.map((r) => r.filename));
}

async function listMigrationFiles(): Promise<string[]> {
  const entries = await fs.readdir(MIGRATIONS_DIR, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith(".sql"))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
  return files;
}

async function run(): Promise<void> {
  const client = await pool.connect();
  try {
    await ensureMigrationTable(client);

    const applied = await getAppliedFilenames(client);
    const files = await listMigrationFiles();

    let ran = 0;
    for (const file of files) {
      if (applied.has(file)) continue;

      const fullPath = path.join(MIGRATIONS_DIR, file);
      const sql = await fs.readFile(fullPath, "utf8");

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          `INSERT INTO schema_migrations (filename) VALUES ($1)`,
          [file]
        );
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }

      ran += 1;
      console.info(`Applied migration: ${file}`);
    }

    if (ran === 0) console.info("No pending migrations.");
    else console.info(`Completed ${ran} migration(s).`);
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
