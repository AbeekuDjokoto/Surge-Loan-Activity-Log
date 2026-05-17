## Surge Loan Activity Log — codebase map

This repository **is** the API service (Node.js + Express + PostgreSQL + Redis).

### Scripts (repo root)

- **`npm run dev`**: HTTP server bootstrap in [`src/index.ts`](src/index.ts); Express app factory in [`src/http/app.ts`](src/http/app.ts) (watch with `tsx`).
- **`npm run build`**: Compiles **`src/`** → **`dist/`** (see [`tsconfig.build.json`](tsconfig.build.json)).
- **`npm start`**: Run compiled server (`node dist/index.js`); run from repo root so [`openapi.yaml`](openapi.yaml) resolves.
- **`npm run db:migrate`**: Applies ordered SQL in [`migrations/`](migrations/) via [`src/db/migrate.ts`](src/db/migrate.ts). Only **`DATABASE_URL`** must be set (same module loads [`src/config/databaseEnv.ts`](src/config/databaseEnv.ts), not the full server env).
- **`npm run db:seed`**: Idempotent bootstrap admin [`src/db/seed.ts`](src/db/seed.ts) — run **after migrate** with **`SEED_ADMIN_*`** in `.env` (see [`.env.example`](.env.example)); grants **`admin`** only for that email (removes **`user`** if it was reassigned).
- **`npm test`**: Vitest specs under [`tests/`](tests/); defaults in [`tests/setup/env.ts`](tests/setup/env.ts) seed `DATABASE_URL` and `REDIS_URL` before any `src/` import. **`RUN_AUTH_INTEGRATION_TESTS=1`** enables live Postgres+Redis specs in [`tests/auth/auth.routes.integration.test.ts`](tests/auth/auth.routes.integration.test.ts). **`RUN_ACTIVITY_INTEGRATION_TESTS=1`** enables [`tests/activity/dailyActivity.integration.test.ts`](tests/activity/dailyActivity.integration.test.ts).
- **Infra**: Run **Postgres** and **Redis** on the host (or your provider). No Docker in this repo — see [`.env.example`](.env.example).
- **Docs**: Interactive Swagger UI at **`/api-docs`**; source spec [`openapi.yaml`](openapi.yaml). **`GET /openapi.json`** / **`GET /openapi.yaml`** republish it for Postman/codegen/etc. with permissive browser CORS. Restart the process after editing `openapi.yaml` so caches refresh.
- **Password reset**: `POST /auth/forgot-password` and `POST /auth/reset-password`; configure `EMAIL_MODE`, `PASSWORD_RESET_URL_BASE`, and SMTP vars (see [`.env.example`](.env.example)). Migration [`migrations/003_password_reset_tokens.sql`](migrations/003_password_reset_tokens.sql).
- **Profile**: `PATCH /auth/me` (Bearer JWT) updates `full_name`, `location_station`, and/or `email`.

### Layout

| Path | Purpose |
|------|---------|
| [`src/http/app.ts`](src/http/app.ts) | Express middleware, request logging (`pino-http`), routes, Swagger UI, errors |
| [`src/logger.ts`](src/logger.ts) | Structured logs (`pino`); **`LOG_LEVEL`** honors `fatal`/`error`/…/`silent`; tests default to silent noise |
| [`src/http/openapiDocs.routes.ts`](src/http/openapiDocs.routes.ts) | Public **`/openapi.yaml`** and **`/openapi.json`** endpoints |
| [`src/index.ts`](src/index.ts) | `http.Server` lifecycle, Postgres/Redis connect & shutdown |
| [`tests/setup/env.ts`](tests/setup/env.ts) | Vitest pre-load env defaults |
| [`tests/**/*.test.ts`](tests/http/app.test.ts) | Automated tests |

### Environment note

There is a **single deployed target** (production). **`NODE_ENV`** defaults to **`production`**; set **`NODE_ENV=development`** locally only if you want verbose error bodies. Vitest forces **`test`**. List allowed browser sites in **`CORS_ORIGINS`** when the agent and admin apps are on different hosts.

### Planned (not implemented yet)

- Admin aggregates / summaries UI, fuller auth separation between admin and agent apps. Daily agent submission lives at **`POST /activity/daily`**.
