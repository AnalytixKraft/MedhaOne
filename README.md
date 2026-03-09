# MedhaOne ERP

Multi-tenant ERP monorepo for AnalytixKraft / MedhaOne.

This repository now includes working foundations and module flows for:
- auth + tenant isolation
- RBAC + super-admin control plane
- masters and master settings
- inventory ledger and stock operations
- purchase orders, GRN, and purchase bills
- sales order reservation + dispatch
- operational, masters, and data-quality reports
- audit trail and record history

## Stack

- Web: Next.js 16, React 19, TypeScript, Tailwind
- ERP API: FastAPI, SQLAlchemy, Alembic, PostgreSQL
- RBAC API: Express, Prisma, PostgreSQL
- Package manager: pnpm

## Current Architecture

- Tenant ERP data lives in PostgreSQL schemas named `org_<slug>`.
- The inventory ledger is immutable. Stock movement is always insert-only through service flows.
- `StockSummary` is maintained from ledger activity and used for availability, reporting, and validations.
- Purchase, stock correction, stock adjustment, sales reservation, and GRN flows are implemented as business workflows on top of that ledger.

## Major Modules

### Masters

- Party Master
  - GST-aware party creation
  - bulk create
  - grid entry
  - commercial and compliance fields
- Products
  - inline edit
  - pagination
  - brand-controlled creation
- Warehouses
  - bulk select and delete/deactivate logic
  - stock-aware delete protection
- Master Settings
  - GST slabs
  - Brands
  - Party Categories
  - placeholder tab for TDS / TCS

### Inventory

- Opening stock
- Stock correction
  - metadata reclassification only
  - paired immutable ledger entries
- Stock adjustment
  - quantity correction only
- stock availability and reporting

### Purchase

- Purchase Order workflow
  - list
  - create draft
  - edit draft
  - approve
  - cancel
  - detail view with activity
- GRN workflow
  - multiple GRNs against one PO
  - multiple items per GRN
  - multiple batch rows per item
  - PO-first receiving
  - bill linking later
- Purchase Bill
  - invoice upload
  - AI extraction to draft only
  - review / verify / post flow
  - no stock movement on bill posting

### Sales

- Sales Orders
  - draft and confirm
  - stock reservation on confirmation
- Dispatch Notes
  - FEFO-aware dispatch suggestions
  - physical stock reduction only at dispatch post

### Reports

- Operational reports
  - Current Stock
  - Stock Movement
  - Expiry
  - Dead Stock
  - Stock Ageing
  - Stock Inward
  - Purchase Register
  - Purchase Credit Notes
  - Stock Source Traceability
- Masters reports
  - Warehouse, Item, and Party report groups
- Data Quality reports
  - kept separate from business-facing masters reports

### Audit

- Audit Trail screen
- record-level history support
- business events only

## Repository Structure

```text
.
├── apps
│   ├── api
│   │   ├── alembic
│   │   ├── app
│   │   ├── alembic.ini
│   │   └── pyproject.toml
│   ├── rbac-api
│   │   ├── prisma
│   │   ├── src
│   │   └── package.json
│   └── web
│       ├── app
│       ├── components
│       ├── e2e
│       ├── lib
│       └── package.json
├── packages
├── scripts
├── docker-compose.yml
├── package.json
└── pnpm-workspace.yaml
```

## Ports

- Web: `http://localhost:1729`
- ERP API: `http://localhost:1730`
- RBAC API: `http://localhost:1740`
- PostgreSQL: `127.0.0.1:55432`

## Prerequisites

- Node.js `24.14.0`
- pnpm `10+`
- Python `3.10+`
- Docker Desktop
- Cloudflared

## Environment Setup

```bash
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
```

The local dev stack uses PostgreSQL. The default shared local DB path is:

```env
postgresql+psycopg://postgres:postgres@127.0.0.1:55432/medhaone_rbac
```

## Install

### Workspace

```bash
pnpm install
```

### ERP API

```bash
cd apps/api
python -m venv .venv
source .venv/bin/activate
pip install -e .
```

## Recommended Local Startup

Use the stack script from repo root:

```bash
pnpm stack:up
```

This will:
- start PostgreSQL in Docker
- run ERP migrations against the shared PostgreSQL instance
- start the ERP API
- start the Next.js web app

Related commands:

```bash
pnpm stack:down
pnpm stack:restart
```

## Alternate Local Startup

If you only want web + ERP API without the full stack helper:

```bash
pnpm dev
```

If you need RBAC API separately:

```bash
pnpm rbac:dev
```

## Database and Migrations

ERP API:

```bash
cd apps/api
source .venv/bin/activate
python -m alembic upgrade head
```

RBAC API:

```bash
pnpm rbac:prisma:generate
pnpm rbac:prisma:migrate
```

## Useful Commands

```bash
pnpm lint
pnpm format
pnpm build
pnpm seed
pnpm e2e
pnpm e2e:ui
pnpm e2e:debug
pnpm ai:test
```

Backend quality:

```bash
cd apps/api
source .venv/bin/activate
black .
ruff check .
pytest
```

RBAC typecheck:

```bash
pnpm rbac:build
```

## E2E and AI Testing

Playwright tests live under `apps/web/e2e`.

Common flows covered include:
- navigation
- masters
- purchase order tax and workflow
- stock adjustment
- settings
- reports
- sales flow

AI workflow runner:

```bash
pnpm ai:test
```

Guided/manual workflow runner:

```bash
pnpm guided:test
pnpm guided:test:po-grn
```

Some local test helpers require:

```env
ENABLE_TEST_ENDPOINTS=true
```

## Key Business Rules Implemented

### Inventory

- Ledger is immutable.
- Stock correction is metadata reclassification, not quantity adjustment.
- Stock adjustment is quantity correction.

### Purchase

- PO tax is calculated from supplier GST state vs company GST state.
- GST is shown and rolled up per line.
- GRN posting creates stock inward.
- Purchase Bill posting does not create stock movement.

### Sales

- Sales Order confirmation reserves stock.
- Physical stock is reduced only on dispatch post.
- `available_qty = on_hand_qty - reserved_qty`

### Traceability

- inward stock provenance stores supplier, PO, bill, and GRN chain
- stock source traceability report answers who supplied current stock

## Current App Areas

Main ERP app includes:
- Dashboard
- Masters
- Inventory
- Purchase
- Sales
- Reports
- Settings

Super-admin / RBAC app includes:
- organizations
- platform reports
- audit logs
- support

## Repo Hygiene

Generated files should not be committed.

Ignored examples now include:
- `.next`
- `.next_*`
- `dist`
- `backups`
- Playwright reports and guided artifacts
- logs, temp files, and build outputs

If old generated files were already committed, they must be removed from the Git index separately from `.gitignore`.

## Notes

- TDS / TCS UI is planned but not implemented yet.
- Accounting, payments, receivables, and journals are intentionally out of scope at this stage.
- Purchase Bill, GRN, and Sales flows are built to support future deeper reconciliation and finance modules.
