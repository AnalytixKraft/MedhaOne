# MedhaOne — Skills & Operations Runbook

Practical, copy-paste reference for running and working on MedhaOne ERP locally.
The headline skill is **"start all"** — one script brings up the database, runs
migrations, starts all three services, and opens the public Cloudflare tunnel.

> Source of truth for ports/URLs is `.env` + `scripts/dev-up.sh` (not the README,
> which lists older ports). Values below match what actually runs.

---

## TL;DR

```bash
pnpm stack:up        # start everything (DB → migrations → api/web/rbac → cloudflare tunnel)
pnpm stack:down      # stop everything (services, tunnel, and Docker Postgres)
pnpm stack:restart   # down, then up
```

Once up:

| Surface | URL |
|---|---|
| Web (local) | http://localhost:1729 |
| Web (public, via tunnel) | https://erp.analytixkraft.com |
| ERP API | http://localhost:1730 (health: `/health`) |
| RBAC API | http://localhost:1740 (health: `/health`) |
| RBAC PostgreSQL (Docker) | `127.0.0.1:55432` → db `medhaone_rbac` |

---

## Start all (`pnpm stack:up`)

Runs `scripts/dev-up.sh`. It is **idempotent** — safe to re-run; it reuses
healthy services and replaces stale ones. In order, it:

1. Loads `.env`.
2. Verifies required commands exist: `pnpm`, `docker`, `curl`, `cloudflared`, `grep`, `lsof`.
3. Confirms the tunnel config exists at `~/.cloudflared/config.yml` (override with `CLOUDFLARE_TUNNEL_CONFIG`).
4. **Ensures Docker is running** — on macOS it runs `open -a Docker` and waits up to ~2 min.
5. Starts **RBAC PostgreSQL** (`docker compose up rbac-postgres`) and waits until healthy.
6. Runs **ERP Alembic migrations** against the shared Postgres.
7. Generates the **RBAC Prisma client** and bootstraps the RBAC `public` schema (initial + tax-rates migrations).
8. Clears stale listeners on `1729`/`1730`, then starts services as background processes:
   - **ERP API** (`api`) → waits for `http://localhost:1730/health` = 200
   - **Web** (`web`) → waits for `http://localhost:1729` = 200/307
   - **RBAC API** (`rbac-api`) → waits for `http://localhost:1740/health` = 200
9. Starts **cloudflared** (`tunnel run medhaone-erp`, http2) and waits for an active connection.

Each background service writes a PID to `.run/pids/<name>.pid` and logs to
`.run/logs/<name>.log`. The script blocks until every readiness check passes,
then prints the running URLs.

### What "the server" exposes publicly

`cloudflared` runs the named tunnel **`medhaone-erp`** using
`~/.cloudflared/config.yml`, which routes:

```
erp.analytixkraft.com  →  http://localhost:1729   (the Next.js web app)
(everything else)       →  http_status:404
```

So starting the stack publishes the local web app at
**https://erp.analytixkraft.com**. Stop the stack (or just the tunnel) to take it
offline.

---

## Stop / restart

```bash
pnpm stack:down      # scripts/dev-down.sh
```

`stack:down` stops, in order: cloudflared → rbac-api → api → web (via PID files),
kills any stale listeners on `1729`/`1730`/`1740`, and stops the Docker Postgres
container (`rbac:db:down`). PID files are removed.

```bash
pnpm stack:restart   # down, then up
```

### Stop only the public tunnel (leave local services running)

```bash
kill "$(cat .run/pids/cloudflared.pid)" && rm -f .run/pids/cloudflared.pid
```

---

## Always-on (launchd) — survive logout/reboot

Two LaunchAgents supervise the stack: auto-start at login, auto-restart on crash.

```bash
scripts/install-persistence.sh     # generate + load both agents
scripts/uninstall-persistence.sh   # unload + remove them, then stop the app stack
```

- **`com.medhaone.cloudflared`** — runs the Cloudflare tunnel under `launchd` with `KeepAlive` (auto-restarts if the process dies). Replaces the in-stack `nohup` tunnel.
- **`com.medhaone.stack`** — runs `scripts/medhaone-supervise.sh`, which brings the app up via `dev-up.sh` and re-asserts health every 60s (restarting any dead web/api/rbac).

When the tunnel is launchd-managed, `pnpm stack:up` skips its own cloudflared (it honors `MEDHAONE_TUNNEL_MANAGED=1`, which the supervisor sets).

```bash
launchctl list | grep com.medhaone              # status (pid / last-exit)
tail -f ~/.cloudflared/medhaone-erp.err.log     # tunnel log
tail -f .run/logs/launchd-stack.out.log         # app supervisor log
```

**To stop the stack** while the agents are loaded, run `scripts/uninstall-persistence.sh` (or `launchctl unload ~/Library/LaunchAgents/com.medhaone.stack.plist`) — otherwise the supervisor brings services back within ~60s.

**Caveats:**
- The public URL only works when the web app (`:1729`) is up. After a reboot the supervisor runs `dev-up.sh` (Docker → Postgres → migrations → servers, ~1–2 min), so expect a brief 502 on the tunnel until the app is ready.
- `dev-up.sh` cold-starts Docker Desktop; its one-time "privileged access" admin prompt must already be approved. Enable Docker Desktop → Settings → **Start Docker Desktop when you sign in** for clean reboots.
- LaunchAgents start at **login**, not at boot-before-login — fine for a workstation you log into.

---

## Logs & status

```bash
# Tail a service log
tail -f .run/logs/cloudflared.log     # or api.log / web.log / rbac-api.log

# Which PIDs the stack thinks are running
for f in .run/pids/*.pid; do echo "$f -> $(cat "$f")"; done

# What's actually listening
lsof -nP -iTCP:1729 -iTCP:1730 -iTCP:1740 -iTCP:55432 -sTCP:LISTEN

# Tunnel connectivity
cloudflared tunnel info medhaone-erp
```

---

## Prerequisites

- Node `24.14.0` (`.nvmrc`), pnpm `10.6.3`
- Python `3.10+` (ERP API venv at `apps/api/.venv`)
- Docker Desktop
- `cloudflared` (Homebrew) + a configured tunnel at `~/.cloudflared/config.yml`
- `lsof`, `curl`, `grep`

First-time env setup:

```bash
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local

pnpm install
cd apps/api && python -m venv .venv && source .venv/bin/activate && pip install -e .
```

---

## Alternate / partial startup

```bash
pnpm dev             # web + ERP API only (no DB bootstrap, no tunnel)
pnpm rbac:dev        # RBAC API only
docker compose up rbac-postgres -d   # database only
```

---

## Database & migrations

```bash
# ERP (Alembic) — uses DATABASE_URL from .env (Postgres on :55432)
cd apps/api && source .venv/bin/activate && python -m alembic upgrade head

# RBAC (Prisma)
pnpm rbac:prisma:generate
pnpm rbac:prisma:migrate
```

---

## Common dev / test / quality commands

```bash
# Web
pnpm lint
pnpm format
pnpm build
pnpm seed

# E2E (Playwright)
pnpm e2e
pnpm e2e:ui
pnpm e2e:debug

# Test-endpoint-driven runners (require ENABLE_TEST_ENDPOINTS=true in .env)
pnpm ai:test
pnpm guided:test
pnpm guided:test:po-grn

# Backend quality (from apps/api, venv active)
black .
ruff check .
pytest

# RBAC typecheck/build
pnpm rbac:build
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Missing required command: cloudflared` | `brew install cloudflared` |
| `Missing Cloudflare tunnel config` | Ensure `~/.cloudflared/config.yml` exists (or set `CLOUDFLARE_TUNNEL_CONFIG`) |
| `Docker is not available` | Start Docker Desktop manually, then re-run `pnpm stack:up` |
| Tunnel "does not have any active connection" | Normal before start / after stop; while up, check `.run/logs/cloudflared.log` |
| Port already in use | `stack:up`/`stack:down` auto-clear stale listeners on 1729/1730/1740; otherwise `lsof -nP -tiTCP:<port> -sTCP:LISTEN | xargs kill` |
| Stale `.run/pids/*.pid` from a previous boot | Harmless — the scripts detect dead PIDs and replace/clean them |
| Web up but public URL 404 | Confirm the tunnel routes `erp.analytixkraft.com → :1729` in `~/.cloudflared/config.yml` and the web service is healthy |

---

## Overridable env vars (used by the scripts)

| Var | Default | Purpose |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | `http://localhost:1729` | Web readiness URL |
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:1730` | ERP API readiness URL |
| `RBAC_PORT` | `1740` | RBAC API port |
| `RBAC_POSTGRES_PORT` | `55432` | Docker Postgres host port |
| `RBAC_POSTGRES_DB` | `medhaone_rbac` | Database name |
| `CLOUDFLARE_TUNNEL_NAME` | `medhaone-erp` | Named tunnel to run |
| `CLOUDFLARE_TUNNEL_CONFIG` | `~/.cloudflared/config.yml` | Tunnel ingress config |
| `ENABLE_TEST_ENDPOINTS` | `false` | Gate for `ai:test` / `guided:test` runners |
