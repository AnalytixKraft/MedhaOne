import { randomUUID } from "crypto";
import { prisma } from "../lib/prisma.js";
export async function writeGlobalAuditLog(input) {
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
export async function writeOrgAuditLog(client, action, targetType, actorUserId, targetId, metadata) {
    await client.query(`INSERT INTO audit_logs (id, actor_user_id, action, target_type, target_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`, [randomUUID(), actorUserId ?? null, action, targetType, targetId ?? null, JSON.stringify(metadata ?? {})]);
}
