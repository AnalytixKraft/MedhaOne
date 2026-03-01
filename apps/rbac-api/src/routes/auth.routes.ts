import { Router } from "express";

import { login, createSudoToken } from "../services/auth.service.js";
import { authenticate } from "../middleware/auth.js";
import { requireRoles } from "../middleware/roles.js";

export const authRouter = Router();

authRouter.post("/login", async (req, res, next) => {
  try {
    const result = await login(req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

authRouter.post(
  "/sudo/:organizationId",
  authenticate,
  requireRoles("SUPER_ADMIN"),
  async (req, res, next) => {
    try {
      const { organizationId } = req.params as { organizationId: string };
      const result = await createSudoToken(req.auth!.userId, organizationId);
      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);
