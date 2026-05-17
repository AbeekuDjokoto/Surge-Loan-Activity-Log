-- Users, roles (RBAC-ready), signup defaults.

CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE roles (
  id smallserial PRIMARY KEY,
  code text NOT NULL UNIQUE
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext NOT NULL UNIQUE,
  password_hash text NOT NULL,
  full_name text NOT NULL,
  location_station text NOT NULL,
  email_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_roles (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role_id smallint NOT NULL REFERENCES roles (id) ON DELETE RESTRICT,
  PRIMARY KEY (user_id, role_id)
);

CREATE INDEX user_roles_role_id_idx ON user_roles (role_id);

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE PROCEDURE set_updated_at();

INSERT INTO roles (code)
VALUES ('user'), ('admin')
ON CONFLICT (code) DO NOTHING;
