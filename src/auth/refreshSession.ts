import { randomBytes, createHmac } from "node:crypto";

import { env } from "../config/env";
import { getRedis } from "../redis/client";
import { durationToSeconds } from "./duration";

const PREFIX = "surge:refresh:v1";

function hashRefresh(raw: string): string {
  return createHmac("sha256", env.JWT_REFRESH_SECRET)
    .update(raw)
    .digest("hex");
}

export function refreshTtlSeconds(): number {
  return durationToSeconds(env.REFRESH_TOKEN_EXPIRES_IN);
}

export async function storeRefresh(userId: string): Promise<string> {
  const raw = randomBytes(32).toString("base64url");
  const key = `${PREFIX}:${hashRefresh(raw)}`;
  await getRedis().set(key, userId, { EX: refreshTtlSeconds() });
  return raw;
}

/** Remove an active refresh slot (logout). Missing keys are ignored. */
export async function revokeRefresh(raw: string): Promise<void> {
  const key = `${PREFIX}:${hashRefresh(raw)}`;
  await getRedis().del(key);
}

/**
 * Validate the presented refresh token, delete it from Redis (rotation),
 * and issue the next opaque refresh bound to the same user.
 */
export async function rotateRefresh(
  raw: string
): Promise<{ userId: string; newRefresh: string } | null> {
  const redis = getRedis();
  const oldKey = `${PREFIX}:${hashRefresh(raw)}`;
  const userId = await redis.get(oldKey);
  if (!userId) return null;
  await redis.del(oldKey);
  const newRefresh = await storeRefresh(userId);
  return { userId, newRefresh };
}
