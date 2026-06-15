# MedhaOne ERP

MedhaOne ERP is a multi-tenant ERP platform built for AnalytixKraft to manage core operational workflows across masters, inventory, purchase, sales, reporting, and audit. The system uses a modular monorepo architecture with a Next.js frontend, FastAPI ERP API, and a separate RBAC control plane, backed by PostgreSQL with tenant-specific schemas.

The inventory backbone is built on an immutable ledger with stock summary projections, supporting opening stock, stock correction, stock adjustment, source traceability, and operational reporting. On top of this foundation, the purchase module covers Purchase Orders, multi-batch GRN flows, Purchase Bills with AI-assisted draft extraction from uploaded invoices, and Purchase Credit Notes. The sales side has Sales Orders with stock reservation and dispatch-based stock reduction. Masters are significantly expanded with GST-aware Party Master, product and warehouse management, brand/category setup, and master settings. Reporting is a major strength — operational, masters, purchase analytics, and data-quality reports are all built in. Audit trail and record-level history are also core to the platform.

## Project Status

| Area | Status | Notes |
|---|---|---|
| Auth & Tenant Isolation | Done | JWT, schema-per-org isolation |
| RBAC & Super-Admin | Done | Organizations, users, roles, sudo sessions, audit logs |
| Masters | Done | Products, parties, warehouses, racks, brands, categories, bulk import |
| External Verifications | Done | GST Portal + SFDA Drug License (AI-assisted extraction) |
| Inventory | Done | Immutable ledger, opening stock, adjustments, corrections |
| Purchase | Done | PO → GRN → Bill workflow, credit notes, tax calculations |
| Purchase Analytics | Done | Cost trends, supplier metrics, PO fulfillment, seasonal patterns, lead time |
| Sales | Done | Orders, stock reservation, FEFO-aware dispatch |
| Reports (17 types) | Done | Inventory, purchase, masters, data quality |
| Audit Trail | Done | Global + org-scoped, entity history |
| User Preferences | Done | Per-user theme settings |
| E2E Tests | Done | 26 API test modules, 11 Playwright specs |
| TDS / TCS UI | Planned | Tax deduction/collection UI not yet implemented |
| Accounting / Finance | Out of scope | Payments, journals, receivables deferred to future phase |
| Barcode Scanning | Not started | — |
| Warehouse Transfers | Not started | Inter-warehouse stock transfers |

---

## Stack

- **Web**: Next.js 16, React 19, TypeScript, Tailwind CSS, shadcn/ui
- **ERP API**: FastAPI, SQLAlchemy, Alembic, PostgreSQL
- **RBAC API**: Express, Prisma, PostgreSQL
- **Package manager**: pnpm (monorepo)

---

## Architecture

- Tenant ERP data lives in PostgreSQL schemas named `org_<slug>`.
- The inventory ledger is **immutable** — stock movement is always insert-only through service flows.
- `StockSummary` is maintained from ledger activity and used for availability, reporting, and validations.
- Purchase, stock correction, stock adjustment, sales reservation, and GRN flows are implemented as business workflows on top of that ledger.
- RBAC API uses schema isolation: `public` schema for super-admins and orgs; `org_<id>` schemas for per-tenant users and audit logs.

---

## Repository Structure

```text
.
├── apps
│   ├── api                  # Python FastAPI — ERP core
│   │   ├── alembic          # DB migrations
│   │   ├── app
│   │   │   ├── models       # SQLAlchemy models (27+)
│   │   │   ├── routes       # 17 router modules
│   │   │   ├── services     # Business logic (purchase, sales, inventory, rbac…)
│   │   │   └── reports      # 17 report modules
│   │   └── tests            # 26 test modules
│   ├── rbac-api             # Node.js/Express — multi-tenant RBAC
│   │   ├── prisma
│   │   └── src
│   └── web                  # Next.js — frontend
│       ├── app              # 61 protected pages + RBAC admin pages
│       ├── components       # 69 React components
│       ├── e2e              # Playwright tests
│       └── lib              # API client, helpers, permissions
├── packages
│   └── shared               # Shared TypeScript DTOs
├── scripts
├── docker-compose.yml
└── pnpm-workspace.yaml
```

---

## Ports

| Service | URL |
|---|---|
| Web | `http://localhost:1729` |
| ERP API | `http://localhost:1730` |
| RBAC API | `http://localhost:1731` |
| PostgreSQL (RBAC) | `127.0.0.1:5432` (Docker) |

---

## Prerequisites

- Node.js `24.14.0`
- pnpm `10+`
- Python `3.10+`
- Docker Desktop

---

## Environment Setup

```bash
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
```

Default RBAC DB connection:

```env
postgresql+psycopg://postgres:postgres@127.0.0.1:5432/medhaone_rbac
```

---

## Install

```bash
# Workspace dependencies
pnpm install

# ERP API Python environment
cd apps/api
python -m venv .venv
source .venv/bin/activate
pip install -e .
```

---

## Local Dev Startup

### Recommended (full stack)

```bash
pnpm stack:up
```

This starts PostgreSQL in Docker, runs ERP migrations, and starts all dev servers.

```bash
pnpm stack:down
pnpm stack:restart
```

### Alternate (web + ERP API only)

```bash
pnpm dev
```

### RBAC API separately

```bash
pnpm rbac:dev
```

### Docker (database only)

```bash
docker compose up rbac-postgres -d
```

---

## Database & Migrations

**ERP API (Alembic):**

```bash
cd apps/api
source .venv/bin/activate
python -m alembic upgrade head
```

**RBAC API (Prisma):**

```bash
pnpm rbac:prisma:generate
pnpm rbac:prisma:migrate
```

---

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
pnpm guided:test
pnpm guided:test:po-grn
```

**Backend quality:**

```bash
cd apps/api
source .venv/bin/activate
black .
ruff check .
pytest
```

**RBAC typecheck:**

```bash
pnpm rbac:build
```

---

## Modules

### Masters

- Party Master — GST-aware, bulk create, grid entry, commercial & compliance fields
- Products — inline edit, pagination, brand-controlled creation
- Warehouses — bulk select, stock-aware delete protection
- Racks — per-warehouse rack management
- Master Settings — GST slabs, brands, party categories
- Bulk Import — CSV templates for products, parties
- Verifications — GST Portal lookup, SFDA Drug License verification (AI-assisted)

### Inventory

- Opening stock (bulk CSV import)
- Stock adjustment — quantity correction
- Stock correction — metadata reclassification (paired immutable ledger entries)
- Stock availability and reporting

### Purchase

- **Purchase Orders** — draft, edit, approve, cancel, detail view with activity
- **GRN** — multiple GRNs per PO, multiple batch rows per item, PO-first receiving
- **Purchase Bills** — invoice upload, AI extraction to draft, review/verify/post flow (no stock movement on post)
- **Purchase Credit Notes** — credit note management against bills
- **Purchase Analytics** — cost trends, supplier metrics, PO fulfillment rates, seasonal patterns, lead time analysis

### Sales

- **Sales Orders** — draft, confirm (reserves stock)
- **Dispatch Notes** — FEFO-aware suggestions, physical stock reduction on post

### Reports (17 types)

**Inventory:** Current Stock, Stock Movement, Expiry, Dead Stock, Stock Ageing, Stock Inward, Stock Source Traceability, Opening Stock

**Purchase:** Purchase Register, Purchase Credit Notes, Purchase Analytics (5 sub-reports)

**Masters:** Warehouse Report, Item Report, Party Report, Stock Verification

**Data Quality:** Compliance Gap Detection, Data Quality Checks

### Audit

- Global audit trail screen
- Record-level change history
- Business events only (not system noise)

---

## Key Business Rules

### Inventory

- Ledger is immutable — no updates or deletes.
- Stock correction = metadata reclassification only (not quantity change).
- Stock adjustment = quantity correction only.

### Purchase

- PO tax is calculated from supplier GST state vs company GST state.
- GST is shown and rolled up per line.
- GRN posting creates stock inward ledger entries.
- Purchase Bill posting does **not** create stock movement.

### Sales

- Sales Order confirmation reserves stock.
- Physical stock is reduced only on dispatch post.
- `available_qty = on_hand_qty - reserved_qty`

### Traceability

- Inward stock provenance stores supplier, PO, bill, and GRN chain.
- Stock source traceability report answers: who supplied current stock?

---

## Testing

**API (pytest):** 26 test modules covering E2E workflows, security, integrations, analytics, and data quality.

**Web (Playwright):** 11 E2E specs covering purchase workflows, sales flow, masters CRUD, verifications, stock operations, and navigation.

Test helpers (requires `ENABLE_TEST_ENDPOINTS=true` in env):

```bash
pnpm ai:test         # AI workflow runner
pnpm guided:test     # Guided/manual workflow runner
```

---

## Notes

- TDS / TCS UI is planned but not implemented.
- Accounting, payments, receivables, and journals are intentionally out of scope for this phase.
- Purchase Bill, GRN, and Sales flows are built to support future reconciliation and finance modules.
- Shared `packages/shared` currently exports minimal DTOs (`RoleDTO`, `UserDTO`) — can be expanded.
