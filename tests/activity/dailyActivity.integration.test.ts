/**
 * Postgres + Redis + migrations required (see `README` / `repo.md`).
 *
 * RUN_ACTIVITY_INTEGRATION_TESTS=1 npm test
 */
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { hashPassword } from "../../src/auth/password";
import { createApp } from "../../src/http/app";
import { pool } from "../../src/db/pool";
import { connectRedis, disconnectRedis } from "../../src/redis/client";

const app = createApp();

const SHOULD_RUN_ACTIVITY = process.env.RUN_ACTIVITY_INTEGRATION_TESTS === "1";

describe.skipIf(!SHOULD_RUN_ACTIVITY)("Activity /activity integration", () => {
  beforeAll(async () => {
    await pool.query("SELECT 1").catch(() => {
      throw new Error(
        "Postgres unreachable — start services run migrations against DATABASE_URL then RUN_ACTIVITY_INTEGRATION_TESTS=1 npm test",
      );
    });
    await connectRedis();
    await pool.query(`DELETE FROM daily_activity WHERE TRUE`);
  });

  afterAll(async () => {
    await disconnectRedis().catch(() => undefined);
  });

  async function signupAdminOnlyToken(): Promise<string> {
    const email = `adm-${randomUUID()}@example.invalid`;
    const password = "twelve-char!!";
    const password_hash = await hashPassword(password);
    const ins = await pool.query<{ id: string }>(
      `
      INSERT INTO users (email, password_hash, full_name, location_station)
      VALUES (lower(trim($1::text)), $2, 'Seed Admin Tester', 'HQ')
      RETURNING id
      `,
      [email, password_hash],
    );
    const id = ins.rows[0]?.id;
    if (!id) throw new Error("unexpected empty insert admin user");

    await pool.query(`DELETE FROM user_roles WHERE user_id = $1::uuid`, [id]);
    await pool.query(
      `
      INSERT INTO user_roles (user_id, role_id)
      SELECT $1::uuid, r.id FROM roles r WHERE r.code = 'admin'
      `,
      [id],
    );

    const login = await request(app).post("/auth/login").send({ email, password });
    expect(login.status).toBe(200);
    return login.body.access_token as string;
  }

  async function signupAgent(): Promise<{
    token: string;
    userId: string;
    email: string;
    password: string;
  }> {
    const email = `act-${randomUUID()}@example.invalid`;
    const password = "twelve-char!!";
    const res = await request(app).post("/auth/register").send({
      full_name: "Activity Tester",
      email,
      password,
      location_station: "Desk X",
    });
    expect(res.status).toBe(201);
    return {
      token: res.body.access_token as string,
      userId: res.body.user.id as string,
      email,
      password,
    };
  }

  function dailyBody(
    agent: { userId: string },
    overrides: Partial<{
      update_date: string;
      loan_amount: number;
      location: string;
      agent_full_name: string;
    }> = {},
  ) {
    return {
      agent_uuid: agent.userId,
      agent_full_name: overrides.agent_full_name ?? "Activity Tester",
      location: overrides.location ?? "North Station",
      applications_count: 3,
      loan_amount: overrides.loan_amount ?? 150_000,
      update_date: overrides.update_date ?? "2026-05-17",
    };
  }

  describe("POST /activity/daily", () => {
    it("creates daily activity then 409 duplicate same date", async () => {
      const agent = await signupAgent();

      const first = await request(app)
        .post("/activity/daily")
        .set("Authorization", `Bearer ${agent.token}`)
        .send(dailyBody(agent));

      expect(first.status).toBe(201);
      expect(first.body.daily_activity.agent_user_id).toBe(agent.userId);
      expect(first.body.daily_activity.update_date).toBe("2026-05-17");
      expect(typeof first.body.daily_activity.loan_amount).toBe("number");

      const second = await request(app)
        .post("/activity/daily")
        .set("Authorization", `Bearer ${agent.token}`)
        .send(dailyBody(agent));

      expect(second.status).toBe(409);
      expect(typeof second.body.error).toBe("string");
    });

    it("403 when agent_uuid does not match JWT subject", async () => {
      const agent = await signupAgent();
      const res = await request(app)
        .post("/activity/daily")
        .set("Authorization", `Bearer ${agent.token}`)
        .send({
          ...dailyBody(agent),
          agent_uuid: randomUUID(),
        });
      expect(res.status).toBe(403);
    });

    it("401 without Bearer token", async () => {
      const agent = await signupAgent();
      const res = await request(app).post("/activity/daily").send(dailyBody(agent));
      expect(res.status).toBe(401);
    });

    it("403 after user gains admin role (JWT includes admin)", async () => {
      const agent = await signupAgent();
      await pool.query(
        `INSERT INTO user_roles (user_id, role_id)
       SELECT $1::uuid, r.id FROM roles r WHERE r.code = 'admin'
       ON CONFLICT (user_id, role_id) DO NOTHING`,
        [agent.userId],
      );

      const login = await request(app).post("/auth/login").send({
        email: agent.email,
        password: agent.password,
      });
      expect(login.status).toBe(200);
      const adminishToken = login.body.access_token as string;

      const res = await request(app)
        .post("/activity/daily")
        .set("Authorization", `Bearer ${adminishToken}`)
        .send(dailyBody(agent, { update_date: "2026-06-01" }));

      expect(res.status).toBe(403);
    });
  });

  describe("PATCH /activity/daily/:id", () => {
    it("agent updates applications_count and loan_amount on own row", async () => {
      const agent = await signupAgent();
      const created = await request(app)
        .post("/activity/daily")
        .set("Authorization", `Bearer ${agent.token}`)
        .send(dailyBody(agent, { update_date: "2026-08-01" }));
      expect(created.status).toBe(201);
      const id = created.body.daily_activity.id as string;

      const patched = await request(app)
        .patch(`/activity/daily/${id}`)
        .set("Authorization", `Bearer ${agent.token}`)
        .send({ applications_count: 42, loan_amount: 777.77 });

      expect(patched.status).toBe(200);
      expect(patched.body.daily_activity.applications_count).toBe(42);
      expect(patched.body.daily_activity.loan_amount).toBeCloseTo(777.77, 2);
      expect(patched.body.daily_activity.update_date).toBe("2026-08-01");
    });

    it("409 when patch update_date conflicts with existing row same agent", async () => {
      const agent = await signupAgent();
      await request(app)
        .post("/activity/daily")
        .set("Authorization", `Bearer ${agent.token}`)
        .send(dailyBody(agent, { update_date: "2026-09-01" }))
        .expect(201);

      const second = await request(app)
        .post("/activity/daily")
        .set("Authorization", `Bearer ${agent.token}`)
        .send(dailyBody(agent, { update_date: "2026-09-02" }))
        .expect(201);
      const id = second.body.daily_activity.id as string;

      const clash = await request(app)
        .patch(`/activity/daily/${id}`)
        .set("Authorization", `Bearer ${agent.token}`)
        .send({ update_date: "2026-09-01" });

      expect(clash.status).toBe(409);
    });

    it("403 when agent edits another agent row admin can succeed", async () => {
      const adminToken = await signupAdminOnlyToken();
      const a = await signupAgent();
      const b = await signupAgent();

      const rowB = await request(app)
        .post("/activity/daily")
        .set("Authorization", `Bearer ${b.token}`)
        .send(dailyBody(b, { update_date: "2026-10-02" }))
        .expect(201);
      const idB = rowB.body.daily_activity.id as string;

      const forbidden = await request(app)
        .patch(`/activity/daily/${idB}`)
        .set("Authorization", `Bearer ${a.token}`)
        .send({ applications_count: 1 });
      expect(forbidden.status).toBe(403);

      const allowed = await request(app)
        .patch(`/activity/daily/${idB}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ loan_amount: 100 });
      expect(allowed.status).toBe(200);
      expect(Number(allowed.body.daily_activity.loan_amount)).toBeCloseTo(100, 2);
    });

    it("422 invalid path id", async () => {
      const agent = await signupAgent();
      const res = await request(app)
        .patch("/activity/daily/not-a-uuid")
        .set("Authorization", `Bearer ${agent.token}`)
        .send({ applications_count: 1 });
      expect(res.status).toBe(422);
    });
  });

  describe("GET /activity/daily/me and GET /activity/daily", () => {
    it("pagination and summary aggregates on filtered set", async () => {
      const agent = await signupAgent();

      const n = 25;
      let totalLoan = 0;
      let totalApps = 0;
      for (let d = 1; d <= n; d += 1) {
        const day = `2026-01-${String(d).padStart(2, "0")}`;
        const loan_amount = 1_000 + d;
        const res = await request(app)
          .post("/activity/daily")
          .set("Authorization", `Bearer ${agent.token}`)
          .send(dailyBody(agent, { update_date: day, loan_amount }));
        expect(res.status).toBe(201);
        totalLoan += loan_amount;
        totalApps += 3;
      }

      const page3 = await request(app)
        .get("/activity/daily/me")
        .query({ page: 3, page_size: 10 })
        .set("Authorization", `Bearer ${agent.token}`)
        .expect(200);

      expect(page3.body.items).toHaveLength(5);
      expect(page3.body.pagination.total_items).toBe(n);
      expect(page3.body.pagination.page).toBe(3);
      expect(page3.body.pagination.total_pages).toBe(3);
      expect(page3.body.summary.total_updates).toBe(n);
      expect(page3.body.summary.total_applications).toBe(totalApps);
      expect(Number(page3.body.summary.total_loan_amount)).toBeCloseTo(totalLoan, 2);
      expect(page3.body.summary.last_update).toBeTruthy();

      const dateFilter = await request(app)
        .get("/activity/daily/me")
        .query({ date_from: "2026-01-20", date_to: "2026-01-25" })
        .set("Authorization", `Bearer ${agent.token}`)
        .expect(200);

      expect(dateFilter.body.pagination.total_items).toBe(6);
      expect(dateFilter.body.summary.total_updates).toBe(6);

      const loanFilter = await request(app)
        .get("/activity/daily/me")
        .query({ loan_min: 1020 })
        .set("Authorization", `Bearer ${agent.token}`)
        .expect(200);

      expect(loanFilter.body.pagination.total_items).toBeGreaterThanOrEqual(1);
      for (const row of loanFilter.body.items as Array<{ total_amount: number }>) {
        expect(row.total_amount).toBeGreaterThanOrEqual(1020);
      }
    });

    it("admin lists all agents; agent_uuid restricts; RBAC denies wrong role", async () => {
      const adminToken = await signupAdminOnlyToken();

      const a = await signupAgent();
      await request(app)
        .post("/activity/daily")
        .set("Authorization", `Bearer ${a.token}`)
        .send(dailyBody(a, { update_date: "2026-07-01" }))
        .expect(201);

      await request(app)
        .post("/activity/daily")
        .set("Authorization", `Bearer ${a.token}`)
        .send(dailyBody(a, { update_date: "2026-07-02", location: "North Wing A" }))
        .expect(201);

      const b = await signupAgent();
      await request(app)
        .post("/activity/daily")
        .set("Authorization", `Bearer ${b.token}`)
        .send(
          dailyBody(b, {
            update_date: "2026-07-03",
            agent_full_name: "Other Person",
          }),
        )
        .expect(201);

      const all = await request(app)
        .get("/activity/daily")
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(all.body.pagination.total_items).toBeGreaterThanOrEqual(3);

      const forA = await request(app)
        .get("/activity/daily")
        .query({ agent_uuid: a.userId })
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(forA.body.pagination.total_items).toBe(2);
      expect(forA.body.items.every((r: { agent_uuid: string }) => r.agent_uuid === a.userId)).toBe(
        true,
      );

      const nameFiltered = await request(app)
        .get("/activity/daily")
        .query({ name: "Other Person" })
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);

      expect(nameFiltered.body.pagination.total_items).toBeGreaterThanOrEqual(1);

      const agentBlocked = await request(app)
        .get("/activity/daily")
        .set("Authorization", `Bearer ${a.token}`);

      expect(agentBlocked.status).toBe(403);

      const adminBlockedMe = await request(app)
        .get("/activity/daily/me")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(adminBlockedMe.status).toBe(403);
    });
  });

  describe("GET /activity/daily/:daily_activity_id", () => {
    it("agent reads own row; 403 other agent row; admin reads any", async () => {
      const adminToken = await signupAdminOnlyToken();
      const a = await signupAgent();
      const b = await signupAgent();

      const rowA = await request(app)
        .post("/activity/daily")
        .set("Authorization", `Bearer ${a.token}`)
        .send(dailyBody(a, { update_date: "2026-11-01" }))
        .expect(201);
      const idA = rowA.body.daily_activity.id as string;

      const rowB = await request(app)
        .post("/activity/daily")
        .set("Authorization", `Bearer ${b.token}`)
        .send(dailyBody(b, { update_date: "2026-11-02" }))
        .expect(201);
      const idB = rowB.body.daily_activity.id as string;

      const own = await request(app)
        .get(`/activity/daily/${idA}`)
        .set("Authorization", `Bearer ${a.token}`)
        .expect(200);
      expect(own.body.daily_activity.id).toBe(idA);
      expect(own.body.daily_activity.agent_uuid).toBe(a.userId);

      const forbidden = await request(app)
        .get(`/activity/daily/${idB}`)
        .set("Authorization", `Bearer ${a.token}`);
      expect(forbidden.status).toBe(403);

      await request(app)
        .get(`/activity/daily/${idB}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .expect(200);
    });
  });
});
