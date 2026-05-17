import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";

import { createApp } from "../../src/http/app";
import { pool } from "../../src/db/pool";

const app = createApp();

describe("HTTP surfaces", () => {
  afterAll(async () => {
    await pool.end().catch(() => undefined);
  });

  it("GET /health responds 200", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("GET /openapi.json publishes spec with permissive docs CORS", async () => {
    const res = await request(app).get("/openapi.json");
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    expect(res.body.openapi).toBe("3.0.3");
  });

  // /ready is omitted here so CI does not depend on Postgres/Redis; call manually when services are up.
});
