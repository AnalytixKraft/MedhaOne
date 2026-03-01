import type { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import type { PoolClient } from "pg";

import { prisma } from "../lib/prisma.js";

export async function writeGlobalAuditLog(input: {
  actorType: "SUPER_ADMIN" | "ORG_USER";
  actorId: string;
  action: string;
  organizationId?: string;
  targetType: string;
  targetId?: string;
  metadata?: Prisma.InputJsonValue;
}) {
  await prisma.globalAuditLog.create({
    data: {
      id: randomUUID(),
      actorType: input.actorType,
      actorId: input.actorId,
      action: input.action,
      organizationId: input.organizationId,
      targetType: input.targetType,
      targetId: input.targetId,
      metadata: input.metadata,
    },
  });
}

export async function writeOrgAuditLog(
  client: PoolClient,
  action: string,
  targetType: string,
  actorUserId?: string,
  targetId?: string,
  metadata?: Record<string, unknown>,
) {
  await client.query(
    `INSERT INTO audit_logs (id, actor_user_id, action, target_type, target_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [randomUUID(), actorUserId ?? null, action, targetType, targetId ?? null, JSON.stringify(metadata ?? {})],
  );
}
