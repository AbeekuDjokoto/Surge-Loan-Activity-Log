import fs from "node:fs";

import express, { type RequestHandler } from "express";
import YAML from "yaml";

import { OPENAPI_SPEC_PATH } from "./openapiPath";

/** Lets browsers (Swagger Editor, etc.) read the spec without relaxing main API CORS. */
const corsPublicSpec: RequestHandler = (_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  next();
};

let cachedYaml: string | undefined;
let cachedParsed: Record<string, unknown> | undefined;

export function openapiDocsRouter() {
  const router = express.Router({ mergeParams: false });

  router.use(corsPublicSpec);

  router.get("/openapi.yaml", (_req, res, next) => {
    try {
      cachedYaml ??= fs.readFileSync(OPENAPI_SPEC_PATH, "utf8");
      res.type("application/yaml").send(cachedYaml);
    } catch (err) {
      next(err);
    }
  });

  router.get("/openapi.json", (_req, res, next) => {
    try {
      if (!cachedParsed) {
        cachedYaml ??= fs.readFileSync(OPENAPI_SPEC_PATH, "utf8");
        cachedParsed = YAML.parse(cachedYaml) as Record<string, unknown>;
      }
      res.json(cachedParsed);
    } catch (err) {
      next(err);
    }
  });

  const specPaths = ["/openapi.yaml", "/openapi.json"];
  for (const specPath of specPaths) {
    router.options(specPath, (_req, res) => res.status(204).end());
  }

  return router;
}
