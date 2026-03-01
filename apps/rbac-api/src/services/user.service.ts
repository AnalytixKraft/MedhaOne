import { randomUUID } from "crypto";
import { z } from "zod";

import { withPgClient } from "../lib/db.js";
import { writeOrgAuditLog } from "./audit.service.js";
import { hashPassword } from "../utils/password.js";

const createUserInput = z.object({
  email: z.string().email(),
  password: z.string().min(12),
  fullName: z.string().min(2),
  role: z.enum(["VIEW_ONLY", "READ_WRITE", "SERVICE_SUPPORT"]),
});

const updateRoleInput = z.object({
  role: z.enum(["VIEW_ONLY", "READ_WRITE", "SERVICE_SUPPORT"]),
});

export async function listOrgUsers(schemaName: string) {
  return withPgClient(async (client) => {
    await client.query("BEGIN");
    try {
      await client.query(`SET LOCAL search_path TO ${schemaName}, public`);
      const result = await client.query(
        `SELECT id, email, full_name AS "fullName", role, is_active AS "isActive", last_login_at AS "lastLoginAt", created_at AS "createdAt", updated_at AS "updatedAt"
         FROM users
         ORDER BY created_at DESC`,
      );
      await client.query("COMMIT");
      return result.rows;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}

export async function createOrgUser(
  actorUserId: string,
  organizationId: string,
  schemaName: string,
  rawInput: unknown,
) {
  const input = createUserInput.parse(rawInput);

  return withPgClient(async (client) => {
    await client.query("BEGIN");
    try {
      await client.query(`SET LOCAL search_path TO ${schemaName}, public`);
      await client.query("LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE");
      const orgResult = await client.query<{ max_users: number }>(
        `SELECT max_users FROM public.organizations WHERE id = $1 FOR UPDATE`,
        [organizationId],
      );
      const maxUsers = Number(orgResult.rows[0]?.max_users ?? 0);
      if (!maxUsers) {
        throw new Error("Organization not found");
      }

      const countResult = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM users WHERE is_active = TRUE`,
      );
      const currentUsers = Number(countResult.rows[0]?.count ?? "0");
      if (currentUsers >= maxUsers) {
        throw new Error(`User limit reached (${currentUsers}/${maxUsers})`);
      }

      const passwordHash = await hashPassword(input.password);
      const userId = randomUUID();
      await client.query(
        `INSERT INTO users (id, email, password_hash, full_name, role, is_active)
         VALUES ($1, $2, $3, $4, $5, TRUE)`,
        [userId, input.email, passwordHash, input.fullName, input.role],
      );

      await writeOrgAuditLog(client, "USER_CREATED", "USER", actorUserId, userId, {
        email: input.email,
        role: input.role,
      });

      const result = await client.query(
        `SELECT id, email, full_name AS "fullName", role, is_active AS "isActive", created_at AS "createdAt"
         FROM users WHERE id = $1`,
        [userId],
      );
      await client.query("COMMIT");
      return result.rows[0];
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}

export async function updateOrgUserRole(
  actorUserId: string,
  schemaName: string,
  userId: string,
  rawInput: unknown,
) {
  const input = updateRoleInput.parse(rawInput);

  return withPgClient(async (client) => {
    await client.query("BEGIN");
    try {
      await client.query(`SET LOCAL search_path TO ${schemaName}, public`);
      await client.query(`UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2`, [input.role, userId]);
      await writeOrgAuditLog(client, "USER_ROLE_CHANGED", "USER", actorUserId, userId, {
        role: input.role,
      });
      const result = await client.query(
        `SELECT id, email, full_name AS "fullName", role, is_active AS "isActive", updated_at AS "updatedAt"
         FROM users WHERE id = $1`,
        [userId],
      );
      await client.query("COMMIT");
      return result.rows[0];
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}

export async function setOrgUserActive(
  actorUserId: string,
  schemaName: string,
  userId: string,
  isActive: boolean,
) {
  return withPgClient(async (client) => {
    await client.query("BEGIN");
    try {
      await client.query(`SET LOCAL search_path TO ${schemaName}, public`);
      await client.query(`UPDATE users SET is_active = $1, updated_at = NOW() WHERE id = $2`, [isActive, userId]);
      await writeOrgAuditLog(client, isActive ? "USER_ACTIVATED" : "USER_DEACTIVATED", "USER", actorUserId, userId, {
        isActive,
      });
      const result = await client.query(
        `SELECT id, email, full_name AS "fullName", role, is_active AS "isActive", updated_at AS "updatedAt"
         FROM users WHERE id = $1`,
        [userId],
      );
      await client.query("COMMIT");
      return result.rows[0];
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}
