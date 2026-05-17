-- Single-use password reset tokens (raw token never stored; SHA-256 hex in token_hash).

CREATE TABLE password_reset_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX password_reset_tokens_token_hash_key
  ON password_reset_tokens (token_hash);

CREATE INDEX password_reset_tokens_user_id_idx
  ON password_reset_tokens (user_id);
