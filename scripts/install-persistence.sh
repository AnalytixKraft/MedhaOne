#!/usr/bin/env bash
#
# Install the MedhaOne always-on LaunchAgents:
#   com.medhaone.cloudflared  — KeepAlive Cloudflare tunnel (erp.analytixkraft.com)
#   com.medhaone.stack        — KeepAlive supervisor that brings up + watches the app
#
# Both auto-start at login and auto-restart on crash. Re-run this script any time
# to (re)install/reload. Uninstall with: scripts/uninstall-persistence.sh
#
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LA_DIR="$HOME/Library/LaunchAgents"
RUN_DIR="$ROOT_DIR/.run"
LOG_DIR="$RUN_DIR/logs"

CLOUDFLARED_BIN="$(command -v cloudflared || true)"
[[ -n "$CLOUDFLARED_BIN" ]] || { echo "cloudflared not found on PATH" >&2; exit 1; }
TUNNEL_NAME="${CLOUDFLARE_TUNNEL_NAME:-medhaone-erp}"
TUNNEL_CONFIG="${CLOUDFLARE_TUNNEL_CONFIG:-$HOME/.cloudflared/config.yml}"
[[ -f "$TUNNEL_CONFIG" ]] || { echo "Missing tunnel config: $TUNNEL_CONFIG" >&2; exit 1; }

mkdir -p "$LA_DIR" "$LOG_DIR"

CF_PLIST="$LA_DIR/com.medhaone.cloudflared.plist"
STACK_PLIST="$LA_DIR/com.medhaone.stack.plist"

echo "[install] writing $CF_PLIST"
cat > "$CF_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.medhaone.cloudflared</string>
  <key>ProgramArguments</key>
  <array>
    <string>$CLOUDFLARED_BIN</string>
    <string>tunnel</string>
    <string>--config</string><string>$TUNNEL_CONFIG</string>
    <string>--protocol</string><string>http2</string>
    <string>run</string><string>$TUNNEL_NAME</string>
  </array>
  <key>EnvironmentVariables</key><dict><key>GODEBUG</key><string>netdns=go</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$HOME/.cloudflared/medhaone-erp.out.log</string>
  <key>StandardErrorPath</key><string>$HOME/.cloudflared/medhaone-erp.err.log</string>
</dict>
</plist>
PLIST

echo "[install] writing $STACK_PLIST"
cat > "$STACK_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.medhaone.stack</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$ROOT_DIR/scripts/medhaone-supervise.sh</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>$LOG_DIR/launchd-stack.out.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/launchd-stack.err.log</string>
</dict>
</plist>
PLIST

# Hand the tunnel over from any nohup cloudflared (started by stack:up) to the agent.
if [[ -f "$RUN_DIR/pids/cloudflared.pid" ]]; then
  echo "[install] stopping in-stack cloudflared (pid $(cat "$RUN_DIR/pids/cloudflared.pid"))"
  kill "$(cat "$RUN_DIR/pids/cloudflared.pid")" 2>/dev/null || true
  rm -f "$RUN_DIR/pids/cloudflared.pid"
fi

# (Re)load both agents.
for plist in "$CF_PLIST" "$STACK_PLIST"; do
  launchctl unload "$plist" 2>/dev/null || true
  launchctl load -w "$plist"
  echo "[install] loaded $(basename "$plist")"
done

echo "[install] done. Status:"
launchctl list | grep -E 'com\.medhaone\.' || true
echo "[install] To stop everything: scripts/uninstall-persistence.sh"
