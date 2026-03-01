CREATE TABLE IF NOT EXISTS public.super_admins (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'SUPER_ADMIN',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_super_admins_email ON public.super_admins(email);

CREATE TABLE IF NOT EXISTS public.organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  schema_name TEXT NOT NULL UNIQUE,
  max_users INTEGER NOT NULL CHECK (max_users >= 1),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_id TEXT REFERENCES public.super_admins(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_organizations_is_active ON public.organizations(is_active);

CREATE TABLE IF NOT EXISTS public.global_audit_logs (
  id TEXT PRIMARY KEY,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  organization_id TEXT REFERENCES public.organizations(id),
  target_type TEXT NOT NULL,
  target_id TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_global_audit_org_created_at
  ON public.global_audit_logs(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_global_audit_action_created_at
  ON public.global_audit_logs(action, created_at DESC);
