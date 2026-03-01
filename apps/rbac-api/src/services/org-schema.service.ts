import { randomUUID } from "crypto";
import type { PoolClient } from "pg";

import { buildCreateTenantSchemaSql } from "../sql/tenant-schema.js";

export async function createOrganizationSchema(
  client: PoolClient,
  schemaName: string,
  admin: { email: string; passwordHash: string; fullName: string },
) {
  await client.query(buildCreateTenantSchemaSql(schemaName));
  await client.query(`SET LOCAL search_path TO ${schemaName}, public`);
  await client.query(
    `INSERT INTO users (id, email, password_hash, full_name, role, is_active)
     VALUES ($1, $2, $3, $4, 'ORG_ADMIN', TRUE)
     ON CONFLICT (email) DO NOTHING`,
    [randomUUID(), admin.email, admin.passwordHash, admin.fullName],
  );
}
