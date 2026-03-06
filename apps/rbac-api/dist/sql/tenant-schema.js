import { quoteIdentifier } from "../utils/schema.js";
export function buildCreateTenantSchemaSql(schemaName) {
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

    CREATE TABLE IF NOT EXISTS ${schema}.company_settings (
      id INTEGER PRIMARY KEY DEFAULT 1,
      company_name TEXT,
      address TEXT,
      city TEXT,
      state TEXT,
      pincode TEXT,
      gst_number TEXT,
      phone TEXT,
      email TEXT,
      logo_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT ${schemaName}_company_settings_single_row CHECK (id = 1)
    );

    CREATE TABLE IF NOT EXISTS ${schema}.tax_rates (
      id SERIAL PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      rate_percent NUMERIC(5, 2) NOT NULL CHECK (rate_percent >= 0 AND rate_percent <= 100),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS ${schemaName}_tax_rates_rate_idx ON ${schema}.tax_rates(rate_percent);
    CREATE INDEX IF NOT EXISTS ${schemaName}_tax_rates_active_idx ON ${schema}.tax_rates(is_active);
  `;
}
