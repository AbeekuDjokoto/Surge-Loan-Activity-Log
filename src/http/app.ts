import express, {
  type ErrorRequestHandler,
  type RequestHandler,
} from "express";
import { pinoHttp } from "pino-http";
import swaggerUi from "swagger-ui-express";

import { env } from "../config/env";
import { logger } from "../logger";
import { apiRouter } from "../routes";
import { openapiDocsRouter } from "./openapiDocs.routes";

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
  logger.error({ err }, err instanceof Error ? err.message : String(err));
  const message =
    env.NODE_ENV === "production" ? "Internal Server Error" : err.message;
  res.status(500).json({ error: message });
};

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json());
  app.use(
    pinoHttp({
      logger,
      autoLogging: true,
      customProps: (_req, res) => ({
        httpStatusCode: res.statusCode,
      }),
    })
  );

  /** Public spec URLs (ACAO *) must come before restrictive CORS for other routes. */
  app.use(openapiDocsRouter());

  app.use(corsMiddleware);

  app.use("/", apiRouter);

  app.use(
    "/api-docs",
    swaggerUi.serve,
    swaggerUi.setup(undefined, {
      swaggerOptions: {
        url: "/openapi.json",
        persistAuthorization: true,
      },
      customCss: ".swagger-ui .topbar{display:none}",
    })
  );

  app.use(errorMiddleware);

  return app;
}
