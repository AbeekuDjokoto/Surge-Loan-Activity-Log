import { Router } from "express";
import { ZodError, z } from "zod";

import { env } from "../config/env";
import { createAdminInvite, emailHasAdminRole } from "../db/adminInviteQueries";
import { selectUserPublicById } from "../db/userQueries";
import { sendAdminInviteEmail } from "../email/sendAdminInvite";
import { authenticate, requireAdmin } from "../http/authMiddleware";
import { HttpError } from "../http/httpError";

export const adminRouter = Router();

const inviteBodySchema = z
  .object({
    email: z.string().trim().email().max(320),
  })
  .strict();

function mapZodError(err: ZodError): HttpError {
  const first = err.issues[0];
  if (!first) return new HttpError(422, "Validation failed");
  const loc =
    Array.isArray(first.path) && first.path.length > 0 ? first.path.join(".") : "payload";
  return new HttpError(422, `Invalid ${loc}: ${first.message}`);
}

function publicUserPayload(row: Awaited<ReturnType<typeof selectUserPublicById>>) {
  if (!row) throw new HttpError(500, "User record missing");
  return {
    id: row.id,
    email: row.email,
    full_name: row.full_name,
    location_station: row.location_station,
    email_verified_at: row.email_verified_at?.toISOString() ?? null,
    roles: row.roles,
  };
}

/** True if JWT identity is an agent account (user, not admin). */
function isAgentAccount(roles: string[]): boolean {
  return roles.includes("user") && !roles.includes("admin");
}

adminRouter.post("/invites", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const parsed = inviteBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) throw mapZodError(parsed.error);

    const email = parsed.data.email.trim().toLowerCase();
    const alreadyAdmin = await emailHasAdminRole(email);
    if (alreadyAdmin) {
      throw new HttpError(409, "User is already an administrator");
    }

    const invitedByUserId = req.auth!.userId;
    const { rawToken, expiresAt } = await createAdminInvite({
      email,
      invitedByUserId,
      ttlHours: env.ADMIN_INVITE_TOKEN_TTL_HOURS,
    });

    try {
      await sendAdminInviteEmail({ to: email, rawToken });
    } catch (err) {
      next(err);
      return;
    }

    res.status(201).json({
      email,
      expires_at: expiresAt.toISOString(),
      message: "Invitation sent when email delivery succeeds.",
    });
  } catch (err) {
    next(err);
  }
});

adminRouter.get("/agents/:agent_uuid", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const uuidSchema = z.string().uuid();
    const idParsed = uuidSchema.safeParse(req.params.agent_uuid ?? "");
    if (!idParsed.success) {
      throw new HttpError(422, "Invalid agent_uuid: UUID expected");
    }

    const row = await selectUserPublicById(idParsed.data);
    if (!row) {
      throw new HttpError(404, "User not found");
    }
    if (!isAgentAccount(row.roles)) {
      throw new HttpError(404, "Not an agent account");
    }

    res.status(200).json({ user: publicUserPayload(row) });
  } catch (err) {
    next(err);
  }
});
