# Multi-tenant RBAC API

This is a standalone Express + PostgreSQL service scaffold for multi-tenant RBAC.

## Architecture

- `public.super_admins`: platform operators
- `public.organizations`: tenant registry + `max_users`
- `public.global_audit_logs`: cross-tenant audit trail
- `org_<organization_id>.users`: org-local identities
- `org_<organization_id>.audit_logs`: org-local audit trail

Prisma is used for `public` schema models only.
Tenant-schema operations use `pg` transactions plus `SET LOCAL search_path` because Prisma cannot safely switch schemas dynamically per request.

## Setup

1. Start PostgreSQL from the repo:
   - `cd /Users/lijolawrance/work/analytixkraft/MedhaOne`
   - `docker compose up -d rbac-postgres`
2. Copy environment file:
   - `cp apps/rbac-api/.env.example apps/rbac-api/.env`
3. Install dependencies:
   - `pnpm install`
4. Generate Prisma client:
   - `pnpm rbac:prisma:generate`
5. Apply the public migration:
   - `cd apps/rbac-api && pnpm prisma db execute --file prisma/migrations/0001_init_public/migration.sql --schema prisma/schema.prisma`
6. Start the service:
   - `pnpm rbac:dev`

## Core Endpoints

- `POST /auth/login`
- `POST /auth/sudo/:organizationId`
- `GET /organizations`
- `POST /organizations`
- `PATCH /organizations/:organizationId/max-users`
- `GET /users`
- `POST /users`
- `PATCH /users/:userId/role`
- `PATCH /users/:userId/status`

## Security Model

- Schema names are derived only from validated organization ids (`org_<id>`)
- Clients never submit schema names
- Tenant requests require JWT org context
- User creation locks the tenant `users` table and checks `public.organizations.max_users` inside the same transaction
- Sudo sessions are signed into JWT with `sudoFlag=true` and logged in `public.global_audit_logs`

## PostgreSQL Credentials

The Postgres container reads its credentials from the repo `.env` file:

- `RBAC_POSTGRES_HOST`
- `RBAC_POSTGRES_PORT`
- `RBAC_POSTGRES_DB`
- `RBAC_POSTGRES_USER`
- `RBAC_POSTGRES_PASSWORD`

The RBAC API derives `RBAC_DATABASE_URL` from those values automatically. You only need to set a full `RBAC_DATABASE_URL` if you want to override the default connection string.
