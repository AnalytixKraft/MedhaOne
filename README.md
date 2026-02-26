# MedhaOne - Phase 1 Foundation

Production-oriented monorepo foundation for **AnalytixKraft / MedhaOne**.

Phase 1 scope implemented:
- Frontend shell (Next.js + Tailwind + shadcn-style components)
- Backend auth core (FastAPI + SQLAlchemy + Alembic)
- Inventory core schema + ledger engine (with stock summary maintenance)
- Masters CRUD for Parties, Products, Warehouses
- Deployment-agnostic architecture (local/LAN/cloud-ready by env)

## Tech Stack

- Frontend: Next.js (App Router), React, TypeScript, Tailwind CSS, shadcn/ui style primitives
- Backend: FastAPI, SQLAlchemy 2.x, Alembic, JWT auth
- DB: SQLite by default, PostgreSQL-ready via `DATABASE_URL`
- Monorepo: pnpm workspace

## Repository Structure

```text
.
├── apps
│   ├── api
│   │   ├── alembic
│   │   ├── app
│   │   ├── alembic.ini
│   │   ├── package.json
│   │   └── pyproject.toml
│   └── web
│       ├── app
│       ├── components
│       ├── lib
│       ├── middleware.ts
│       └── package.json
├── packages
│   └── shared
├── .env.example
├── docker-compose.yml
├── package.json
└── pnpm-workspace.yaml
```

## Prerequisites

- Node.js 20+
- pnpm 10+
- Python 3.10+

## Environment Setup

1. Copy env files:

```bash
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
```

2. Optional PostgreSQL switch (instead of SQLite):

```env
DATABASE_URL=postgresql+psycopg://user:password@localhost:5432/medhaone
```

## Install Dependencies

### Frontend/Workspace

```bash
pnpm install
```

### Backend

```bash
cd apps/api
python -m venv .venv
source .venv/bin/activate
pip install -e .
```

## Run Database Migration + Seed Admin

```bash
cd apps/api
source .venv/bin/activate
python -m alembic upgrade head
python -m app.seed
```

## Start Both Apps (Single Command)

From repository root:

```bash
pnpm dev
```

This starts:
- Web: `http://localhost:1729`
- API: `http://localhost:1730`

## Default Admin Credentials (Seed Example)

- Email: `admin@medhaone.app`
- Password: `ChangeMe123!`

Set production-safe values via:
- `DEFAULT_ADMIN_EMAIL`
- `DEFAULT_ADMIN_PASSWORD`

## Implemented Endpoints

- `GET /health`
- `POST /auth/login`
- `GET /auth/me`
- `GET /dashboard/metrics`
- `POST /inventory/in`
- `POST /inventory/out`
- `POST /inventory/adjust`
- `GET|POST /masters/parties`
- `GET|PUT|DELETE /masters/parties/{id}`
- `GET|POST /masters/products`
- `GET|PUT|DELETE /masters/products/{id}`
- `GET|POST /masters/warehouses`
- `GET|PUT|DELETE /masters/warehouses/{id}`

## Inventory Notes

- `InventoryLedger` is immutable (insert-only via service layer).
- `StockSummary` is updated atomically with each ledger entry.
- Negative stock is blocked for `OUT` and negative `ADJUST`.

## Run Tests

```bash
pnpm --filter api test
```

## Frontend Auth Flow

- Login form posts to Next API route: `POST /api/auth/login`
- Next API route proxies to FastAPI `/auth/login`
- JWT stored as `httpOnly` cookie (`medhaone_token`)
- Protected pages guarded by `middleware.ts`
- Dashboard loads authenticated profile via `/api/auth/me` -> backend `/auth/me`

## Code Quality Tooling

### Frontend

```bash
pnpm --filter web lint
pnpm --filter web format
```

### Backend

```bash
cd apps/api
source .venv/bin/activate
black .
ruff check .
```

## Docker (Scaffold)

```bash
docker compose up --build
```

This scaffold is provided for deployment-ready direction; local dev remains `pnpm dev` + Python venv.

## Notes

- Purchase/Sales order workflows are intentionally not implemented yet.
- Foundation is modular and ready for Phase 1 module expansion.
