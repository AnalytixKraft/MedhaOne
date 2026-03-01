import { quoteIdentifier } from "../utils/schema.js";

export function buildCreateTenantSchemaSql(schemaName: string) {
  const schema = quoteIdentifier(schemaName);
  return `
    CREATE SCHEMA IF NOT EXISTS ${schema};

    CREATE TABLE IF NOT EXISTS ${schema}.users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('ORG_ADMIN', 'SERVICE_SUPPORT', 'VIEW_ONLY', 'READ_WRITE')),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      last_login_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS ${schemaName}_users_role_idx ON ${schema}.users(role);
    CREATE INDEX IF NOT EXISTS ${schemaName}_users_active_idx ON ${schema}.users(is_active);

    CREATE TABLE IF NOT EXISTS ${schema}.audit_logs (
      id TEXT PRIMARY KEY,
      actor_user_id TEXT,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT,
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS ${schemaName}_audit_logs_created_idx
      ON ${schema}.audit_logs(created_at DESC);
  `;
}
