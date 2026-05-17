/**
 * Postgres + Redis + migrations (`005_admin_invites`) required.
 *
 * RUN_ADMIN_INTEGRATION_TESTS=1 npm test
 */
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { hashPassword } from "../../src/auth/password";
import { env } from "../../src/config/env";
import { createAdminInvite } from "../../src/db/adminInviteQueries";
import { pool } from "../../src/db/pool";
import { createApp } from "../../src/http/app";
import { connectRedis, disconnectRedis } from "../../src/redis/client";

const app = createApp();

const SHOULD_RUN = process.env.RUN_ADMIN_INTEGRATION_TESTS === "1";

describe.skipIf(!SHOULD_RUN)("Admin integration", () => {
  beforeAll(async () => {
    await pool.query("SELECT 1").catch(() => {
      throw new Error(
        "Postgres unreachable — start services, apply migrations (including 005_admin_invites), then RUN_ADMIN_INTEGRATION_TESTS=1 npm test",
      );
    });
    await connectRedis();
    await pool.query("DELETE FROM admin_invites WHERE TRUE");
  });

  afterAll(async () => {
    await disconnectRedis().catch(() => undefined);
  });

  async function signupAdmin(): Promise<{ token: string; userId: string; email: string; password: string }> {
    const email = `adm-${randomUUID()}@example.invalid`;
    const password = "twelve-char!!";
    const password_hash = await hashPassword(password);
    const ins = await pool.query<{ id: string }>(
      `
      INSERT INTO users (email, password_hash, full_name, location_station)
      VALUES (lower(trim($1::text)), $2, 'Admin Tester', 'HQ')
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
    return {
      token: login.body.access_token as string,
      userId: login.body.user.id as string,
      email,
      password,
    };
  }

  async function signupAgent(): Promise<{
    token: string;
    userId: string;
    email: string;
    password: string;
  }> {
    const email = `agt-${randomUUID()}@example.invalid`;
    const password = "twelve-char!!";
    const res = await request(app).post("/auth/register").send({
      full_name: "Agent Person",
      email,
      password,
      location_station: "Desk Y",
    });
    expect(res.status).toBe(201);
    return {
      token: res.body.access_token as string,
      userId: res.body.user.id as string,
      email,
      password,
    };
  }

  it("POST /admin/invites 409 when email is already admin", async () => {
    const admin = await signupAdmin();
    const res = await request(app)
      .post("/admin/invites")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ email: admin.email });
    expect(res.status).toBe(409);
  });

  it("POST /admin/invites + accept creates new admin-only user with credentials", async () => {
    await pool.query("DELETE FROM admin_invites WHERE TRUE");
    const inviter = await signupAdmin();

    const newEmail = `newadm-${randomUUID()}@example.invalid`;
    const invite = await request(app)
      .post("/admin/invites")
      .set("Authorization", `Bearer ${inviter.token}`)
      .send({ email: newEmail });
    expect(invite.status).toBe(201);

    const { rawToken } = await createAdminInvite({
      email: newEmail,
      invitedByUserId: inviter.userId,
      ttlHours: env.ADMIN_INVITE_TOKEN_TTL_HOURS,
    });

    const acc = await request(app)
      .post("/auth/accept-admin-invite")
      .send({
        token: rawToken,
        password: "twelve-char!!",
        full_name: "New Admin",
        location_station: "HQ",
      });
    expect(acc.status).toBe(201);
    expect((acc.body.user.roles as string[]).sort()).toEqual(["admin"]);

    const login = await request(app)
      .post("/auth/login")
      .send({ email: newEmail, password: "twelve-char!!" });
    expect(login.status).toBe(200);
    expect((login.body.user.roles as string[]).sort()).toEqual(["admin"]);
  });

  it("invite existing agent — token only — promotes to admin-only", async () => {
    await pool.query("DELETE FROM admin_invites WHERE TRUE");
    const agent = await signupAgent();
    const inviter = await signupAdmin();

    const inv = await request(app)
      .post("/admin/invites")
      .set("Authorization", `Bearer ${inviter.token}`)
      .send({ email: agent.email });
    expect(inv.status).toBe(201);

    const { rawToken } = await createAdminInvite({
      email: agent.email,
      invitedByUserId: inviter.userId,
      ttlHours: env.ADMIN_INVITE_TOKEN_TTL_HOURS,
    });

    const acc = await request(app).post("/auth/accept-admin-invite").send({
      token: rawToken,
    });
    expect(acc.status).toBe(201);
    expect((acc.body.user.roles as string[]).sort()).toEqual(["admin"]);

    const login = await request(app)
      .post("/auth/login")
      .send({ email: agent.email, password: agent.password });
    expect(login.status).toBe(200);
    expect((login.body.user.roles as string[]).sort()).toEqual(["admin"]);
  });

  it("GET /admin/agents/:id returns agent profile; 404 for pure admin account", async () => {
    const admin = await signupAdmin();
    const agent = await signupAgent();

    const ok = await request(app)
      .get(`/admin/agents/${agent.userId}`)
      .set("Authorization", `Bearer ${admin.token}`);
    expect(ok.status).toBe(200);
    expect(ok.body.user.id).toBe(agent.userId);
    expect(ok.body.user.roles).toContain("user");

    const nay = await request(app)
      .get(`/admin/agents/${admin.userId}`)
      .set("Authorization", `Bearer ${admin.token}`);
    expect(nay.status).toBe(404);
  });
});
