/**
 * Live Postgres + Redis checks for `/auth` (Argon hashing adds latency).
 *
 * Enable explicitly:
 * `RUN_AUTH_INTEGRATION_TESTS=1 npm test`
 * Requires reachable DATABASE_URL / REDIS_URL (see `.env.example`) and `npm run db:migrate`.
 */
import request, { type Response } from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { REFRESH_COOKIE_NAME } from "../../src/auth/refreshCookie";
import { createApp } from "../../src/http/app";
import { pool } from "../../src/db/pool";
import {
  disconnectRedis,
  connectRedis,
} from "../../src/redis/client";

const app = createApp();

const SHOULD_RUN_AUTH = process.env.RUN_AUTH_INTEGRATION_TESTS === "1";

/** Builds `surge_refresh=…` Cookie header fragment from response Set-Cookie. */
function surgeRefreshCookiePair(headers: Response["headers"]): string {
  const raw = headers["set-cookie"];
  if (!raw) return "";
  const list = Array.isArray(raw) ? raw : [raw];
  const line = list.find((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`));
  if (!line) return "";
  const sem = line.indexOf(";");
  return sem === -1 ? line : line.slice(0, sem).trim();
}

function expectRefreshSetCookie(res: Response): void {
  expect(surgeRefreshCookiePair(res.headers).startsWith(`${REFRESH_COOKIE_NAME}=`)).toBe(
    true
  );
}

describe.skipIf(!SHOULD_RUN_AUTH)("Auth /auth integration", () => {
  beforeAll(async () => {
    await pool.query("SELECT 1").catch(() => {
      throw new Error(
        "Postgres unreachable — start services and migrations, then re-run with RUN_AUTH_INTEGRATION_TESTS=1"
      );
    });
    await connectRedis();
  });

  afterAll(async () => {
    await disconnectRedis().catch(() => undefined);
  });

  it("POST /auth/register returns access JWT plus HttpOnly cookie not refresh_token in body", async () => {
    const email = `t-${crypto.randomUUID()}@example.invalid`;
    const password = "twelve-char!!";
    const res = await request(app).post("/auth/register").send({
      full_name: "Tester One",
      email,
      password,
      location_station: "Desk 1",
    });
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe(email.toLowerCase());
    expect(res.body.user.roles).toContain("user");
    expect(res.body.access_token?.length ?? 0).toBeGreaterThan(20);
    expect(res.body.refresh_token).toBeUndefined();
    expectRefreshSetCookie(res);
    expect(res.body.password_hash ?? res.body.user.password_hash).toBeUndefined();
  });

  it("POST /auth/register duplicate email responds 409", async () => {
    const email = `dup-${crypto.randomUUID()}@example.invalid`;
    const payload = {
      full_name: "Dup",
      email,
      password: "twelve-char!!",
      location_station: "Desk 9",
    };
    await request(app).post("/auth/register").send(payload).expect(201);
    const res = await request(app).post("/auth/register").send(payload);
    expect(res.status).toBe(409);
    expect(typeof res.body.error).toBe("string");
  });

  it("POST /auth/login success and wrong-password 401", async () => {
    const email = `login-${crypto.randomUUID()}@example.invalid`;
    const password = "twelve-char!!";
    await request(app)
      .post("/auth/register")
      .send({
        full_name: "Login User",
        email,
        password,
        location_station: "North",
      })
      .expect(201);

    const ok = await request(app).post("/auth/login").send({ email, password });
    expect(ok.status).toBe(200);
    expect(ok.body.refresh_token).toBeUndefined();
    expectRefreshSetCookie(ok);

    const bad = await request(app).post("/auth/login").send({
      email,
      password: `${password}x`,
    });
    expect(bad.status).toBe(401);
  });

  it("GET /auth/me without token responds 401; with Bearer returns profile", async () => {
    const email = `me-${crypto.randomUUID()}@example.invalid`;
    const password = "twelve-char!!";
    const signup = await request(app).post("/auth/register").send({
      full_name: "Profile User",
      email,
      password,
      location_station: "Lobby",
    });
    expect(signup.status).toBe(201);

    await request(app).get("/auth/me").expect(401);

    const me = await request(app)
      .get("/auth/me")
      .set("Authorization", `Bearer ${signup.body.access_token}`)
      .expect(200);

    expect(me.body.user.email).toBe(email.toLowerCase());
  });

  it("POST /auth/logout prevents further refresh via agent cookie jar", async () => {
    const agent = request.agent(app);
    const email = `logout-${crypto.randomUUID()}@example.invalid`;

    await agent
      .post("/auth/register")
      .send({
        full_name: "Logout User",
        email,
        password: "twelve-char!!",
        location_station: "South",
      })
      .expect(201);

    await agent.post("/auth/refresh").send({}).expect(200);
    await agent.post("/auth/logout").send({}).expect(204);
    await agent.post("/auth/refresh").send({}).expect(401);

    await request(app).post("/logout").expect(404);
  });

  it("POST /auth/refresh rejects stale surge_refresh after rotation via agent", async () => {
    const agent = request.agent(app);
    const email = `refresh-${crypto.randomUUID()}@example.invalid`;

    const reg = await agent.post("/auth/register").send({
      full_name: "Refresh User",
      email,
      password: "twelve-char!!",
      location_station: "East",
    });
    expect(reg.status).toBe(201);

    const staleCookie = surgeRefreshCookiePair(reg.headers);

    await agent.post("/auth/refresh").send({}).expect(200);

    await request(app)
      .post("/auth/refresh")
      .set("Cookie", staleCookie)
      .send({})
      .expect(401);

    await agent.post("/auth/refresh").send({}).expect(200);
  });
});
