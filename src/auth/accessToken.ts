import { errors, jwtVerify, SignJWT } from "jose";

import { env } from "../config/env";

const encoder = new TextEncoder();

interface AccessJwtPayload {
  roles?: unknown;
}

export async function signAccessToken(payload: {
  userId: string;
  roles: string[];
}): Promise<string> {
  const secret = encoder.encode(env.JWT_ACCESS_SECRET);
  const jwt = await new SignJWT({
    roles: payload.roles,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.userId)
    .setIssuedAt()
    .setExpirationTime(env.ACCESS_TOKEN_EXPIRES_IN)
    .sign(secret);
  return jwt;
}

/** @throws JOSE errors if malformed or expired */
export async function verifyAccessToken(token: string): Promise<{
  userId: string;
  roles: string[];
}> {
  const secret = encoder.encode(env.JWT_ACCESS_SECRET);
  const { payload } = await jwtVerify<AccessJwtPayload>(token, secret, {
    algorithms: ["HS256"],
  });
  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new errors.JWTInvalid("JWT subject (sub) missing or invalid");
  }
  const rolesRaw = payload.roles;
  const roles =
    Array.isArray(rolesRaw) && rolesRaw.every((r) => typeof r === "string")
      ? (rolesRaw as string[]).slice().sort((a, b) => a.localeCompare(b))
      : [];

  return { userId: payload.sub, roles };
}
