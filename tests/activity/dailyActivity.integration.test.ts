/**
 * Postgres + Redis + migrations required (see `README` / `repo.md`).
 *
 * RUN_ACTIVITY_INTEGRATION_TESTS=1 npm test
 */
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../src/http/app";
import { pool } from "../../src/db/pool";
import { connectRedis, disconnectRedis } from "../../src/redis/client";

const app = createApp();

const SHOULD_RUN_ACTIVITY = process.env.RUN_ACTIVITY_INTEGRATION_TESTS === "1";

describe.skipIf(!SHOULD_RUN_ACTIVITY)("POST /activity/daily integration", () => {
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

  function dailyBody(agent: { userId: string }, updateDate = "2026-05-17") {
    return {
      agent_uuid: agent.userId,
      agent_full_name: "Activity Tester",
      location: "North Station",
      applications_count: 3,
      loan_amount: 150_000,
      update_date: updateDate,
    };
  }

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
      .send(dailyBody(agent, "2026-06-01"));

    expect(res.status).toBe(403);
  });
});
