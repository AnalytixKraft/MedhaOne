import { randomUUID } from "crypto";
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
  adminEmail: z.string().email(),
  adminPassword: z.string().min(12),
  adminFullName: z.string().min(2),
});

export async function listOrganizations() {
  return prisma.organization.findMany({
    where: { isActive: true },
    orderBy: { createdAt: "desc" },
  });
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

      await createOrganizationSchema(client, schemaName, {
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
    return prisma.organization.findUniqueOrThrow({ where: { id: input.id } });
  });
}

export async function updateOrganizationMaxUsers(actorId: string, organizationId: string, maxUsers: number) {
  const organization = await prisma.organization.update({
    where: { id: organizationId },
    data: { maxUsers },
  });

  await writeGlobalAuditLog({
    actorType: "SUPER_ADMIN",
    actorId,
    action: "ORGANIZATION_MAX_USERS_UPDATED",
    organizationId,
    targetType: "ORGANIZATION",
    targetId: organizationId,
    metadata: { maxUsers },
  });

  return organization;
}

export async function getOrganizationOrThrow(organizationId: string) {
  return prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
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
      if (!organization.is_active) {
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
