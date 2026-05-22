## Surge Loan Activity Log — codebase map

This repository **is** the API service (Node.js + Express + PostgreSQL + Redis).

### Scripts (repo root)

- **`npm run dev`**: HTTP server bootstrap in [`src/index.ts`](src/index.ts); Express app factory in [`src/http/app.ts`](src/http/app.ts) (watch with `tsx`).
- **`npm run build`**: Compiles **`src/`** → **`dist/`** (see [`tsconfig.build.json`](tsconfig.build.json)).
- **`npm start`**: Run compiled server (`node dist/index.js`); run from repo root so [`openapi.yaml`](openapi.yaml) resolves.
- **`npm run start:with-migrations`**: Runs **`dist/db/migrate.js`** then the server — use after **`npm run build`** when **`tsx`** is omitted from production installs (e.g. Render).
- **`npm run start:with-migrations-and-seed`**: Migrates then runs **`dist/db/seed.js`** then the server — only if all **`SEED_ADMIN_*`** env vars are set (**`db:seed` exits 1 otherwise**).
- **`npm run db:migrate`**: Applies ordered SQL in [`migrations/`](migrations/) via **`dist/db/migrate.js`** (run **`npm run build`** first). Only **`DATABASE_URL`** must be set (same module loads [`src/config/databaseEnv.ts`](src/config/databaseEnv.ts), not the full server env).
- **`npm run db:migrate:dev`**: Same migration via **`tsx src/db/migrate.ts`** (needs devDependencies).
- **`npm run db:seed`**: Idempotent bootstrap admin via **`dist/db/seed.js`** — run **after migrate** with **`SEED_ADMIN_*`** in `.env` (see [`.env.example`](.env.example)); grants **`admin`** only for that email (removes **`user`** if it was reassigned); **`npm run build`** first.
- **`npm run db:seed:dev`**: **`tsx src/db/seed.ts`** without compiling `dist/` (needs devDependencies).
- **`npm test`**: Vitest specs under [`tests/`](tests/); defaults in [`tests/setup/env.ts`](tests/setup/env.ts) seed `DATABASE_URL` and `REDIS_URL` before any `src/` import. **`RUN_AUTH_INTEGRATION_TESTS=1`** enables live Postgres+Redis specs in [`tests/auth/auth.routes.integration.test.ts`](tests/auth/auth.routes.integration.test.ts). **`RUN_ACTIVITY_INTEGRATION_TESTS=1`** enables [`tests/activity/dailyActivity.integration.test.ts`](tests/activity/dailyActivity.integration.test.ts) (CRUD-style activity routes including delete). **`RUN_ADMIN_INTEGRATION_TESTS=1`** enables [`tests/admin/admin.integration.test.ts`](tests/admin/admin.integration.test.ts) (admin invites, accept, **`GET /admin/agents/{id}`**).
- **Infra**: Run **Postgres** and **Redis** on the host (or your provider). No Docker in this repo — see [`.env.example`](.env.example).
- **Docs**: Interactive Swagger UI at **`/api-docs`**; source spec [`openapi.yaml`](openapi.yaml). **`GET /openapi.json`** / **`GET /openapi.yaml`** republish it for Postman/codegen/etc. with permissive browser CORS. Restart the process after editing `openapi.yaml` so caches refresh.
- **Password reset**: `POST /auth/forgot-password` and `POST /auth/reset-password`; configure `EMAIL_MODE`, `PASSWORD_RESET_URL_BASE`, optional `PASSWORD_RESET_RETURN_RESET_URL`, and SMTP vars (see [`.env.example`](.env.example)). **`EMAIL_MODE=console`** logs links (works in production); JSON **`reset_url`** on forgot-password follows **`PASSWORD_RESET_RETURN_RESET_URL`** / **`NODE_ENV`** (see [`src/config/env.ts`](src/config/env.ts)). Migration [`migrations/003_password_reset_tokens.sql`](migrations/003_password_reset_tokens.sql).
- **Admin invites**: `POST /admin/invites` (Bearer **`admin`**) sends email; `POST /auth/accept-admin-invite` accepts (`ADMIN_INVITE_URL_BASE`, `ADMIN_INVITE_TOKEN_TTL_HOURS`). Migration [`migrations/005_admin_invites.sql`](migrations/005_admin_invites.sql). Admins use the same **`POST /auth/login`** / forgot / reset flows as agents.
- **Profile**: `PATCH /auth/me` (Bearer JWT) updates `full_name`, `location_station`, and/or `email`. Admins fetch an agent profile via **`GET /admin/agents/{agent_uuid}`** (target must be `user` without `admin`).
- **Activities**: `POST /activity/daily` (agents); **`GET /activity/daily/{daily_activity_id}`** / **`PATCH /activity/daily/{id}`** (agents own row, admins any); **`DELETE /activity/daily/{id}`** and **`POST /activity/daily/delete`** (same RBAC — agents own only, admins anyone; bulk **404**/ **403** on bad ids — see Swagger tag **Activity deletion**); **`GET /activity/daily/me`** filtered + paginated self list with **`summary`**; **`GET /activity/daily`** (admins only) lists all agents, optional **`agent_uuid`**, filters, pagination, **`summary`**. OpenAPI **`0.7.5`**.

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

- Admin UI for aggregates / summaries (API summaries exist on list endpoints). Daily agent submission lives at **`POST /activity/daily`**.
