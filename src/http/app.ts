import "../requestAuth.augment";

import type { IncomingMessage } from "node:http";
import express, {
  type ErrorRequestHandler,
  type RequestHandler,
} from "express";
import { pinoHttp } from "pino-http";
import swaggerUi from "swagger-ui-express";

import { env } from "../config/env";
import { logger } from "../logger";
import { apiRouter } from "../routes";
import { HttpError } from "./httpError";
import { openapiDocsRouter } from "./openapiDocs.routes";

function requestPath(req: IncomingMessage): string {
  const raw = req.url ?? "";
  const pathOnly = raw.split("?")[0] ?? "";
  return pathOnly;
}

/** Swagger UI shells + static assets (/api-docs, /api-docs/*) — omit successful access logs only. */
function isSwaggerUiPath(path: string): boolean {
  return path === "/api-docs" || path.startsWith("/api-docs/");
}

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
  if (err instanceof HttpError) {
    if (err.statusCode >= 500)
      logger.error({ err }, err.message);
    res.status(err.statusCode).json({ error: err.message });
    return;
  }

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
      autoLogging: {
        ignore(req) {
          return isSwaggerUiPath(requestPath(req));
        },
      },
      customSuccessMessage(req, res, responseTime) {
        return `${req.method ?? "?"} ${requestPath(req)} ${res.statusCode} ${Math.round(responseTime)}ms`;
      },
      serializers: {
        req(req) {
          return {
            id: req.id,
            method: req.method,
            url: req.url,
          };
        },
        res(res) {
          return {
            statusCode: res.statusCode,
          };
        },
      },
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
        requestInterceptor: (request: Record<string, unknown>) => {
          request.credentials = "include";
          return request;
        },
      },
      customCss: ".swagger-ui .topbar{display:none}",
    })
  );

  app.use(errorMiddleware);

  return app;
}
