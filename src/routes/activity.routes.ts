import { Router } from "express";
import { ZodError, z } from "zod";

import {
  DuplicateDailyActivityConflict,
  insertDailyActivity,
} from "../db/dailyActivityQueries";
import { HttpError } from "../http/httpError";
import { authenticate, requireAgent } from "../http/authMiddleware";

export const activityRouter = Router();

const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;
function isCalendarDateLogical(s: string): boolean {
  const [yRaw, moRaw, dRaw] = s.split("-").map(Number);
  if (!yRaw || !moRaw || !dRaw) return false;
  const d = new Date(Date.UTC(yRaw, moRaw - 1, dRaw));
  return (
    d.getUTCFullYear() === yRaw &&
    d.getUTCMonth() === moRaw - 1 &&
    d.getUTCDate() === dRaw
  );
}

const dailyActivityBodySchema = z
  .object({
    agent_uuid: z.string().uuid(),
    agent_full_name: z.string().trim().min(1).max(200),
    location: z.string().trim().min(1).max(200),
    applications_count: z.coerce.number().int().nonnegative(),
    loan_amount: z.coerce.number().finite().nonnegative(),
    update_date: z
      .string()
      .trim()
      .regex(isoDateRegex, "update_date must be YYYY-MM-DD")
      .refine(isCalendarDateLogical, {
        message: "update_date is not a valid calendar date",
      }),
  })
  .strict();

function mapZodError(err: ZodError): HttpError {
  const first = err.issues[0];
  if (!first) return new HttpError(422, "Validation failed");
  const loc =
    Array.isArray(first.path) && first.path.length > 0 ? first.path.join(".") : "payload";
  return new HttpError(422, `Invalid ${loc}: ${first.message}`);
}

activityRouter.post(
  "/daily",
  authenticate,
  requireAgent,
  async (req, res, next) => {
    try {
      const parsed = dailyActivityBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) throw mapZodError(parsed.error);

      if (parsed.data.agent_uuid !== req.auth?.userId) {
        throw new HttpError(
          403,
          "agent_uuid must match the authenticated user",
        );
      }

      const daily_activity = await insertDailyActivity({
        agentUserId: parsed.data.agent_uuid,
        agentFullName: parsed.data.agent_full_name,
        location: parsed.data.location,
        applicationsCount: parsed.data.applications_count,
        loanAmount: parsed.data.loan_amount,
        updateDateIso: parsed.data.update_date,
      }).catch((err: unknown) => {
        if (err instanceof DuplicateDailyActivityConflict)
          throw new HttpError(409, err.message);
        throw err;
      });

      res.status(201).json({ daily_activity });
    } catch (err) {
      next(err);
    }
  }
);
