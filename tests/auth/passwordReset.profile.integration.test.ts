/**
 * Live Postgres + Redis; `sendPasswordResetEmail` mocked to capture token.
 *
 * RUN_AUTH_INTEGRATION_TESTS=1 npm test
 */
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const { sendPasswordResetEmailMock } = vi.hoisted(() => ({
  sendPasswordResetEmailMock: vi.fn(),
}));

vi.mock("../../src/email/sendPasswordReset", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/email/sendPasswordReset")>();
  return {
    ...actual,
    sendPasswordResetEmail: sendPasswordResetEmailMock,
  };
});

import { createApp } from "../../src/http/app";
import { pool } from "../../src/db/pool";
import { connectRedis, disconnectRedis } from "../../src/redis/client";

const app = createApp();
const SHOULD_RUN = process.env.RUN_AUTH_INTEGRATION_TESTS === "1";

describe.skipIf(!SHOULD_RUN)("Auth password reset + PATCH /auth/me integration", () => {
  beforeAll(async () => {
    await pool.query("SELECT 1").catch(() => {
      throw new Error(
        "Postgres unreachable — run migrations and re-run with RUN_AUTH_INTEGRATION_TESTS=1"
      );
    });
    await connectRedis();
  });

  afterEach(() => {
    sendPasswordResetEmailMock.mockClear();
  });

  afterAll(async () => {
    await disconnectRedis().catch(() => undefined);
  });

  it("POST /auth/forgot-password captures token; POST /auth/reset-password then login with new password", async () => {
    const email = `reset-${crypto.randomUUID()}@example.invalid`;
    const oldPw = "twelve-char!!";
    const newPw = "different-12-ch";

    await request(app)
      .post("/auth/register")
      .send({
        full_name: "Reset User",
        email,
        password: oldPw,
        location_station: "A1",
      })
      .expect(201);

    const forgot = await request(app)
      .post("/auth/forgot-password")
      .send({ email });
    expect(forgot.status).toBe(202);
    expect(sendPasswordResetEmailMock).toHaveBeenCalledTimes(1);
    const rawToken = sendPasswordResetEmailMock.mock.calls[0]?.[0]?.rawToken;
    expect(typeof rawToken).toBe("string");
    expect((rawToken as string).length).toBeGreaterThan(20);

    await request(app)
      .post("/auth/reset-password")
      .send({ token: rawToken, password: newPw })
      .expect(204);

    await request(app)
      .post("/auth/login")
      .send({ email, password: oldPw })
      .expect(401);

    const login = await request(app)
      .post("/auth/login")
      .send({ email, password: newPw });
    expect(login.status).toBe(200);
  });

  it("POST /auth/forgot-password returns 202 for unknown email and does not call mailer", async () => {
    const forgot = await request(app)
      .post("/auth/forgot-password")
      .send({ email: `nope-${crypto.randomUUID()}@example.invalid` });
    expect(forgot.status).toBe(202);
    expect(sendPasswordResetEmailMock).not.toHaveBeenCalled();
  });

  it("PATCH /auth/me updates profile; duplicate email 409", async () => {
    const a = `pa-${crypto.randomUUID()}@example.invalid`;
    const b = `pb-${crypto.randomUUID()}@example.invalid`;
    const password = "twelve-char!!";

    const regA = await request(app).post("/auth/register").send({
      full_name: "User A",
      email: a,
      password,
      location_station: "S1",
    });
    const regB = await request(app).post("/auth/register").send({
      full_name: "User B",
      email: b,
      password,
      location_station: "S2",
    });
    expect(regA.status).toBe(201);
    expect(regB.status).toBe(201);

    const patch = await request(app)
      .patch("/auth/me")
      .set("Authorization", `Bearer ${regA.body.access_token}`)
      .send({ full_name: "A Updated", location_station: "S9" });
    expect(patch.status).toBe(200);
    expect(patch.body.user.full_name).toBe("A Updated");
    expect(patch.body.user.location_station).toBe("S9");

    const dup = await request(app)
      .patch("/auth/me")
      .set("Authorization", `Bearer ${regA.body.access_token}`)
      .send({ email: b });
    expect(dup.status).toBe(409);
  });

  it("PATCH /auth/me without Bearer responds 401", async () => {
    await request(app)
      .patch("/auth/me")
      .send({ full_name: "X" })
      .expect(401);
  });
});
