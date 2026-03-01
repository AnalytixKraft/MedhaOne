import { z } from "zod";

import { withPgClient } from "../lib/db.js";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";
import { verifyPassword } from "../utils/password.js";
import { signToken } from "../utils/jwt.js";
import { writeGlobalAuditLog, writeOrgAuditLog } from "./audit.service.js";
import type { AppRole } from "../types/auth.js";
import { quoteIdentifier } from "../utils/schema.js";

export const loginInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  organizationId: z.string().regex(/^[a-z0-9_]+$/).optional(),
});

export async function seedSuperAdminIfMissing(email: string, passwordHash: string) {
  const existing = await prisma.superAdmin.findUnique({ where: { email } });
  if (existing) {
    return existing;
  }
  return prisma.superAdmin.create({
    data: {
      email,
      passwordHash,
      fullName: "Platform Super Admin",
    },
  });
}

export async function login(rawInput: unknown) {
  const input = loginInputSchema.parse(rawInput);

  if (!input.organizationId) {
    const admin = await prisma.superAdmin.findUnique({ where: { email: input.email } });
    if (admin) {
      if (!admin.isActive) {
        throw new Error("Invalid credentials");
      }
      const valid = await verifyPassword(input.password, admin.passwordHash);
      if (!valid) {
        throw new Error("Invalid credentials");
      }

      await prisma.superAdmin.update({
        where: { id: admin.id },
        data: { lastLoginAt: new Date() },
      });

      const token = signToken({
        userId: admin.id,
        email: admin.email,
        fullName: admin.fullName,
        role: "SUPER_ADMIN",
        sudoFlag: false,
      });

      await writeGlobalAuditLog({
        actorType: "SUPER_ADMIN",
        actorId: admin.id,
        action: "SUPER_ADMIN_LOGIN",
        targetType: "SUPER_ADMIN",
        targetId: admin.id,
      });

      return {
        token,
        user: {
          id: admin.id,
          email: admin.email,
          fullName: admin.fullName,
          role: admin.role,
        },
      };
    }

    const matches = await findTenantMatches(input.email, input.password);
    if (matches.length === 0) {
      throw new Error("Invalid credentials");
    }
    if (matches.length > 1) {
      throw new AppError(
        409,
        "ORG_SELECTION_REQUIRED",
        "Multiple organizations found for this account",
        {
          organizations: matches.map((match) => ({
            id: match.organization.id,
            name: match.organization.name,
          })),
        },
      );
    }

    return issueTenantLogin(matches[0]);
  }

  const organization = await prisma.organization.findUniqueOrThrow({ where: { id: input.organizationId } });
  const match = await findTenantMatchInOrganization(organization, input.email, input.password);
  if (!match) {
    throw new Error("Invalid credentials");
  }

  return issueTenantLogin(match);
}

export async function createSudoToken(superAdminId: string, organizationId: string) {
  const organization = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });

  return withPgClient(async (client) => {
    await client.query("BEGIN");
    try {
      await client.query(`SET LOCAL search_path TO ${organization.schemaName}, public`);
      const result = await client.query<{
        id: string;
        email: string;
        full_name: string;
      }>(
        `SELECT id, email, full_name FROM users WHERE role = 'ORG_ADMIN' AND is_active = TRUE ORDER BY created_at ASC LIMIT 1`,
      );
      const orgAdmin = result.rows[0];
      if (!orgAdmin) {
        throw new Error("No active ORG_ADMIN found for this organization");
      }
      await writeOrgAuditLog(client, "SUDO_SESSION_STARTED", "USER", orgAdmin.id, orgAdmin.id, {
        superAdminId,
      });
      await client.query("COMMIT");

      const token = signToken({
        userId: orgAdmin.id,
        email: orgAdmin.email,
        fullName: orgAdmin.full_name,
        role: "ORG_ADMIN",
        organizationId: organization.id,
        schemaName: organization.schemaName,
        sudoFlag: true,
        impersonatedBy: superAdminId,
      });

      await writeGlobalAuditLog({
        actorType: "SUPER_ADMIN",
        actorId: superAdminId,
        action: "SUDO_SESSION_STARTED",
        organizationId,
        targetType: "ORG_ADMIN",
        targetId: orgAdmin.id,
        metadata: { organizationName: organization.name },
      });

      return {
        token,
        banner: `You are impersonating ORG_ADMIN of ${organization.name}`,
        organization,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}

type TenantOrganization = {
  id: string;
  name: string;
  schemaName: string;
  isActive: boolean;
};

type TenantMatch = {
  organization: TenantOrganization;
  user: {
    id: string;
    email: string;
    full_name: string;
    role: AppRole;
  };
};

async function findTenantMatches(email: string, password: string): Promise<TenantMatch[]> {
  const organizations = await prisma.organization.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      schemaName: true,
      isActive: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const matches: TenantMatch[] = [];
  for (const organization of organizations) {
    const match = await findTenantMatchInOrganization(organization, email, password);
    if (match) {
      matches.push(match);
    }
  }
  return matches;
}

async function findTenantMatchInOrganization(
  organization: TenantOrganization,
  email: string,
  password: string,
): Promise<TenantMatch | null> {
  if (!organization.isActive) {
    return null;
  }

  return withPgClient(async (client) => {
    const result = await client.query<{
      id: string;
      email: string;
      password_hash: string;
      full_name: string;
      role: AppRole;
      is_active: boolean;
    }>(
      `SELECT id, email, password_hash, full_name, role, is_active
       FROM ${quoteIdentifier(organization.schemaName)}.users
       WHERE email = $1
       LIMIT 1`,
      [email],
    );

    const user = result.rows[0];
    if (!user || !user.is_active) {
      return null;
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      return null;
    }

    return {
      organization,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
      },
    };
  });
}

async function issueTenantLogin(match: TenantMatch) {
  return withPgClient(async (client) => {
    await client.query("BEGIN");
    try {
      await client.query(`SET LOCAL search_path TO ${match.organization.schemaName}, public`);
      await client.query(`UPDATE users SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1`, [
        match.user.id,
      ]);
      await writeOrgAuditLog(client, "ORG_USER_LOGIN", "USER", match.user.id, match.user.id);
      await client.query("COMMIT");

      const token = signToken({
        userId: match.user.id,
        email: match.user.email,
        fullName: match.user.full_name,
        role: match.user.role,
        organizationId: match.organization.id,
        schemaName: match.organization.schemaName,
        sudoFlag: false,
      });

      return {
        token,
        user: {
          id: match.user.id,
          email: match.user.email,
          fullName: match.user.full_name,
          role: match.user.role,
          organizationId: match.organization.id,
        },
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}
