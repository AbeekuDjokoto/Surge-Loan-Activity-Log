-- Agent daily activity rows (one per agent per calendar reporting date).

CREATE TABLE daily_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  agent_full_name text NOT NULL,
  location text NOT NULL,
  applications_count integer NOT NULL CHECK (applications_count >= 0),
  loan_amount numeric(14, 2) NOT NULL CHECK (loan_amount >= 0),
  update_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX daily_activity_agent_user_update_date_uidx ON daily_activity (agent_user_id, update_date);

CREATE INDEX daily_activity_update_date_idx ON daily_activity (update_date);
