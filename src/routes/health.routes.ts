import { Router } from "express";

import { pool } from "../db/pool";
import { getRedis } from "../redis/client";

export const healthRouter = Router();

healthRouter.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

healthRouter.get("/ready", async (_req, res, next) => {
  try {
    const [pgResult, ping] = await Promise.all([
      pool.query("SELECT 1 AS ok"),
      getRedis().ping(),
    ]);
    res.status(200).json({
      status: "ready",
      postgres: Boolean(pgResult.rowCount),
      redis: ping === "PONG",
    });
  } catch (err) {
    next(err);
  }
});
