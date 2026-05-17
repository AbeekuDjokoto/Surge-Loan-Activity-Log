import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";

import { createApp } from "../../src/http/app";
import { pool } from "../../src/db/pool";

const app = createApp();

describe("HTTP /health", () => {
  afterAll(async () => {
    await pool.end().catch(() => undefined);
  });

  it("GET /health responds 200", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  // /ready is omitted here so CI does not depend on Postgres/Redis; call it manually when services are up.
});
