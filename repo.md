## Surge Loan Activity Log — codebase map

This repository **is** the API service (Node.js + Express + PostgreSQL + Redis).

### Scripts (repo root)

- **`npm run dev`**: HTTP server bootstrap in [`src/index.ts`](src/index.ts); Express app factory in [`src/http/app.ts`](src/http/app.ts) (watch with `tsx`).
- **`npm run build`**: Compiles **`src/`** → **`dist/`** (see [`tsconfig.build.json`](tsconfig.build.json)).
- **`npm start`**: Run compiled server (`node dist/index.js`); run from repo root so [`openapi.yaml`](openapi.yaml) resolves.
- **`npm run db:migrate`**: Applies ordered SQL in [`migrations/`](migrations/) via [`src/db/migrate.ts`](src/db/migrate.ts). Only **`DATABASE_URL`** must be set (same module loads [`src/config/databaseEnv.ts`](src/config/databaseEnv.ts), not the full server env).
- **`npm test`**: Vitest specs under [`tests/`](tests/); defaults in [`tests/setup/env.ts`](tests/setup/env.ts) seed `DATABASE_URL` and `REDIS_URL` before any `src/` import.
- **Infra**: Run **Postgres** and **Redis** on the host (or your provider). No Docker in this repo — see [`.env.example`](.env.example).
- **Docs**: Swagger UI at **`/api-docs`**; canonical spec [`openapi.yaml`](openapi.yaml).

### Layout

| Path | Purpose |
|------|---------|
| [`src/http/app.ts`](src/http/app.ts) | Express middleware, routes mount, Swagger UI, JSON error helper |
| [`src/index.ts`](src/index.ts) | `http.Server` lifecycle, Postgres/Redis connect & shutdown |
| [`tests/setup/env.ts`](tests/setup/env.ts) | Vitest pre-load env defaults |
| [`tests/**/*.test.ts`](tests/http/app.test.ts) | Automated tests |

### Environment note

There is a **single deployed target** (production). **`NODE_ENV`** defaults to **`production`**; set **`NODE_ENV=development`** locally only if you want verbose error bodies. Vitest forces **`test`**. List allowed browser sites in **`CORS_ORIGINS`** when the agent and admin apps are on different hosts.

### Planned (not implemented yet)

- Agent activity ingestion + admin aggregates, auth separation for two front-end apps.
