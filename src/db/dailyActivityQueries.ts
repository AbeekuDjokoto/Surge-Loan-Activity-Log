import { DatabaseError } from "pg";

import { pool } from "./pool";

export type InsertDailyActivityInput = {
  agentUserId: string;
  agentFullName: string;
  location: string;
  applicationsCount: number;
  loanAmount: number;
  updateDateIso: string; // YYYY-MM-DD
};

export type DailyActivityRowDb = {
  id: string;
  agent_user_id: string;
  agent_full_name: string;
  location: string;
  applications_count: number;
  loan_amount: string;
  update_date_text: string;
  created_at: Date;
};

/** Thrown when the same agent already has activity for update_date */
export class DuplicateDailyActivityConflict extends Error {
  constructor() {
    super("Daily activity already exists for this date");
    this.name = "DuplicateDailyActivityConflict";
  }
}

function rowToDailyActivityPublic(row: DailyActivityRowDb): {
  id: string;
  agent_user_id: string;
  agent_full_name: string;
  location: string;
  applications_count: number;
  loan_amount: number;
  update_date: string;
  created_at: string;
} {
  return {
    id: row.id,
    agent_user_id: row.agent_user_id,
    agent_full_name: row.agent_full_name,
    location: row.location,
    applications_count: row.applications_count,
    loan_amount: Number(row.loan_amount),
    update_date: row.update_date_text,
    created_at: row.created_at.toISOString(),
  };
}

export async function insertDailyActivity(
  params: InsertDailyActivityInput
): Promise<ReturnType<typeof rowToDailyActivityPublic>> {
  try {
    const { rows } = await pool.query<DailyActivityRowDb>(
      `
      INSERT INTO daily_activity (
        agent_user_id,
        agent_full_name,
        location,
        applications_count,
        loan_amount,
        update_date
      )
      VALUES ($1::uuid, $2, $3, $4, $5, $6::date)
      RETURNING id, agent_user_id, agent_full_name, location, applications_count,
                loan_amount, update_date::text AS update_date_text, created_at
      `,
      [
        params.agentUserId,
        params.agentFullName,
        params.location,
        params.applicationsCount,
        params.loanAmount,
        params.updateDateIso,
      ]
    );
    const row = rows[0];
    if (!row) throw new Error("unexpected empty RETURNING after INSERT daily_activity");
    return rowToDailyActivityPublic(row);
  } catch (err) {
    if (
      err instanceof DatabaseError &&
      err.code === "23505"
    ) {
      throw new DuplicateDailyActivityConflict();
    }
    throw err;
  }
}
