import { randomBytes } from "node:crypto";
import { DatabaseError, type PoolClient } from "pg";

import { hashPasswordResetToken } from "./passwordResetQueries";
import { pool } from "./pool";

/** Reuse same hashing as password reset tokens. */
function hashAdminInviteToken(raw: string): string {
  return hashPasswordResetToken(raw);
}

export async function emailHasAdminRole(email: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  const { rows } = await pool.query<{ n: string }>(
    `
    SELECT 1::text AS n
    FROM users u
    INNER JOIN user_roles ur ON ur.user_id = u.id
    INNER JOIN roles r ON r.id = ur.role_id AND r.code = 'admin'
    WHERE u.email = $1
    LIMIT 1
    `,
    [normalized]
  );
  return rows.length > 0;
}

/**
 * Replace pending invites for this email; insert new row. Returns raw token for email only.
 */
export async function createAdminInvite(params: {
  email: string;
  invitedByUserId: string;
  ttlHours: number;
}): Promise<{ rawToken: string; expiresAt: Date }> {
  const email = params.email.trim().toLowerCase();
  const rawToken = randomBytes(32).toString("base64url");
  const token_hash = hashAdminInviteToken(rawToken);
  const expiresAt = new Date(
    Date.now() + params.ttlHours * 60 * 60 * 1000
  );

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `DELETE FROM admin_invites
       WHERE email = $1::citext AND consumed_at IS NULL`,
      [email]
    );
    await client.query(
      `INSERT INTO admin_invites (email, token_hash, invited_by_user_id, expires_at)
       VALUES (lower(trim($1::text)), $2, $3::uuid, $4)`,
      [email, token_hash, params.invitedByUserId, expiresAt]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }

  return { rawToken, expiresAt };
}

async function assignAdminOnly(client: PoolClient, userId: string): Promise<void> {
  await client.query(`DELETE FROM user_roles WHERE user_id = $1::uuid`, [
    userId,
  ]);
  await client.query(
    `
    INSERT INTO user_roles (user_id, role_id)
    SELECT $1::uuid, r.id FROM roles r WHERE r.code = 'admin'
    `,
    [userId]
  );
}

export type ConsumeAdminInviteResult =
  | { ok: true; userId: string }
  | {
      ok: false;
      reason:
        | "invalid_or_expired"
        | "already_admin"
        | "needs_registration_fields"
        | "email_already_registered";
    };

/**
 * Consumes a valid invite: upgrades an existing non-admin user with token only, or creates a new
 * admin-only account when `password_hash`, `full_name`, and `location_station` are provided.
 */
export async function consumeAdminInvite(params: {
  rawToken: string;
  passwordHash?: string;
  full_name?: string;
  location_station?: string;
}): Promise<ConsumeAdminInviteResult> {
  const token_hash = hashAdminInviteToken(params.rawToken);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const sel = await client.query<{
      id: string;
      email: string;
    }>(
      `
      SELECT id, email::text AS email
      FROM admin_invites
      WHERE token_hash = $1
        AND consumed_at IS NULL
        AND expires_at > now()
      FOR UPDATE
      `,
      [token_hash]
    );
    const invite = sel.rows[0];
    if (!invite) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "invalid_or_expired" };
    }

    const email = invite.email.trim().toLowerCase();

    const existing = await client.query<{ id: string }>(
      `SELECT id FROM users WHERE email = $1::citext FOR UPDATE`,
      [email]
    );
    const existingUserId = existing.rows[0]?.id;

    if (existingUserId) {
      const adminCheck = await client.query<{ n: string }>(
        `
        SELECT 1::text AS n
        FROM user_roles ur
        INNER JOIN roles r ON r.id = ur.role_id AND r.code = 'admin'
        WHERE ur.user_id = $1::uuid
        LIMIT 1
        `,
        [existingUserId]
      );
      if (adminCheck.rows.length > 0) {
        await client.query("ROLLBACK");
        return { ok: false, reason: "already_admin" };
      }
      await assignAdminOnly(client, existingUserId);
      await client.query(
        `UPDATE admin_invites SET consumed_at = now() WHERE id = $1::uuid`,
        [invite.id]
      );
      await client.query("COMMIT");
      return { ok: true, userId: existingUserId };
    }

    const pw = params.passwordHash;
    const name = params.full_name?.trim();
    const loc = params.location_station?.trim();
    if (
      pw === undefined ||
      name === undefined ||
      loc === undefined ||
      name === "" ||
      loc === ""
    ) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "needs_registration_fields" };
    }

    let userId: string;
    try {
      const ins = await client.query<{ id: string }>(
        `
        INSERT INTO users (email, password_hash, full_name, location_station)
        VALUES (lower(trim($1::text)), $2, trim($3::text), trim($4::text))
        RETURNING id
        `,
        [email, pw, name, loc]
      );
      userId = ins.rows[0]?.id ?? "";
      if (!userId) throw new Error("unexpected empty RETURNING after INSERT users");
    } catch (err) {
      if (err instanceof DatabaseError && err.code === "23505") {
        await client.query("ROLLBACK").catch(() => undefined);
        return { ok: false, reason: "email_already_registered" };
      }
      throw err;
    }

    await client.query(
      `
      INSERT INTO user_roles (user_id, role_id)
      SELECT $1::uuid, r.id FROM roles r WHERE r.code = 'admin'
      `,
      [userId]
    );
    await client.query(
      `UPDATE admin_invites SET consumed_at = now() WHERE id = $1::uuid`,
      [invite.id]
    );
    await client.query("COMMIT");
    return { ok: true, userId };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
