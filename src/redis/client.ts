import { createClient, type RedisClientType } from "redis";

import { env } from "../config/env";

let client: RedisClientType | undefined;

export function getRedis(): RedisClientType {
  if (!client) {
    client = createClient({ url: env.REDIS_URL });
    client.on("error", (err) => {
      console.error("[redis]", err);
    });
  }
  return client;
}

export async function connectRedis(): Promise<void> {
  const redis = getRedis();
  if (!redis.isOpen) {
    await redis.connect();
  }
}

export async function disconnectRedis(): Promise<void> {
  if (!client) return;
  if (client.isOpen) {
    await client.quit();
  }
  client = undefined;
}
