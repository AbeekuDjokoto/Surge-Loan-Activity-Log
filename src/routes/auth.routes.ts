import { Router, type Response } from "express";
import rateLimit from "express-rate-limit";
import { ZodError, z } from "zod";

import { durationToSeconds } from "../auth/duration";
import { attachRefreshCookie, readRefreshTokenFromCookies, revokeRefreshCookie } from "../auth/refreshCookie";
import { hashPassword, verifyPassword } from "../auth/password";
import { signAccessToken } from "../auth/accessToken";
import {
  revokeAllRefreshTokensForUser,
  revokeRefresh,
  rotateRefresh,
  storeRefresh,
} from "../auth/refreshSession";
import { env } from "../config/env";
import { consumeAdminInvite } from "../db/adminInviteQueries";
import {
  consumePasswordResetToken,
  createPasswordResetToken,
} from "../db/passwordResetQueries";
import { pool } from "../db/pool";
import {
  DuplicateEmailConflict,
  insertUserAndAssignRole,
  selectUserCredentialByEmail,
  selectUserIdByEmail,
  selectUserPublicById,
  updateUserProfileById,
  type UserPublicRow,
} from "../db/userQueries";
import { sendPasswordResetEmail } from "../email/sendPasswordReset";
import { HttpError } from "../http/httpError";
import { authenticate } from "../http/authMiddleware";
import { logger } from "../logger";

const registerLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many signup attempts — try again later" },
});

const loginLimiter = rateLimit({
  windowMs: 60_000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts — try again later" },
});

const forgotPasswordLimiter = rateLimit({
  windowMs: 60_000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many password reset requests — try again later" },
});

const resetPasswordLimiter = rateLimit({
  windowMs: 60_000,
  max: 25,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many reset attempts — try again later" },
});

const acceptAdminInviteLimiter = rateLimit({
  windowMs: 60_000,
  max: 24,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many invite acceptance attempts — try again later" },
});

export const authRouter = Router();

const registerSchema = z.object({
  full_name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320),
  password: z.string().min(12).max(200),
  location_station: z.string().trim().min(1).max(200),
});

const credentialsSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(200),
});

const forgotPasswordSchema = z.object({
  email: z.string().trim().email().max(320),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1).max(512),
  password: z.string().min(12).max(200),
});

const acceptAdminInviteSchema = z
  .object({
    token: z.string().min(1).max(512),
    password: z.string().min(12).max(200).optional(),
    full_name: z.string().trim().min(1).max(200).optional(),
    location_station: z.string().trim().min(1).max(200).optional(),
  })
  .strict()
  .superRefine((b, ctx) => {
    const hasReg =
      b.password !== undefined ||
      b.full_name !== undefined ||
      b.location_station !== undefined;
    if (!hasReg) return;
    if (b.password === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "password is required when registering via invite",
        path: ["password"],
      });
    }
    if (b.full_name === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "full_name is required when registering via invite",
        path: ["full_name"],
      });
    }
    if (b.location_station === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "location_station is required when registering via invite",
        path: ["location_station"],
      });
    }
  });

const patchMeSchema = z
  .object({
    full_name: z.string().trim().min(1).max(200).optional(),
    location_station: z.string().trim().min(1).max(200).optional(),
    email: z.string().trim().email().max(320).optional(),
  })
  .strict()
  .refine(
    (b) =>
      b.full_name !== undefined ||
      b.location_station !== undefined ||
      b.email !== undefined,
    { message: "At least one of full_name, location_station, email is required" }
  );

function publicUserPayload(row: UserPublicRow) {
  return {
    id: row.id,
    email: row.email,
    full_name: row.full_name,
    location_station: row.location_station,
    email_verified_at: row.email_verified_at?.toISOString() ?? null,
    roles: row.roles,
  };
}

async function accessTokenJsonSlice(user: UserPublicRow): Promise<{
  user: ReturnType<typeof publicUserPayload>;
  access_token: string;
  expires_in: number;
}> {
  const access_token = await signAccessToken({
    userId: user.id,
    roles: user.roles,
  });
  const expires_in = durationToSeconds(env.ACCESS_TOKEN_EXPIRES_IN);
  return {
    user: publicUserPayload(user),
    access_token,
    expires_in,
  };
}

/** Issue new opaque refresh slot (Redis) + HttpOnly cookie; JSON carries access JWT only. */
async function sendSession(user: UserPublicRow, res: Response, httpStatus: number) {
  const refreshRaw = await storeRefresh(user.id);
  attachRefreshCookie(res, refreshRaw);
  const body = await accessTokenJsonSlice(user);
  res.status(httpStatus).json(body);
}

function mapZodError(err: ZodError): HttpError {
  const first = err.issues[0];
  if (!first) return new HttpError(422, "Validation failed");
  const loc =
    Array.isArray(first.path) && first.path.length > 0
      ? first.path.join(".")
      : "payload";
  return new HttpError(422, `Invalid ${loc}: ${first.message}`);
}

authRouter.post("/register", registerLimiter, async (req, res, next) => {
  try {
    const parsed = registerSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw mapZodError(parsed.error);

    const password_hash = await hashPassword(parsed.data.password);
    const row = await insertUserAndAssignRole({
      ...parsed.data,
      password_hash,
    }).catch((err: unknown) => {
      if (err instanceof DuplicateEmailConflict)
        throw new HttpError(409, err.message);
      throw err;
    });

    await sendSession(row, res, 201);
  } catch (err) {
    next(err);
  }
});

authRouter.post("/login", loginLimiter, async (req, res, next) => {
  try {
    const parsed = credentialsSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw mapZodError(parsed.error);

    const email = parsed.data.email.toLowerCase();
    const cred = await selectUserCredentialByEmail(pool, email);
    if (
      !cred ||
      !(await verifyPassword(cred.password_hash, parsed.data.password))
    ) {
      throw new HttpError(401, "Invalid email or password");
    }

    const row = await selectUserPublicById(cred.id);
    if (!row) throw new HttpError(500, "User record missing");

    await sendSession(row, res, 200);
  } catch (err) {
    next(err);
  }
});

authRouter.post(
  "/forgot-password",
  forgotPasswordLimiter,
  async (req, res, next) => {
    try {
      const parsed = forgotPasswordSchema.safeParse(req.body ?? {});
      if (!parsed.success) throw mapZodError(parsed.error);

      const email = parsed.data.email.trim().toLowerCase();
      const userId = await selectUserIdByEmail(pool, email);
      if (userId) {
        const { rawToken } = await createPasswordResetToken({
          userId,
          ttlHours: env.PASSWORD_RESET_TOKEN_TTL_HOURS,
        });
        try {
          await sendPasswordResetEmail({ to: email, rawToken });
        } catch (err) {
          logger.error({ err }, "password reset email failed");
        }
      }

      res.status(202).json({
        message:
          "If an account exists for that email, you will receive password reset instructions.",
      });
    } catch (err) {
      next(err);
    }
  }
);

authRouter.post(
  "/reset-password",
  resetPasswordLimiter,
  async (req, res, next) => {
    try {
      const parsed = resetPasswordSchema.safeParse(req.body ?? {});
      if (!parsed.success) throw mapZodError(parsed.error);

      const passwordHash = await hashPassword(parsed.data.password);
      const result = await consumePasswordResetToken({
        rawToken: parsed.data.token,
        passwordHash,
      });
      if (!result.ok)
        throw new HttpError(400, "Invalid or expired reset token");

      await revokeAllRefreshTokensForUser(result.userId);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  }
);

authRouter.post(
  "/accept-admin-invite",
  acceptAdminInviteLimiter,
  async (req, res, next) => {
    try {
      const parsed = acceptAdminInviteSchema.safeParse(req.body ?? {});
      if (!parsed.success) throw mapZodError(parsed.error);

      const d = parsed.data;
      const passwordHash =
        d.password !== undefined ? await hashPassword(d.password) : undefined;

      const result = await consumeAdminInvite({
        rawToken: d.token,
        passwordHash,
        full_name: d.full_name,
        location_station: d.location_station,
      });

      if (!result.ok) {
        if (result.reason === "invalid_or_expired") {
          throw new HttpError(400, "Invalid or expired invite token");
        }
        if (result.reason === "already_admin") {
          throw new HttpError(409, "User is already an administrator");
        }
        if (result.reason === "email_already_registered") {
          throw new HttpError(409, "Email is already registered");
        }
        throw new HttpError(
          422,
          "Provide password, full_name, and location_station to create your administrator account",
        );
      }

      await revokeAllRefreshTokensForUser(result.userId);
      const row = await selectUserPublicById(result.userId);
      if (!row) throw new HttpError(500, "User record missing");

      await sendSession(row, res, 201);
    } catch (err) {
      next(err);
    }
  },
);

authRouter.post("/refresh", async (req, res, next) => {
  try {
    const rt = readRefreshTokenFromCookies(req);
    const minChars = 22;
    if (typeof rt !== "string" || rt.length < minChars)
      throw new HttpError(
        401,
        "Missing or expired refresh session (HttpOnly surge_refresh cookie required)"
      );

    const rotated = await rotateRefresh(rt);
    if (!rotated) throw new HttpError(401, "Invalid or expired refresh token");

    const row = await selectUserPublicById(rotated.userId);
    if (!row) throw new HttpError(401, "Invalid or expired refresh token");

    attachRefreshCookie(res, rotated.newRefresh);
    const body = await accessTokenJsonSlice(row);
    res.status(200).json(body);
  } catch (err) {
    next(err);
  }
});

authRouter.post("/logout", async (req, res, next) => {
  try {
    const rt = readRefreshTokenFromCookies(req);
    if (typeof rt === "string" && rt.length > 0) await revokeRefresh(rt);
    revokeRefreshCookie(res);

    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

authRouter.get("/me", authenticate, async (req, res, next) => {
  try {
    const userId = req.auth!.userId;
    const row = await selectUserPublicById(userId);
    if (!row) throw new HttpError(404, "User not found");

    res.status(200).json({ user: publicUserPayload(row) });
  } catch (err) {
    next(err);
  }
});

authRouter.patch("/me", authenticate, async (req, res, next) => {
  try {
    const parsed = patchMeSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw mapZodError(parsed.error);

    const userId = req.auth!.userId;
    try {
      const row = await updateUserProfileById({
        userId,
        patch: parsed.data,
      });
      if (!row) throw new HttpError(404, "User not found");

      res.status(200).json({ user: publicUserPayload(row) });
    } catch (err: unknown) {
      if (err instanceof DuplicateEmailConflict)
        throw new HttpError(409, err.message);
      throw err;
    }
  } catch (err) {
    next(err);
  }
});
