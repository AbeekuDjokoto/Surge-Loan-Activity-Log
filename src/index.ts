import { createServer } from "node:http";
import process from "node:process";

import { createApp } from "./http/app";
import { env } from "./config/env";
import { pool } from "./db/pool";
import { connectRedis, disconnectRedis } from "./redis/client";

async function main(): Promise<void> {
  const app = createApp();
  const server = createServer(app);

  await connectRedis();

  server.listen(env.PORT, () => {
    console.info(`Listening on port ${env.PORT}`);
  });

  async function shutdown(signal: string): Promise<void> {
    console.info(`${signal} received — closing HTTP server`);
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    await pool.end();
    await disconnectRedis();
    console.info("Shutdown complete");
  }

  process.once("SIGINT", () => {
    void shutdown("SIGINT")
      .then(() => process.exit(0))
      .catch((err) => {
        console.error(err);
        process.exit(1);
      });
  });

  process.once("SIGTERM", () => {
    void shutdown("SIGTERM")
      .then(() => process.exit(0))
      .catch((err) => {
        console.error(err);
        process.exit(1);
      });
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
