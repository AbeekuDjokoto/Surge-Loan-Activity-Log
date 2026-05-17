import { DatabaseError, type Pool, type PoolClient } from "pg";

import { pool } from "./pool";

type Runner = Pool | PoolClient;

export type UserPublicRow = {
  id: string;
  email: string;
  full_name: string;
  location_station: string;
  email_verified_at: Date | null;
  roles: string[];
};

async function rolesForUserId(
  runner: Pool | PoolClient,
  userId: string
): Promise<string[]> {
  const { rows } = await runner.query<{ code: string }>(
    `SELECT r.code
     FROM user_roles ur
     INNER JOIN roles r ON r.id = ur.role_id
     WHERE ur.user_id = $1
     ORDER BY r.code ASC`,
    [userId]
  );
  return rows.map((r) => r.code);
}

export async function selectUserCredentialByEmail(
  runner: Runner,
  email: string
): Promise<{ id: string; password_hash: string } | null> {
  const { rows } = await runner.query<{ id: string; password_hash: string }>(
    `SELECT id, password_hash FROM users WHERE email = $1`,
    [email.trim().toLowerCase()]
  );
  return rows[0] ?? null;
}

export async function selectUserIdByEmail(
  runner: Runner,
  email: string
): Promise<string | null> {
  const { rows } = await runner.query<{ id: string }>(
    `SELECT id FROM users WHERE email = $1`,
    [email.trim().toLowerCase()]
  );
  return rows[0]?.id ?? null;
}

/** Full profile with role codes sorted for stable JWT payloads. */
export async function selectUserPublicById(
  userId: string
): Promise<UserPublicRow | null> {
  const { rows } = await pool.query<{
    id: string;
    email: string;
    full_name: string;
    location_station: string;
    email_verified_at: Date | null;
  }>(
    `SELECT id, email, full_name, location_station, email_verified_at
     FROM users
     WHERE id = $1`,
    [userId]
  );
  const row = rows[0];
  if (!row) return null;

  const roles = await rolesForUserId(pool, row.id);

  return {
    ...row,
    roles,
  };
}

export type UpdateUserProfilePatch = {
  full_name?: string;
  location_station?: string;
  email?: string;
};

/** Partial update; at least one field should be set (caller validates). */
export async function updateUserProfileById(params: {
  userId: string;
  patch: UpdateUserProfilePatch;
}): Promise<UserPublicRow | null> {
  const { patch } = params;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cur = await client.query<{
      email: string;
    }>(
      `SELECT email::text AS email FROM users WHERE id = $1::uuid`,
      [params.userId]
    );
    const current = cur.rows[0];
    if (!current) {
      await client.query("ROLLBACK");
      return null;
    }

    const normalizedEmail =
      patch.email !== undefined
        ? patch.email.trim().toLowerCase()
        : undefined;
    const emailChanged =
      normalizedEmail !== undefined &&
      normalizedEmail !== current.email.toLowerCase();

    const fragments: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (patch.full_name !== undefined) {
      fragments.push(`full_name = $${i++}`);
      values.push(patch.full_name.trim());
    }
    if (patch.location_station !== undefined) {
      fragments.push(`location_station = $${i++}`);
      values.push(patch.location_station.trim());
    }
    if (normalizedEmail !== undefined) {
      fragments.push(`email = $${i++}::citext`);
      values.push(normalizedEmail);
      if (emailChanged) {
        fragments.push(`email_verified_at = NULL`);
      }
    }

    if (fragments.length === 0) {
      await client.query("ROLLBACK");
      return selectUserPublicById(params.userId);
    }

    values.push(params.userId);
    await client.query(
      `UPDATE users SET ${fragments.join(", ")} WHERE id = $${i}::uuid`,
      values
    );
    await client.query("COMMIT");
    return selectUserPublicById(params.userId);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);

    if (err instanceof DatabaseError) {
      if (err.code === "23505") throw new DuplicateEmailConflict();
    }

    throw err;
  } finally {
    client.release();
  }
}

/** Insert user plus default role `user` in one transaction (caller supplies password hash). */
export async function insertUserAndAssignRole(params: {
  email: string;
  full_name: string;
  location_station: string;
  password_hash: string;
  default_role_code?: string;
}): Promise<UserPublicRow> {
  const defaultRoleCode = params.default_role_code ?? "user";
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const insert = await client.query<{
      id: string;
      email: string;
      full_name: string;
      location_station: string;
      email_verified_at: Date | null;
    }>(
      `
      INSERT INTO users (email, password_hash, full_name, location_station)
      VALUES (lower(trim($1::text)), $2, trim($3::text), trim($4::text))
      RETURNING id, email, full_name, location_station, email_verified_at
      `,
      [
        params.email,
        params.password_hash,
        params.full_name,
        params.location_station,
      ]
    );
    const u = insert.rows[0];
    if (!u)
      throw new Error("unexpected empty RETURNING clause after INSERT users");

    await client.query(
      `
      INSERT INTO user_roles (user_id, role_id)
      SELECT $1::uuid, r.id FROM roles r WHERE r.code = $2
      `,
      [u.id, defaultRoleCode]
    );

    await client.query("COMMIT");

    const roles = await rolesForUserId(pool, u.id);

    return { ...u, roles };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);

    if (err instanceof DatabaseError) {
      if (err.code === "23505") throw new DuplicateEmailConflict();
      if (err.code === "23503") throw new MissingRoleConflict();
    }

    throw err;
  } finally {
    client.release();
  }
}

/** Thrown when `email` violates unique constraint. */
export class DuplicateEmailConflict extends Error {
  constructor() {
    super("Email is already registered");
    this.name = "DuplicateEmailConflict";
  }
}

/** Thrown when default role seed is broken. */
export class MissingRoleConflict extends Error {
  constructor() {
    super("Default role missing in database seed");
    this.name = "MissingRoleConflict";
  }
}
