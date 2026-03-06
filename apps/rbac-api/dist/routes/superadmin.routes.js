import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/auth.js";
import { requireRoles } from "../middleware/roles.js";
import { resetOrganizationAdminPassword } from "../services/organization.service.js";
import { createGlobalTaxRate, listGlobalTaxRates, updateGlobalTaxRate, } from "../services/tax-rate.service.js";
export const superAdminRouter = Router();
superAdminRouter.use(authenticate, requireRoles("SUPER_ADMIN"));
superAdminRouter.get("/tax-rates", async (_req, res, next) => {
    try {
        res.json(await listGlobalTaxRates());
    }
    catch (error) {
        next(error);
    }
});
superAdminRouter.post("/tax-rates", async (req, res, next) => {
    try {
        const record = await createGlobalTaxRate(req.body);
        res.status(201).json(record);
    }
    catch (error) {
        next(error);
    }
});
superAdminRouter.patch("/tax-rates/:taxRateId", async (req, res, next) => {
    try {
        const params = z.object({ taxRateId: z.coerce.number().int().min(1) }).parse(req.params);
        const record = await updateGlobalTaxRate(params.taxRateId, req.body);
        res.json(record);
    }
    catch (error) {
        next(error);
    }
});
superAdminRouter.post("/org/:organizationId/reset-admin-password", async (req, res, next) => {
    try {
        const reset = await resetOrganizationAdminPassword(req.auth.userId, req.params.organizationId, req.body);
        res.json(reset);
    }
    catch (error) {
        next(error);
    }
});
