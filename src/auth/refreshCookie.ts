/**
 * Browser-only rotation surface: opaque refresh token stays out of JS-accessible responses.
 *
 * Stored as HttpOnly; Path `/auth` so it is sent only on auth routes (`/auth/refresh`, `/auth/logout`).
 */
import type { Request, Response } from "express";

import { env } from "../config/env";
import { refreshTtlSeconds } from "./refreshSession";

export const REFRESH_COOKIE_NAME = "surge_refresh";

const REFRESH_COOKIE_PATH = "/auth";

function cookieTail(): string {
  const parts = [
    `Path=${REFRESH_COOKIE_PATH}`,
    `Max-Age=${refreshTtlSeconds()}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (env.NODE_ENV === "production") {
    parts.push("Secure");
  }
  return parts.join("; ");
}

export function attachRefreshCookie(res: Response, rawToken: string): void {
  const value = encodeURIComponent(rawToken);
  res.append("Set-Cookie", `${REFRESH_COOKIE_NAME}=${value}; ${cookieTail()}`);
}

export function revokeRefreshCookie(res: Response): void {
  const parts = [
    `${REFRESH_COOKIE_NAME}=`,
    `Path=${REFRESH_COOKIE_PATH}`,
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    ...(env.NODE_ENV === "production" ? ["Secure"] : []),
  ];
  res.append("Set-Cookie", parts.join("; "));
}

/** Parse `Cookie` header; returns raw (decoded) surge_refresh token if present. */
export function readRefreshTokenFromCookies(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (typeof header !== "string" || header.length === 0) return undefined;

  for (const fragment of header.split(";")) {
    const trimmed = fragment.trimStart();
    if (!trimmed.toLowerCase().startsWith(`${REFRESH_COOKIE_NAME}=`))
      continue;
    const encoded = trimmed.slice(REFRESH_COOKIE_NAME.length + 1);
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  }
  return undefined;
}
