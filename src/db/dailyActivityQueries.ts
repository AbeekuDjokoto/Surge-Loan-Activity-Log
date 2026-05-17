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

export type DailyActivityListFilters = {
  agentUserId?: string | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
  loanMin?: number | undefined;
  loanMax?: number | undefined;
  locationSubstring?: string | undefined;
  nameSubstring?: string | undefined;
};

export type DailyActivityListItemPublic = {
  id: string;
  agent_uuid: string;
  agent_full_name: string;
  location: string;
  applications: number;
  total_amount: number;
  submitted: string;
  date: string;
};

export type DailyActivityListSummary = {
  total_updates: number;
  total_loan_amount: number;
  total_applications: number;
  last_update: string | null;
};

export type PaginatedDailyActivityResult = {
  items: DailyActivityListItemPublic[];
  total_items: number;
  summary: DailyActivityListSummary;
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

export function dbRowToListItem(row: DailyActivityRowDb): DailyActivityListItemPublic {
  return {
    id: row.id,
    agent_uuid: row.agent_user_id,
    agent_full_name: row.agent_full_name,
    location: row.location,
    applications: row.applications_count,
    total_amount: Number(row.loan_amount),
    submitted: row.created_at.toISOString(),
    date: row.update_date_text,
  };
}

function buildDailyActivityWhereClause(filters: DailyActivityListFilters): {
  whereSql: string;
  values: unknown[];
} {
  const fragments: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  if (filters.agentUserId !== undefined) {
    fragments.push(`da.agent_user_id = $${i++}::uuid`);
    values.push(filters.agentUserId);
  }
  if (filters.dateFrom !== undefined) {
    fragments.push(`da.update_date >= $${i++}::date`);
    values.push(filters.dateFrom);
  }
  if (filters.dateTo !== undefined) {
    fragments.push(`da.update_date <= $${i++}::date`);
    values.push(filters.dateTo);
  }
  if (filters.loanMin !== undefined) {
    fragments.push(`da.loan_amount >= $${i++}`);
    values.push(filters.loanMin);
  }
  if (filters.loanMax !== undefined) {
    fragments.push(`da.loan_amount <= $${i++}`);
    values.push(filters.loanMax);
  }
  if (filters.locationSubstring !== undefined) {
    fragments.push(`strpos(lower(da.location), lower($${i++}::text)) > 0`);
    values.push(filters.locationSubstring.trim());
  }
  if (filters.nameSubstring !== undefined) {
    fragments.push(
      `strpos(lower(da.agent_full_name), lower($${i++}::text)) > 0`,
    );
    values.push(filters.nameSubstring.trim());
  }

  const whereSql = fragments.length === 0 ? "TRUE" : fragments.join(" AND ");
  return { whereSql, values };
}

async function selectDailyActivityStats(
  filters: DailyActivityListFilters
): Promise<DailyActivityListSummary> {
  const { whereSql, values } = buildDailyActivityWhereClause(filters);
  const { rows } = await pool.query<{
    total_updates: string;
    total_loan_amount: string;
    total_applications: string;
    last_update: Date | null;
  }>(
    `
    SELECT
      COUNT(*)::text AS total_updates,
      COALESCE(SUM(da.loan_amount), 0)::text AS total_loan_amount,
      COALESCE(SUM(da.applications_count), 0)::text AS total_applications,
      MAX(da.created_at) AS last_update
    FROM daily_activity da
    WHERE ${whereSql}
    `,
    values,
  );
  const r = rows[0];
  if (!r) {
    return {
      total_updates: 0,
      total_loan_amount: 0,
      total_applications: 0,
      last_update: null,
    };
  }
  return {
    total_updates: Number(r.total_updates),
    total_loan_amount: Number(r.total_loan_amount),
    total_applications: Number(r.total_applications),
    last_update: r.last_update?.toISOString() ?? null,
  };
}

/** Returns one list-row shape or null when the id does not exist. */
export async function selectDailyActivityById(
  activityId: string
): Promise<DailyActivityListItemPublic | null> {
  const { rows } = await pool.query<DailyActivityRowDb>(
    `
    SELECT
      da.id,
      da.agent_user_id,
      da.agent_full_name,
      da.location,
      da.applications_count,
      da.loan_amount::text AS loan_amount,
      da.update_date::text AS update_date_text,
      da.created_at
    FROM daily_activity da
    WHERE da.id = $1::uuid
    `,
    [activityId]
  );
  const row = rows[0];
  if (!row) return null;
  return dbRowToListItem(row);
}

export async function paginateDailyActivity(params: {
  filters: DailyActivityListFilters;
  page: number;
  pageSize: number;
}): Promise<PaginatedDailyActivityResult> {
  const { filters, page, pageSize } = params;

  const summary = await selectDailyActivityStats(filters);
  const totalItems = summary.total_updates;

  const { whereSql, values } = buildDailyActivityWhereClause(filters);
  const limit = pageSize;
  const offset = (page - 1) * pageSize;

  const dataValues = [...values, limit, offset];
  const limitIdx = values.length + 1;
  const offsetIdx = values.length + 2;

  const { rows } = await pool.query<DailyActivityRowDb>(
    `
    SELECT
      da.id,
      da.agent_user_id,
      da.agent_full_name,
      da.location,
      da.applications_count,
      da.loan_amount::text AS loan_amount,
      da.update_date::text AS update_date_text,
      da.created_at
    FROM daily_activity da
    WHERE ${whereSql}
    ORDER BY da.update_date DESC, da.created_at DESC
    LIMIT $${limitIdx}::integer OFFSET $${offsetIdx}::integer
    `,
    dataValues,
  );

  const items = rows.map(dbRowToListItem);

  return {
    items,
    total_items: totalItems,
    summary,
  };
}

/** Returns owning agent UUID for `daily_activity` row or null when id does not exist. */
export async function selectAgentUserIdForDailyActivity(
  activityId: string
): Promise<string | null> {
  const { rows } = await pool.query<{ agent_user_id: string }>(
    `SELECT agent_user_id FROM daily_activity WHERE id = $1::uuid`,
    [activityId]
  );
  return rows[0]?.agent_user_id ?? null;
}

export type PatchDailyActivityInput = {
  activityId: string;
  applicationsCount?: number | undefined;
  loanAmount?: number | undefined;
  updateDateIso?: string | undefined;
};

export async function updateDailyActivityPartial(
  patch: PatchDailyActivityInput
): Promise<ReturnType<typeof rowToDailyActivityPublic>> {
  const fragments: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  if (patch.applicationsCount !== undefined) {
    fragments.push(`applications_count = $${i++}`);
    values.push(patch.applicationsCount);
  }
  if (patch.loanAmount !== undefined) {
    fragments.push(`loan_amount = $${i++}`);
    values.push(patch.loanAmount);
  }
  if (patch.updateDateIso !== undefined) {
    fragments.push(`update_date = $${i++}::date`);
    values.push(patch.updateDateIso);
  }

  if (fragments.length === 0) {
    throw new Error("updateDailyActivityPartial called without fields");
  }

  values.push(patch.activityId);
  try {
    const { rows } = await pool.query<DailyActivityRowDb>(
      `
      UPDATE daily_activity
      SET ${fragments.join(", ")}
      WHERE id = $${i}::uuid
      RETURNING id, agent_user_id, agent_full_name, location, applications_count,
                loan_amount::text AS loan_amount, update_date::text AS update_date_text, created_at
      `,
      values,
    );
    const row = rows[0];
    if (!row) throw new Error("unexpected empty RETURNING after UPDATE daily_activity");
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
                loan_amount::text AS loan_amount, update_date::text AS update_date_text, created_at
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
