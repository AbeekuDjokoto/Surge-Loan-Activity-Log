import fs from "node:fs";
import path from "node:path";

import express, {
  type ErrorRequestHandler,
  type RequestHandler,
} from "express";
import swaggerUi from "swagger-ui-express";
import YAML from "yaml";

import { env } from "../config/env";
import { apiRouter } from "../routes";

const openapiPath = path.join(process.cwd(), "openapi.yaml");

const corsMiddleware: RequestHandler = (req, res, next) => {
  const origins =
    env.CORS_ORIGINS?.split(",")
      .map((s) => s.trim())
      .filter(Boolean) ?? [];
  const requestOrigin =
    typeof req.headers.origin === "string" ? req.headers.origin : undefined;

  res.header(
    "Access-Control-Allow-Methods",
    "GET,POST,PUT,PATCH,DELETE,OPTIONS"
  );
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (origins.length > 0 && requestOrigin && origins.includes(requestOrigin)) {
    res.setHeader("Access-Control-Allow-Origin", requestOrigin);
    res.header("Vary", "Origin");
    res.header("Access-Control-Allow-Credentials", "true");
  }

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  next();
};

const errorMiddleware: ErrorRequestHandler = (err, _req, res, _next) => {
  void _next;
  console.error(err);
  const message =
    env.NODE_ENV === "production" ? "Internal Server Error" : err.message;
  res.status(500).json({ error: message });
};

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json());
  app.use(corsMiddleware);

  app.use("/", apiRouter);

  const openapiRaw = fs.readFileSync(openapiPath, "utf8");
  const spec = YAML.parse(openapiRaw) as Record<string, unknown>;
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(spec));

  app.use(errorMiddleware);

  return app;
}
