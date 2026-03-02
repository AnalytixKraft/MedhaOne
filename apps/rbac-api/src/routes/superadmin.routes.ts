import { Router } from "express";

import { authenticate } from "../middleware/auth.js";
import { requireRoles } from "../middleware/roles.js";
import { resetOrganizationAdminPassword } from "../services/organization.service.js";

export const superAdminRouter = Router();

superAdminRouter.use(authenticate, requireRoles("SUPER_ADMIN"));

superAdminRouter.post("/org/:organizationId/reset-admin-password", async (req, res, next) => {
  try {
    const reset = await resetOrganizationAdminPassword(req.auth!.userId, req.params.organizationId, req.body);
    res.json(reset);
  } catch (error) {
    next(error);
  }
});
