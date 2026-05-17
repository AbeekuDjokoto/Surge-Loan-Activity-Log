import type { NextFunction, RequestHandler } from "express";
import type { Response } from "express";
import { errors as JOSE } from "jose";

import { verifyAccessToken } from "../auth/accessToken";
import { HttpError } from "./httpError";

function parseBearer(authHeader?: string): string | null {
  if (typeof authHeader !== "string") return null;
  const trimmed = authHeader.trim();
  if (!trimmed.toLowerCase().startsWith("bearer ")) return null;
  const token = trimmed.slice(7).trim();
  return token.length > 0 ? token : null;
}

/** Verifies Bearer access JWT and attaches `req.auth`. */
export const authenticate: RequestHandler = async (
  req,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  const token = parseBearer(req.headers.authorization);
  if (!token) {
    next(new HttpError(401, "Missing or invalid Bearer token"));
    return;
  }
  try {
    const verified = await verifyAccessToken(token);
    req.auth = { userId: verified.userId, roles: verified.roles };
    next();
  } catch (err) {
    if (err instanceof JOSE.JOSEError) {
      next(new HttpError(401, "Invalid or expired access token"));
      return;
    }
    next(err);
  }
};

/** After `authenticate`, require any of `allowedRoles`. */
export function requireRoles(...allowedRoles: string[]): RequestHandler {
  return (req, _res: Response, next: NextFunction) => {
    if (!req.auth) {
      next(new HttpError(401, "Not authenticated"));
      return;
    }
    const has = req.auth.roles.some((r) => allowedRoles.includes(r));
    if (!has) {
      next(new HttpError(403, "Insufficient permissions"));
      return;
    }
    next();
  };
}

/**
 * After `authenticate`: non-admin users with the `user` role (signup default).
 * Admins cannot submit agent daily activity via this middleware.
 */
export const requireAgent: RequestHandler = (req, _res: Response, next: NextFunction) => {
  if (!req.auth) {
    next(new HttpError(401, "Not authenticated"));
    return;
  }
  if (req.auth.roles.includes("admin")) {
    next(new HttpError(403, "Administrator accounts cannot use this agent-only endpoint"));
    return;
  }
  if (!req.auth.roles.includes("user")) {
    next(new HttpError(403, "Insufficient permissions"));
    return;
  }
  next();
};

/** After `authenticate`: caller must include the `admin` role. */
export const requireAdmin: RequestHandler = (req, _res: Response, next: NextFunction) => {
  if (!req.auth) {
    next(new HttpError(401, "Not authenticated"));
    return;
  }
  if (!req.auth.roles.includes("admin")) {
    next(new HttpError(403, "Insufficient permissions"));
    return;
  }
  next();
};
