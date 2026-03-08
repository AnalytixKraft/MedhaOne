#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$ROOT_DIR/.run"
PID_DIR="$RUN_DIR/pids"
LOG_DIR="$RUN_DIR/logs"

mkdir -p "$PID_DIR" "$LOG_DIR"

log() {
  printf '[stack:up] %s\n' "$*"
}

fail() {
  printf '[stack:up] %s\n' "$*" >&2
  exit 1
}

require_command() {
  local command_name="$1"
  command -v "$command_name" >/dev/null 2>&1 || fail "Missing required command: $command_name"
}

stop_stale_listeners() {
  local name="$1"
  local port="$2"
  local pids=()

  while IFS= read -r pid; do
    [[ -n "$pid" ]] && pids+=("$pid")
  done < <(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)

  if (( ${#pids[@]} == 0 )); then
    return 0
  fi

  log "Stopping stale $name listener(s) on port $port (${pids[*]})"
  kill "${pids[@]}" 2>/dev/null || true

  local attempts=10
  local try_count=0
  while (( try_count < attempts )); do
    if ! lsof -nP -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      return 0
    fi
    try_count=$((try_count + 1))
    sleep 1
  done

  while IFS= read -r pid; do
    [[ -n "$pid" ]] && kill -9 "$pid" 2>/dev/null || true
  done < <(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
}

load_env() {
  if [[ -f "$ROOT_DIR/.env" ]]; then
    set -a
    # shellcheck disable=SC1091
    . "$ROOT_DIR/.env"
    set +a
  fi
}

pid_is_running() {
  local pid_file="$1"
  if [[ ! -f "$pid_file" ]]; then
    return 1
  fi

  local pid
  pid="$(<"$pid_file")"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

start_bg() {
  local name="$1"
  local pid_file="$2"
  local log_file="$3"
  shift 3

  if pid_is_running "$pid_file"; then
    log "$name already running (pid $(<"$pid_file"))"
    return 0
  fi

  rm -f "$pid_file"
  : >"$log_file"

  nohup "$@" >>"$log_file" 2>&1 &
  local pid=$!
  echo "$pid" >"$pid_file"

  sleep 1
  if ! kill -0 "$pid" 2>/dev/null; then
    tail -n 40 "$log_file" >&2 || true
    fail "Failed to start $name"
  fi

  log "Started $name (pid $pid)"
}

wait_for_url() {
  local name="$1"
  local url="$2"
  local success_codes="${3:-200}"
  local attempts="${4:-30}"
  local log_file="${5:-}"

  local code=""
  local try_count=0
  while (( try_count < attempts )); do
    code="$(curl -s -o /dev/null -w '%{http_code}' "$url" || true)"
    if [[ " $success_codes " == *" $code "* ]]; then
      log "$name ready at $url ($code)"
      return 0
    fi
    try_count=$((try_count + 1))
    sleep 1
  done

  if [[ -n "$log_file" && -f "$log_file" ]]; then
    printf '[stack:up] %s failed readiness check. Last log lines:\n' "$name" >&2
    tail -n 80 "$log_file" >&2 || true
  fi

  fail "$name did not become ready at $url"
}

wait_for_rbac_postgres() {
  local container_id="$1"
  local attempts=30
  local try_count=0

  while (( try_count < attempts )); do
    local status
    status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || true)"
    if [[ "$status" == "healthy" || "$status" == "running" ]]; then
      log "RBAC PostgreSQL container ready ($status)"
      return 0
    fi
    try_count=$((try_count + 1))
    sleep 1
  done

  fail "RBAC PostgreSQL container did not become ready"
}

wait_for_tunnel() {
  local tunnel_name="$1"
  local attempts=30
  local try_count=0

  while (( try_count < attempts )); do
    if ! cloudflared tunnel info "$tunnel_name" 2>/dev/null | grep -q 'does not have any active connection'; then
      log "Cloudflare tunnel connected ($tunnel_name)"
      return 0
    fi
    try_count=$((try_count + 1))
    sleep 1
  done

  fail "Cloudflare tunnel did not establish an active connection"
}

ensure_docker() {
  if docker info >/dev/null 2>&1; then
    return 0
  fi

  if [[ "$OSTYPE" == darwin* ]]; then
    log "Starting Docker Desktop"
    open -a Docker >/dev/null 2>&1 || true
  fi

  local attempts=60
  local try_count=0
  while (( try_count < attempts )); do
    if docker info >/dev/null 2>&1; then
      return 0
    fi
    try_count=$((try_count + 1))
    sleep 2
  done

  fail "Docker is not available"
}

load_env

require_command pnpm
require_command docker
require_command curl
require_command cloudflared
require_command grep
require_command lsof

PNPM_CMD=(pnpm --config.engine-strict=false)

WEB_URL="${NEXT_PUBLIC_APP_URL:-http://localhost:1729}"
API_URL="${NEXT_PUBLIC_API_BASE_URL:-http://localhost:1730}"
RBAC_URL="http://localhost:${RBAC_PORT:-1740}"
CLOUDFLARE_TUNNEL_NAME="${CLOUDFLARE_TUNNEL_NAME:-medhaone-erp}"
CLOUDFLARE_TUNNEL_CONFIG="${CLOUDFLARE_TUNNEL_CONFIG:-$HOME/.cloudflared/config.yml}"

[[ -f "$CLOUDFLARE_TUNNEL_CONFIG" ]] || fail "Missing Cloudflare tunnel config: $CLOUDFLARE_TUNNEL_CONFIG"

ensure_docker

log "Starting RBAC PostgreSQL"
(cd "$ROOT_DIR" && "${PNPM_CMD[@]}" rbac:db:up >/dev/null)

RBAC_CONTAINER_ID="$(cd "$ROOT_DIR" && docker compose ps -q rbac-postgres)"
[[ -n "$RBAC_CONTAINER_ID" ]] || fail "Unable to resolve rbac-postgres container id"
wait_for_rbac_postgres "$RBAC_CONTAINER_ID"

RBAC_DB_HOST="${RBAC_POSTGRES_HOST:-127.0.0.1}"
RBAC_DB_PORT="${RBAC_POSTGRES_PORT:-55432}"
RBAC_DB_NAME="${RBAC_POSTGRES_DB:-medhaone_rbac}"
RBAC_DB_USER="${RBAC_POSTGRES_USER:-postgres}"
RBAC_DB_PASSWORD="${RBAC_POSTGRES_PASSWORD:-postgres}"
RBAC_DATABASE_URL="postgresql://${RBAC_DB_USER}:${RBAC_DB_PASSWORD}@${RBAC_DB_HOST}:${RBAC_DB_PORT}/${RBAC_DB_NAME}?schema=public"
ERP_DATABASE_URL="postgresql+psycopg://${RBAC_DB_USER}:${RBAC_DB_PASSWORD}@127.0.0.1:${RBAC_POSTGRES_PORT:-55432}/${RBAC_DB_NAME}"

log "Running ERP migrations against shared PostgreSQL"
(cd "$ROOT_DIR/apps/api" && env "DATABASE_URL=$ERP_DATABASE_URL" "${PNPM_CMD[@]}" migrate >/dev/null)

stop_stale_listeners "web" "1729"
stop_stale_listeners "api" "1730"
rm -f "$PID_DIR/dev.pid"

start_bg \
  "api" \
  "$PID_DIR/api.pid" \
  "$LOG_DIR/api.log" \
  env \
  "DATABASE_URL=$ERP_DATABASE_URL" \
  "${PNPM_CMD[@]}" \
  --dir \
  "$ROOT_DIR" \
  --filter \
  api \
  dev

wait_for_url "API" "$API_URL/health" "200" "30" "$LOG_DIR/api.log"

start_bg \
  "web" \
  "$PID_DIR/web.pid" \
  "$LOG_DIR/web.log" \
  env \
  "${PNPM_CMD[@]}" \
  --dir \
  "$ROOT_DIR" \
  --filter \
  web \
  dev

wait_for_url "Web" "$WEB_URL" "200 307" "30" "$LOG_DIR/web.log"

stop_stale_listeners "rbac-api" "${RBAC_PORT:-1740}"

start_bg \
  "rbac-api" \
  "$PID_DIR/rbac-api.pid" \
  "$LOG_DIR/rbac-api.log" \
  env \
  "RBAC_DATABASE_URL=$RBAC_DATABASE_URL" \
  "${PNPM_CMD[@]}" \
  --dir \
  "$ROOT_DIR" \
  rbac:dev

wait_for_url "RBAC API" "$RBAC_URL/health" "200"

start_bg \
  "cloudflared" \
  "$PID_DIR/cloudflared.pid" \
  "$LOG_DIR/cloudflared.log" \
  env \
  GODEBUG=netdns=go \
  cloudflared \
  tunnel \
  --config \
  "$CLOUDFLARE_TUNNEL_CONFIG" \
  --protocol \
  http2 \
  run \
  "$CLOUDFLARE_TUNNEL_NAME"

wait_for_tunnel "$CLOUDFLARE_TUNNEL_NAME"

log "Stack is running"
log "Web: $WEB_URL"
log "API: $API_URL"
log "RBAC API: $RBAC_URL"
log "Tunnel: $CLOUDFLARE_TUNNEL_NAME"
