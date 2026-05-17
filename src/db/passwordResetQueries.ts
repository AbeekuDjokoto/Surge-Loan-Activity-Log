import { createHash, randomBytes } from "node:crypto";

import { pool } from "./pool";

export function hashPasswordResetToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

/**
 * Replace any pending tokens for this user, insert a new row, return the raw secret for email only.
 */
export async function createPasswordResetToken(params: {
  userId: string;
  ttlHours: number;
}): Promise<{ rawToken: string; expiresAt: Date }> {
  const rawToken = randomBytes(32).toString("base64url");
  const token_hash = hashPasswordResetToken(rawToken);
  const expiresAt = new Date(
    Date.now() + params.ttlHours * 60 * 60 * 1000
  );

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `DELETE FROM password_reset_tokens
       WHERE user_id = $1::uuid AND used_at IS NULL`,
      [params.userId]
    );
    await client.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1::uuid, $2, $3)`,
      [params.userId, token_hash, expiresAt]
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

export type ConsumePasswordResetResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "invalid_or_expired" };

/** Single-use: set password, mark token used, drop other pending tokens for user. */
export async function consumePasswordResetToken(params: {
  rawToken: string;
  passwordHash: string;
}): Promise<ConsumePasswordResetResult> {
  const token_hash = hashPasswordResetToken(params.rawToken);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const sel = await client.query<{ id: string; user_id: string }>(
      `SELECT id, user_id
       FROM password_reset_tokens
       WHERE token_hash = $1
         AND used_at IS NULL
         AND expires_at > now()
       FOR UPDATE`,
      [token_hash]
    );
    const row = sel.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "invalid_or_expired" };
    }

    await client.query(
      `UPDATE users SET password_hash = $1 WHERE id = $2::uuid`,
      [params.passwordHash, row.user_id]
    );
    await client.query(
      `UPDATE password_reset_tokens SET used_at = now() WHERE id = $1::uuid`,
      [row.id]
    );
    await client.query(
      `DELETE FROM password_reset_tokens
       WHERE user_id = $1::uuid AND used_at IS NULL AND id <> $2::uuid`,
      [row.user_id, row.id]
    );
    await client.query("COMMIT");
    return { ok: true, userId: row.user_id };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
