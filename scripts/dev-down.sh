#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$ROOT_DIR/.run"
PID_DIR="$RUN_DIR/pids"

log() {
  printf '[stack:down] %s\n' "$*"
}

stop_stale_listeners() {
  local name="$1"
  local port="$2"
  local pids=()

  if ! command -v lsof >/dev/null 2>&1; then
    return 0
  fi

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

stop_pid_file() {
  local name="$1"
  local pid_file="$2"

  if [[ ! -f "$pid_file" ]]; then
    log "$name not running (no pid file)"
    return 0
  fi

  local pid
  pid="$(<"$pid_file")"
  rm -f "$pid_file"

  if [[ -z "$pid" ]] || ! kill -0 "$pid" 2>/dev/null; then
    log "$name already stopped"
    return 0
  fi

  kill "$pid" 2>/dev/null || true

  local attempts=10
  local try_count=0
  while (( try_count < attempts )); do
    if ! kill -0 "$pid" 2>/dev/null; then
      log "Stopped $name"
      return 0
    fi
    try_count=$((try_count + 1))
    sleep 1
  done

  kill -9 "$pid" 2>/dev/null || true
  log "Force-stopped $name"
}

stop_pid_file "cloudflared" "$PID_DIR/cloudflared.pid"
stop_pid_file "rbac-api" "$PID_DIR/rbac-api.pid"
stop_pid_file "api" "$PID_DIR/api.pid"
stop_pid_file "web" "$PID_DIR/web.pid"
stop_pid_file "web+api" "$PID_DIR/dev.pid"
stop_stale_listeners "web" "1729"
stop_stale_listeners "api" "1730"
stop_stale_listeners "rbac-api" "1740"

if command -v pnpm >/dev/null 2>&1; then
  log "Stopping RBAC PostgreSQL"
  (cd "$ROOT_DIR" && pnpm --config.engine-strict=false rbac:db:down >/dev/null) || true
fi

log "Stack is stopped"
