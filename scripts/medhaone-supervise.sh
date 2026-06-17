#!/usr/bin/env bash
#
# Long-lived supervisor for the MedhaOne app stack, run by the
# `com.medhaone.stack` LaunchAgent (KeepAlive). It brings the stack up via
# dev-up.sh at login and re-asserts health periodically so a crashed dev server
# is restarted. The Cloudflare tunnel is owned by the separate
# `com.medhaone.cloudflared` LaunchAgent, so we tell dev-up.sh to skip it.
#
# To stop the stack, unload the agent first:
#   launchctl unload ~/Library/LaunchAgents/com.medhaone.stack.plist
# (otherwise this supervisor will just bring it back within ~60s).

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# LaunchAgents start with a minimal PATH — restore Homebrew + system paths.
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

# Pin Node 24.14.0 via fnm (the repo's engine-strict requires it).
if command -v fnm >/dev/null 2>&1; then
  eval "$(fnm env)"
  fnm use 24.14.0 >/dev/null 2>&1 || true
fi

# The dedicated cloudflared LaunchAgent owns the tunnel.
export MEDHAONE_TUNNEL_MANAGED=1

WEB_URL="${NEXT_PUBLIC_APP_URL:-http://localhost:1729}"
API_URL="${NEXT_PUBLIC_API_BASE_URL:-http://localhost:1730}"
RBAC_URL="http://localhost:${RBAC_PORT:-1740}"

log() { printf '[supervise] %s %s\n' "$(date '+%H:%M:%S')" "$*"; }

# Fully stop the app dev servers (both the pnpm wrapper recorded in the pid file
# AND the actual port listener it spawned) so the following dev-up.sh restarts
# them cleanly. dev-up.sh's own start_bg trusts the wrapper pid, but a tsx/next
# wrapper can outlive a killed listener — leaving the port dead while start_bg
# skips it. Postgres/Docker are left alone (dev-up.sh re-asserts them quickly).
stop_app_servers() {
  local svc port pidf pids
  for svc in rbac-api web api; do
    pidf="$ROOT_DIR/.run/pids/$svc.pid"
    if [ -f "$pidf" ]; then
      kill "$(cat "$pidf")" 2>/dev/null || true
      rm -f "$pidf"
    fi
  done
  for port in 1729 1730 "${RBAC_PORT:-1740}"; do
    pids="$(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
    [ -n "$pids" ] && kill $pids 2>/dev/null || true
  done
  sleep 2
}

bring_up() {
  stop_app_servers
  bash "$ROOT_DIR/scripts/dev-up.sh"
}

# Initial bring-up. Retry a few times in case Docker is still waking at login.
log "starting stack"
for attempt in 1 2 3; do
  if bring_up; then
    log "stack up"
    break
  fi
  log "bring-up attempt $attempt failed; retrying in 15s"
  sleep 15
done

# Health watch: if any core service is down, bring the stack back up.
# dev-up.sh is idempotent — it only restarts what's actually dead.
while true; do
  sleep 60
  if ! curl -sf -o /dev/null "$API_URL/health" \
    || ! curl -sf -o /dev/null "$RBAC_URL/health" \
    || ! curl -s -o /dev/null "$WEB_URL"; then
    log "health check failed — re-asserting stack"
    bring_up || true
  fi
done
