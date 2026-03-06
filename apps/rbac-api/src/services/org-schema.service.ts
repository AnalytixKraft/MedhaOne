import { randomUUID } from "crypto";
import type { PoolClient } from "pg";

import { buildCreateTenantSchemaSql } from "../sql/tenant-schema.js";
import { seedTenantTaxRatesFromGlobalDefaults } from "./tax-rate.service.js";

export async function createOrganizationSchema(
  client: PoolClient,
  schemaName: string,
  organizationName: string,
  admin: { email: string; passwordHash: string; fullName: string },
) {
  await client.query(buildCreateTenantSchemaSql(schemaName));
  await client.query(`SET LOCAL search_path TO ${schemaName}, public`);
  await client.query(
    `INSERT INTO company_settings (id, company_name)
     VALUES (1, $1)
     ON CONFLICT (id) DO UPDATE
     SET company_name = CASE
       WHEN company_settings.company_name IS NULL OR BTRIM(company_settings.company_name) = '' THEN EXCLUDED.company_name
       ELSE company_settings.company_name
     END,
     updated_at = CASE
       WHEN company_settings.company_name IS NULL OR BTRIM(company_settings.company_name) = '' THEN NOW()
       ELSE company_settings.updated_at
     END`,
    [organizationName],
  );
  await client.query(
    `INSERT INTO users (id, email, password_hash, full_name, role, is_active)
     VALUES ($1, $2, $3, $4, 'ORG_ADMIN', TRUE)
     ON CONFLICT (email) DO NOTHING`,
    [randomUUID(), admin.email, admin.passwordHash, admin.fullName],
  );
  await seedTenantTaxRatesFromGlobalDefaults(client, schemaName);
}
