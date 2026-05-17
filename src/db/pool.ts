import { Pool } from "pg";

import { databaseSchema } from "../config/databaseEnv";

const { DATABASE_URL } = databaseSchema.parse(process.env);

export const pool = new Pool({
  connectionString: DATABASE_URL,
  application_name: "surge-loan-activity-log-api",
});
