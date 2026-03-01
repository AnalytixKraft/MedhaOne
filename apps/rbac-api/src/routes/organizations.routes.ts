import { Router } from "express";
import { z } from "zod";

import { authenticate } from "../middleware/auth.js";
import { requireRoles } from "../middleware/roles.js";
import {
  createOrganization,
  deleteOrganization,
  listOrganizations,
  updateOrganizationMaxUsers,
} from "../services/organization.service.js";

export const organizationsRouter = Router();

organizationsRouter.use(authenticate, requireRoles("SUPER_ADMIN"));

organizationsRouter.get("/", async (_req, res, next) => {
  try {
    res.json(await listOrganizations());
  } catch (error) {
    next(error);
  }
});

organizationsRouter.post("/", async (req, res, next) => {
  try {
    const organization = await createOrganization(req.auth!.userId, req.body);
    res.status(201).json(organization);
  } catch (error) {
    next(error);
  }
});

organizationsRouter.patch("/:organizationId/max-users", async (req, res, next) => {
  try {
    const body = z.object({ maxUsers: z.number().int().min(1) }).parse(req.body);
    const organization = await updateOrganizationMaxUsers(
      req.auth!.userId,
      req.params.organizationId,
      body.maxUsers,
    );
    res.json(organization);
  } catch (error) {
    next(error);
  }
});

organizationsRouter.delete("/:organizationId", async (req, res, next) => {
  try {
    const { organizationId } = req.params as { organizationId: string };
    const deleted = await deleteOrganization(req.auth!.userId, organizationId);
    res.json(deleted);
  } catch (error) {
    next(error);
  }
});
