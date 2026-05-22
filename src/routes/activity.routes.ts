import { Router } from "express";
import { ZodError, z } from "zod";

import {
  DuplicateDailyActivityConflict,
  deleteDailyActivityById,
  deleteDailyActivityByIds,
  insertDailyActivity,
  paginateDailyActivity,
  selectAgentUserIdForDailyActivity,
  selectAgentUserIdsForDailyActivityIds,
  selectDailyActivityById,
  updateDailyActivityPartial,
  type DailyActivityListFilters,
} from "../db/dailyActivityQueries";
import { authenticate, requireAdmin, requireAgent } from "../http/authMiddleware";
import { HttpError } from "../http/httpError";

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

const isoDateSchema = z
  .string()
  .regex(isoDateRegex, "must be YYYY-MM-DD")
  .refine(isCalendarDateLogical, { message: "not a valid calendar date" });

/** Editable POST fields for agents/admins — at least one key required */
const patchDailyActivityBodySchema = z
  .object({
    applications_count: z.coerce.number().int().nonnegative().optional(),
    loan_amount: z.coerce.number().finite().nonnegative().optional(),
    update_date: isoDateSchema.optional(),
  })
  .strict()
  .refine(
    (b) =>
      b.applications_count !== undefined ||
      b.loan_amount !== undefined ||
      b.update_date !== undefined,
    {
      message: "At least one of applications_count, loan_amount, update_date is required",
    }
  );

const dailyActivityBodySchema = z
  .object({
    agent_uuid: z.string().uuid(),
    agent_full_name: z.string().trim().min(1).max(200),
    location: z.string().trim().min(1).max(200),
    applications_count: z.coerce.number().int().nonnegative(),
    loan_amount: z.coerce.number().finite().nonnegative(),
    update_date: isoDateSchema,
  })
  .strict();

const bulkDeleteDailyActivityBodySchema = z
  .object({
    daily_activity_ids: z.array(z.string().uuid()).min(1).max(100),
  })
  .strict();

const sharedListQueryShape = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  page_size: z.coerce.number().int().positive().max(100).optional().default(20),
  date_from: isoDateSchema.optional(),
  date_to: isoDateSchema.optional(),
  loan_min: z.coerce.number().finite().nonnegative().optional(),
  loan_max: z.coerce.number().finite().nonnegative().optional(),
  location: z.string().trim().min(1).max(200).optional(),
  name: z.string().trim().min(1).max(200).optional(),
});

const agentDailyListQuerySchema = sharedListQueryShape
  .strict()
  .superRefine((q, ctx) => {
    if (
      q.date_from !== undefined &&
      q.date_to !== undefined &&
      q.date_from > q.date_to
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "date_to must be on or after date_from",
        path: ["date_to"],
      });
    }
    if (
      q.loan_min !== undefined &&
      q.loan_max !== undefined &&
      q.loan_min > q.loan_max
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "loan_max must be greater than or equal to loan_min",
        path: ["loan_max"],
      });
    }
  });

const adminDailyListQuerySchema = sharedListQueryShape
  .extend({
    agent_uuid: z.string().uuid().optional(),
  })
  .strict()
  .superRefine((q, ctx) => {
    if (
      q.date_from !== undefined &&
      q.date_to !== undefined &&
      q.date_from > q.date_to
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "date_to must be on or after date_from",
        path: ["date_to"],
      });
    }
    if (
      q.loan_min !== undefined &&
      q.loan_max !== undefined &&
      q.loan_min > q.loan_max
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "loan_max must be greater than or equal to loan_min",
        path: ["loan_max"],
      });
    }
  });

function filtersFromParsed(
  parsed:
    | z.infer<typeof agentDailyListQuerySchema>
    | z.infer<typeof adminDailyListQuerySchema>
): Omit<DailyActivityListFilters, "agentUserId"> {
  return {
    dateFrom: parsed.date_from,
    dateTo: parsed.date_to,
    loanMin: parsed.loan_min,
    loanMax: parsed.loan_max,
    locationSubstring: parsed.location,
    nameSubstring: parsed.name,
  };
}

function mapZodError(err: ZodError): HttpError {
  const first = err.issues[0];
  if (!first) return new HttpError(422, "Validation failed");
  const loc =
    Array.isArray(first.path) && first.path.length > 0 ? first.path.join(".") : "payload";
  return new HttpError(422, `Invalid ${loc}: ${first.message}`);
}

function paginationMeta(params: {
  page: number;
  page_size: number;
  total_items: number;
}) {
  const total_pages = Math.max(1, Math.ceil(params.total_items / params.page_size) || 1);
  return {
    page: params.page,
    page_size: params.page_size,
    total_items: params.total_items,
    total_pages,
  };
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

activityRouter.post(
  "/daily/delete",
  authenticate,
  async (req, res, next) => {
    try {
      const parsed = bulkDeleteDailyActivityBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) throw mapZodError(parsed.error);

      const auth = req.auth;
      if (!auth) {
        throw new HttpError(401, "Not authenticated");
      }

      const isAdmin = auth.roles.includes("admin");
      const isAgentEligible =
        auth.roles.includes("user") && !auth.roles.includes("admin");

      if (!isAdmin && !isAgentEligible) {
        throw new HttpError(403, "Insufficient permissions");
      }

      const uniqueIds = [...new Set(parsed.data.daily_activity_ids)];
      const ownerById = await selectAgentUserIdsForDailyActivityIds(uniqueIds);

      for (const id of uniqueIds) {
        const ownerId = ownerById.get(id);
        if (ownerId === undefined) {
          throw new HttpError(404, "Daily activity not found");
        }
        if (!isAdmin && ownerId !== auth.userId) {
          throw new HttpError(
            403,
            "You can only delete your own daily activity",
          );
        }
      }

      const deletedCount = await deleteDailyActivityByIds(uniqueIds);

      res.status(200).json({
        deleted_count: deletedCount,
        daily_activity_ids: uniqueIds,
      });
    } catch (err) {
      next(err);
    }
  },
);

activityRouter.patch(
  "/daily/:daily_activity_id",
  authenticate,
  async (req, res, next) => {
    try {
      const uuidSchema = z.string().uuid();
      const idParsed = uuidSchema.safeParse(req.params.daily_activity_id ?? "");
      if (!idParsed.success) {
        throw new HttpError(422, "Invalid daily_activity_id: UUID expected");
      }
      const activityId = idParsed.data;

      const bodyParsed = patchDailyActivityBodySchema.safeParse(req.body ?? {});
      if (!bodyParsed.success) throw mapZodError(bodyParsed.error);

      const auth = req.auth;
      if (!auth) {
        throw new HttpError(401, "Not authenticated");
      }

      const isAdmin = auth.roles.includes("admin");
      const isAgentEligible =
        auth.roles.includes("user") && !auth.roles.includes("admin");

      if (!isAdmin && !isAgentEligible) {
        throw new HttpError(403, "Insufficient permissions");
      }

      const ownerId = await selectAgentUserIdForDailyActivity(activityId);
      if (ownerId === null) {
        throw new HttpError(404, "Daily activity not found");
      }

      if (!isAdmin && ownerId !== auth.userId) {
        throw new HttpError(
          403,
          "You can only edit your own daily activity",
        );
      }

      const daily_activity = await updateDailyActivityPartial({
        activityId,
        applicationsCount: bodyParsed.data.applications_count,
        loanAmount: bodyParsed.data.loan_amount,
        updateDateIso: bodyParsed.data.update_date,
      }).catch((err: unknown) => {
        if (err instanceof DuplicateDailyActivityConflict)
          throw new HttpError(409, err.message);
        throw err;
      });

      res.status(200).json({ daily_activity });
    } catch (err) {
      next(err);
    }
  },
);

activityRouter.delete(
  "/daily/:daily_activity_id",
  authenticate,
  async (req, res, next) => {
    try {
      const uuidSchema = z.string().uuid();
      const idParsed = uuidSchema.safeParse(req.params.daily_activity_id ?? "");
      if (!idParsed.success) {
        throw new HttpError(422, "Invalid daily_activity_id: UUID expected");
      }
      const activityId = idParsed.data;

      const auth = req.auth;
      if (!auth) {
        throw new HttpError(401, "Not authenticated");
      }

      const isAdmin = auth.roles.includes("admin");
      const isAgentEligible =
        auth.roles.includes("user") && !auth.roles.includes("admin");

      if (!isAdmin && !isAgentEligible) {
        throw new HttpError(403, "Insufficient permissions");
      }

      const ownerId = await selectAgentUserIdForDailyActivity(activityId);
      if (ownerId === null) {
        throw new HttpError(404, "Daily activity not found");
      }

      if (!isAdmin && ownerId !== auth.userId) {
        throw new HttpError(
          403,
          "You can only delete your own daily activity",
        );
      }

      await deleteDailyActivityById(activityId);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

activityRouter.get(
  "/daily/me",
  authenticate,
  requireAgent,
  async (req, res, next) => {
    try {
      const parsed = agentDailyListQuerySchema.safeParse(req.query ?? {});
      if (!parsed.success) throw mapZodError(parsed.error);

      const userId = req.auth?.userId;
      if (!userId) {
        throw new HttpError(401, "Not authenticated");
      }

      const filters: DailyActivityListFilters = {
        ...filtersFromParsed(parsed.data),
        agentUserId: userId,
      };

      const result = await paginateDailyActivity({
        filters,
        page: parsed.data.page,
        pageSize: parsed.data.page_size,
      });

      res.status(200).json({
        items: result.items,
        pagination: paginationMeta({
          page: parsed.data.page,
          page_size: parsed.data.page_size,
          total_items: result.total_items,
        }),
        summary: result.summary,
      });
    } catch (err) {
      next(err);
    }
  }
);

activityRouter.get(
  "/daily/:daily_activity_id",
  authenticate,
  async (req, res, next) => {
    try {
      const uuidSchema = z.string().uuid();
      const idParsed = uuidSchema.safeParse(req.params.daily_activity_id ?? "");
      if (!idParsed.success) {
        throw new HttpError(422, "Invalid daily_activity_id: UUID expected");
      }
      const activityId = idParsed.data;

      const auth = req.auth;
      if (!auth) {
        throw new HttpError(401, "Not authenticated");
      }

      const isAdmin = auth.roles.includes("admin");
      const isAgentEligible =
        auth.roles.includes("user") && !auth.roles.includes("admin");

      if (!isAdmin && !isAgentEligible) {
        throw new HttpError(403, "Insufficient permissions");
      }

      const row = await selectDailyActivityById(activityId);
      if (row === null) {
        throw new HttpError(404, "Daily activity not found");
      }

      if (!isAdmin && row.agent_uuid !== auth.userId) {
        throw new HttpError(403, "You can only view your own daily activity");
      }

      res.status(200).json({ daily_activity: row });
    } catch (err) {
      next(err);
    }
  }
);

activityRouter.get(
  "/daily",
  authenticate,
  requireAdmin,
  async (req, res, next) => {
    try {
      const parsed = adminDailyListQuerySchema.safeParse(req.query ?? {});
      if (!parsed.success) throw mapZodError(parsed.error);

      const filters: DailyActivityListFilters = {
        ...filtersFromParsed(parsed.data),
        agentUserId:
          parsed.data.agent_uuid !== undefined ? parsed.data.agent_uuid : undefined,
      };

      const result = await paginateDailyActivity({
        filters,
        page: parsed.data.page,
        pageSize: parsed.data.page_size,
      });

      res.status(200).json({
        items: result.items,
        pagination: paginationMeta({
          page: parsed.data.page,
          page_size: parsed.data.page_size,
          total_items: result.total_items,
        }),
        summary: result.summary,
      });
    } catch (err) {
      next(err);
    }
  }
);
