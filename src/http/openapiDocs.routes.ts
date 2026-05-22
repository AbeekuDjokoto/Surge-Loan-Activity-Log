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

let cachedMtimeMs: number | undefined;
let cachedYaml: string | undefined;
let cachedParsed: Record<string, unknown> | undefined;

function loadOpenApiSync(): {
  yaml: string;
  parsed: Record<string, unknown>;
  mtimeMs: number;
} {
  const st = fs.statSync(OPENAPI_SPEC_PATH);
  const yaml = fs.readFileSync(OPENAPI_SPEC_PATH, "utf8");
  const parsed = YAML.parse(yaml) as Record<string, unknown>;
  return { yaml, parsed, mtimeMs: st.mtimeMs };
}

function getOpenApiSpec(): ReturnType<typeof loadOpenApiSync> {
  const st = fs.statSync(OPENAPI_SPEC_PATH);
  const mtimeMs = st.mtimeMs;
  if (
    cachedYaml !== undefined &&
    cachedParsed !== undefined &&
    cachedMtimeMs !== undefined &&
    cachedMtimeMs === mtimeMs
  ) {
    return { yaml: cachedYaml, parsed: cachedParsed, mtimeMs };
  }

  const next = loadOpenApiSync();
  cachedYaml = next.yaml;
  cachedParsed = next.parsed;
  cachedMtimeMs = next.mtimeMs;
  return next;
}

export function openapiDocsRouter() {
  const router = express.Router({ mergeParams: false });

  router.use(corsPublicSpec);

  router.get("/openapi.yaml", (_req, res, next) => {
    try {
      const { yaml } = getOpenApiSpec();
      res.type("application/yaml").send(yaml);
    } catch (err) {
      next(err);
    }
  });

  router.get("/openapi.json", (_req, res, next) => {
    try {
      const { parsed } = getOpenApiSpec();
      res.json(parsed);
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
