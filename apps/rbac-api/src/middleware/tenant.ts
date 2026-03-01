import type { NextFunction, Request, Response } from "express";

import { buildOrgSchemaName } from "../utils/schema.js";

export function requireTenantContext(req: Request, res: Response, next: NextFunction) {
  if (!req.auth?.organizationId) {
    return res.status(400).json({ message: "Organization context required" });
  }

  const derivedSchema = buildOrgSchemaName(req.auth.organizationId);
  if (req.auth.schemaName && req.auth.schemaName !== derivedSchema) {
    return res.status(403).json({ message: "Invalid tenant context" });
  }

  req.tenantSchema = derivedSchema;
  return next();
}
