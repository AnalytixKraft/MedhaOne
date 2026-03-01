import { Router } from "express";
import { z } from "zod";

import { authenticate } from "../middleware/auth.js";
import { requireRoles } from "../middleware/roles.js";
import { requireTenantContext } from "../middleware/tenant.js";
import {
  createOrgUser,
  listOrgUsers,
  setOrgUserActive,
  updateOrgUserRole,
} from "../services/user.service.js";

export const usersRouter = Router();

usersRouter.use(authenticate, requireTenantContext);

usersRouter.get("/", requireRoles("ORG_ADMIN", "SERVICE_SUPPORT"), async (req, res, next) => {
  try {
    const users = await listOrgUsers(req.tenantSchema!);
    res.json(users);
  } catch (error) {
    next(error);
  }
});

usersRouter.post("/", requireRoles("ORG_ADMIN"), async (req, res, next) => {
  try {
    const user = await createOrgUser(
      req.auth!.userId,
      req.auth!.organizationId!,
      req.tenantSchema!,
      req.body,
    );
    res.status(201).json(user);
  } catch (error) {
    next(error);
  }
});

usersRouter.patch("/:userId/role", requireRoles("ORG_ADMIN"), async (req, res, next) => {
  try {
    const { userId } = req.params as { userId: string };
    const user = await updateOrgUserRole(req.auth!.userId, req.tenantSchema!, userId, req.body);
    res.json(user);
  } catch (error) {
    next(error);
  }
});

usersRouter.patch("/:userId/status", requireRoles("ORG_ADMIN"), async (req, res, next) => {
  try {
    const body = z.object({ isActive: z.boolean() }).parse(req.body);
    const { userId } = req.params as { userId: string };
    const user = await setOrgUserActive(
      req.auth!.userId,
      req.tenantSchema!,
      userId,
      body.isActive,
    );
    res.json(user);
  } catch (error) {
    next(error);
  }
});
