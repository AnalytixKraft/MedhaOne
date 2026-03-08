import { randomUUID } from "crypto";
import type { PoolClient } from "pg";
import { z } from "zod";

import { withPgClient } from "../lib/db.js";
import { AppError } from "../lib/errors.js";
import { quoteIdentifier } from "../utils/schema.js";
import { writeGlobalAuditLog } from "./audit.service.js";
import { createOrganizationSchema } from "./org-schema.service.js";
import { hashPassword } from "../utils/password.js";
import { buildOrgSchemaName } from "../utils/schema.js";
import { prisma } from "../lib/prisma.js";

export const createOrganizationSchemaInput = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  name: z.string().min(2),
  maxUsers: z.number().int().min(1),
  adminEmail: z.string().email().transform((value) => value.trim().toLowerCase()),
  adminPassword: z.string().min(12),
  adminFullName: z.string().min(2),
});

export const updateOrganizationInput = z.object({
  name: z.string().min(2),
  maxUsers: z.number().int().min(1),
  isActive: z.boolean(),
});

export const resetOrganizationAdminPasswordInput = z.object({
  password: z.string().min(12),
});

export async function listOrganizations() {
  const organizations = await prisma.organization.findMany({
    where: {
      NOT: {
        schemaName: {
          startsWith: "del_",
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return Promise.all(
    organizations.map(async (organization) => {
      const usage = await getOrganizationUsage(organization.schemaName);
      return {
        ...organization,
        ...usage,
      };
    }),
  );
}

export async function createOrganization(actorId: string, rawInput: unknown) {
  const input = createOrganizationSchemaInput.parse(rawInput);
  const schemaName = buildOrgSchemaName(input.id);

  return withPgClient(async (client) => {
    await client.query("BEGIN");
    try {
      const passwordHash = await hashPassword(input.adminPassword);
      const existingResult = await client.query<{
        id: string;
        is_active: boolean;
      }>(
        `SELECT id, is_active
         FROM public.organizations
         WHERE id = $1
         FOR UPDATE`,
        [input.id],
      );
      const existing = existingResult.rows[0];

      if (existing?.is_active) {
        throw new AppError(409, "ORGANIZATION_EXISTS", "Organization already exists");
      }

      if (existing) {
        await client.query(
          `UPDATE public.organizations
           SET name = $1,
               schema_name = $2,
               max_users = $3,
               is_active = TRUE,
               created_by_id = $4,
               updated_at = NOW()
           WHERE id = $5`,
          [input.name, schemaName, input.maxUsers, actorId, input.id],
        );
      } else {
        await client.query(
          `INSERT INTO public.organizations (id, name, schema_name, max_users, created_by_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [input.id, input.name, schemaName, input.maxUsers, actorId],
        );
      }

      await createOrganizationSchema(client, schemaName, input.name, {
        email: input.adminEmail,
        passwordHash,
        fullName: input.adminFullName,
      });

      await client.query(
        `INSERT INTO public.global_audit_logs
          (id, actor_type, actor_id, action, organization_id, target_type, target_id, metadata)
         VALUES ($1, 'SUPER_ADMIN', $2, 'ORGANIZATION_CREATED', $3, 'ORGANIZATION', $3, $4::jsonb)`,
        [
          randomUUID(),
          actorId,
          input.id,
          JSON.stringify({
            schemaName,
            maxUsers: input.maxUsers,
            adminEmail: input.adminEmail,
            recreated: Boolean(existing),
          }),
        ],
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }).then(async () => {
    const organization = await prisma.organization.findUniqueOrThrow({ where: { id: input.id } });
    const usage = await getOrganizationUsage(organization.schemaName);
    return {
      ...organization,
      ...usage,
    };
  });
}

export async function updateOrganizationMaxUsers(actorId: string, organizationId: string, maxUsers: number) {
  const organization = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
  return updateOrganization(actorId, organizationId, {
    name: organization.name,
    maxUsers,
    isActive: organization.isActive,
  });
}

export async function getOrganizationOrThrow(organizationId: string) {
  return prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
}

export async function updateOrganization(actorId: string, organizationId: string, rawInput: unknown) {
  const input = updateOrganizationInput.parse(rawInput);

  return withPgClient(async (client) => {
    await client.query("BEGIN");
    try {
      const result = await client.query<{
        id: string;
        name: string;
        schema_name: string;
        is_active: boolean;
        max_users: number;
      }>(
        `SELECT id, name, schema_name, is_active, max_users
         FROM public.organizations
         WHERE id = $1
         FOR UPDATE`,
        [organizationId],
      );

      const organization = result.rows[0];
      if (!organization) {
        throw new AppError(404, "ORGANIZATION_NOT_FOUND", "Organization not found");
      }
      if (organization.schema_name.startsWith("del_")) {
        throw new AppError(409, "ORGANIZATION_ARCHIVED", "Archived organizations cannot be edited");
      }

      const usage = await getOrganizationUsageWithClient(client, organization.schema_name);
      if (input.maxUsers < usage.currentUsers) {
        throw new AppError(
          409,
          "INVALID_MAX_USERS",
          "Max users must be greater than or equal to current users",
          { currentUsers: usage.currentUsers },
        );
      }

      await client.query(
        `UPDATE public.organizations
         SET name = $1,
             max_users = $2,
             is_active = $3,
             updated_at = NOW()
         WHERE id = $4`,
        [input.name, input.maxUsers, input.isActive, organizationId],
      );

      await client.query(
        `INSERT INTO public.global_audit_logs
          (id, actor_type, actor_id, action, organization_id, target_type, target_id, metadata)
         VALUES ($1, 'SUPER_ADMIN', $2, 'ORGANIZATION_UPDATED', $3, 'ORGANIZATION', $3, $4::jsonb)`,
        [
          randomUUID(),
          actorId,
          organizationId,
          JSON.stringify({
            previousName: organization.name,
            nextName: input.name,
            previousMaxUsers: organization.max_users,
            nextMaxUsers: input.maxUsers,
            previousIsActive: organization.is_active,
            nextIsActive: input.isActive,
          }),
        ],
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }).then(async () => {
    const organization = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    const usage = await getOrganizationUsage(organization.schemaName);
    return {
      ...organization,
      ...usage,
    };
  });
}

export async function resetOrganizationAdminPassword(
  actorId: string,
  organizationId: string,
  rawInput: unknown,
) {
  const input = resetOrganizationAdminPasswordInput.parse(rawInput);
  const passwordHash = await hashPassword(input.password);

  return withPgClient(async (client) => {
    await client.query("BEGIN");
    try {
      const orgResult = await client.query<{
        id: string;
        name: string;
        schema_name: string;
      }>(
        `SELECT id, name, schema_name
         FROM public.organizations
         WHERE id = $1
         FOR UPDATE`,
        [organizationId],
      );

      const organization = orgResult.rows[0];
      if (!organization) {
        throw new AppError(404, "ORGANIZATION_NOT_FOUND", "Organization not found");
      }
      if (!organization.schema_name.startsWith("org_")) {
        throw new AppError(409, "ORGANIZATION_ARCHIVED", "Archived organizations cannot be updated");
      }

      await client.query(`SET LOCAL search_path TO ${quoteIdentifier(organization.schema_name)}, public`);
      const adminResult = await client.query<{
        id: string;
        email: string;
        full_name: string;
      }>(
        `SELECT id, email, full_name
         FROM users
         WHERE role = 'ORG_ADMIN'
         ORDER BY created_at ASC
         LIMIT 1`,
      );

      const admin = adminResult.rows[0];
      if (!admin) {
        throw new AppError(404, "ORG_ADMIN_NOT_FOUND", "Organization admin not found");
      }

      await client.query(
        `UPDATE users
         SET password_hash = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [passwordHash, admin.id],
      );
      await client.query(
        `INSERT INTO audit_logs (id, actor_user_id, action, target_type, target_id, metadata)
         VALUES ($1, NULL, 'ORG_ADMIN_PASSWORD_RESET', 'USER', $2, $3::jsonb)`,
        [
          randomUUID(),
          admin.id,
          JSON.stringify({
            actorId,
            adminEmail: admin.email,
          }),
        ],
      );
      await client.query(
        `INSERT INTO public.global_audit_logs
          (id, actor_type, actor_id, action, organization_id, target_type, target_id, metadata)
         VALUES ($1, 'SUPER_ADMIN', $2, 'ORG_ADMIN_PASSWORD_RESET', $3, 'USER', $4, $5::jsonb)`,
        [
          randomUUID(),
          actorId,
          organization.id,
          admin.id,
          JSON.stringify({
            adminEmail: admin.email,
            adminFullName: admin.full_name,
          }),
        ],
      );

      await client.query("COMMIT");
      return {
        organizationId: organization.id,
        adminEmail: admin.email,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}

export async function listOrganizationAuditLogs(organizationId?: string) {
  const logs = await prisma.globalAuditLog.findMany({
    where: organizationId ? { organizationId } : undefined,
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return logs.map((log) => ({
    id: log.id,
    timestamp: log.createdAt.toISOString(),
    action: log.action,
    performedBy: log.actorId,
    targetOrg: log.organizationId ?? "Platform",
    role: log.actorType,
    ipAddress: "system",
    details: JSON.stringify(log.metadata ?? {}),
  }));
}

export async function deleteOrganization(actorId: string, organizationId: string) {
  const archivedSchemaName = `del_${organizationId}`;

  return withPgClient(async (client) => {
    await client.query("BEGIN");
    try {
      const result = await client.query<{
        id: string;
        name: string;
        schema_name: string;
        is_active: boolean;
      }>(
        `SELECT id, name, schema_name, is_active
         FROM public.organizations
         WHERE id = $1
         FOR UPDATE`,
        [organizationId],
      );

      const organization = result.rows[0];
      if (!organization) {
        throw new Error("Organization not found");
      }
      if (organization.schema_name.startsWith("del_")) {
        throw new Error("Organization already deleted");
      }

      await client.query(
        `ALTER SCHEMA ${quoteIdentifier(organization.schema_name)}
         RENAME TO ${quoteIdentifier(archivedSchemaName)}`,
      );

      await client.query(
        `UPDATE public.organizations
         SET is_active = FALSE,
             schema_name = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [archivedSchemaName, organization.id],
      );

      await client.query(
        `INSERT INTO public.global_audit_logs
          (id, actor_type, actor_id, action, organization_id, target_type, target_id, metadata)
         VALUES ($1, 'SUPER_ADMIN', $2, 'ORGANIZATION_DELETED', $3, 'ORGANIZATION', $3, $4::jsonb)`,
        [
          randomUUID(),
          actorId,
          organization.id,
          JSON.stringify({
            previousSchemaName: organization.schema_name,
            archivedSchemaName,
          }),
        ],
      );

      await client.query("COMMIT");
      return {
        id: organization.id,
        name: organization.name,
        schemaName: archivedSchemaName,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}

async function getOrganizationUsage(schemaName: string) {
  return withPgClient(async (client) => {
    await client.query("BEGIN");
    try {
      const usage = await getOrganizationUsageWithClient(client, schemaName);
      await client.query("COMMIT");
      return usage;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}

async function getOrganizationUsageWithClient(client: PoolClient, schemaName: string) {
  if (!schemaName.startsWith("org_")) {
    return {
      currentUsers: 0,
      activeUsers: 0,
      adminCount: 0,
      supportCount: 0,
    };
  }

  await client.query(`SET LOCAL search_path TO ${quoteIdentifier(schemaName)}, public`);
  const userColumnsResult = await client.query<{ column_name: string }>(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = 'users'`,
    [schemaName],
  );
  const userColumns = new Set(userColumnsResult.rows.map((row) => row.column_name));
  if (!userColumns.has("id")) {
    return {
      currentUsers: 0,
      activeUsers: 0,
      adminCount: 0,
      supportCount: 0,
    };
  }

  const tableResult = await client.query<{ table_name: string }>(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = $1
       AND table_name IN ('roles', 'user_roles')`,
    [schemaName],
  );
  const tables = new Set(tableResult.rows.map((row) => row.table_name));
  const hasRoleColumn = userColumns.has("role");
  const hasRoleIdColumn = userColumns.has("role_id");
  const hasRolesTable = tables.has("roles");
  const hasUserRolesTable = tables.has("user_roles");

  const activeExpression = userColumns.has("is_active") ? "u.is_active = TRUE" : "TRUE";
  let adminPredicate = "FALSE";
  let supportPredicate = "FALSE";

  if (hasRoleColumn) {
    adminPredicate = "u.role = 'ORG_ADMIN'";
    supportPredicate = "u.role = 'SERVICE_SUPPORT'";
  } else if (hasRoleIdColumn && hasRolesTable) {
    const primaryAdmin = "EXISTS (SELECT 1 FROM roles r WHERE r.id = u.role_id AND r.name = 'ORG_ADMIN')";
    const primarySupport = "EXISTS (SELECT 1 FROM roles r WHERE r.id = u.role_id AND r.name = 'SERVICE_SUPPORT')";
    const linkedAdmin = hasUserRolesTable
      ? "EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id AND r.name = 'ORG_ADMIN')"
      : "FALSE";
    const linkedSupport = hasUserRolesTable
      ? "EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id AND r.name = 'SERVICE_SUPPORT')"
      : "FALSE";
    adminPredicate = `(${primaryAdmin} OR ${linkedAdmin})`;
    supportPredicate = `(${primarySupport} OR ${linkedSupport})`;
  }

  const result = await client.query<{
    current_users: string;
    active_users: string;
    admin_count: string;
    support_count: string;
  }>(
    `SELECT
       COUNT(*)::text AS current_users,
       COUNT(*) FILTER (WHERE ${activeExpression})::text AS active_users,
       COUNT(*) FILTER (WHERE ${adminPredicate})::text AS admin_count,
       COUNT(*) FILTER (WHERE ${supportPredicate})::text AS support_count
     FROM users u`,
  );

  const row = result.rows[0];
  return {
    currentUsers: Number(row?.current_users ?? "0"),
    activeUsers: Number(row?.active_users ?? "0"),
    adminCount: Number(row?.admin_count ?? "0"),
    supportCount: Number(row?.support_count ?? "0"),
  };
}
