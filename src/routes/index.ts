import { Router } from "express";

import { activityRouter } from "./activity.routes";
import { adminRouter } from "./admin.routes";
import { authRouter } from "./auth.routes";
import { healthRouter } from "./health.routes";

export const apiRouter = Router();

apiRouter.use(healthRouter);
apiRouter.use("/auth", authRouter);
apiRouter.use("/activity", activityRouter);
apiRouter.use("/admin", adminRouter);
