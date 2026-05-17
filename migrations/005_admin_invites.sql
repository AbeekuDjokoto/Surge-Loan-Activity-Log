-- Single-use admin invitation tokens (raw token hashed like password reset).

CREATE TABLE admin_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext NOT NULL,
  token_hash text NOT NULL,
  invited_by_user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX admin_invites_token_hash_key
  ON admin_invites (token_hash);

CREATE INDEX admin_invites_email_pending_idx
  ON admin_invites (email)
  WHERE consumed_at IS NULL;
