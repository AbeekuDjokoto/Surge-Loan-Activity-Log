import { createServer } from "node:http";
import process from "node:process";

import { env } from "./config/env";
import { createApp } from "./http/app";
import { logger } from "./logger";
import { pool } from "./db/pool";
import { connectRedis, disconnectRedis } from "./redis/client";

async function main(): Promise<void> {
  const app = createApp();
  const server = createServer(app);

  await connectRedis();

  server.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, "HTTP server listening");
  });

  async function shutdown(signal: string): Promise<void> {
    logger.info({ signal }, "shutdown: closing HTTP server");
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    await pool.end();
    await disconnectRedis();
    logger.info("shutdown complete");
  }

  process.once("SIGINT", () => {
    void shutdown("SIGINT")
      .then(() => process.exit(0))
      .catch((err) => {
        logger.error({ err }, "shutdown failed");
        process.exit(1);
      });
  });

  process.once("SIGTERM", () => {
    void shutdown("SIGTERM")
      .then(() => process.exit(0))
      .catch((err) => {
        logger.error({ err }, "shutdown failed");
        process.exit(1);
      });
  });
}

main().catch((err) => {
  logger.error({ err }, "fatal startup error");
  process.exit(1);
});
