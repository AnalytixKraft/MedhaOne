#!/usr/bin/env bash
#
# Stop and remove the MedhaOne always-on LaunchAgents (tunnel + app supervisor).
# This unloads both agents; launchd stops supervising them. Running dev servers
# started by the supervisor are then left to dev-down.sh / manual cleanup.
#
set -uo pipefail

LA_DIR="$HOME/Library/LaunchAgents"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

for label in com.medhaone.stack com.medhaone.cloudflared; do
  plist="$LA_DIR/$label.plist"
  if [[ -f "$plist" ]]; then
    launchctl unload "$plist" 2>/dev/null || true
    rm -f "$plist"
    echo "[uninstall] removed $label"
  else
    echo "[uninstall] $label not installed"
  fi
done

# Tear down the app services the supervisor brought up (tunnel agent already gone).
if command -v bash >/dev/null 2>&1 && [[ -f "$ROOT_DIR/scripts/dev-down.sh" ]]; then
  echo "[uninstall] stopping app stack via dev-down.sh"
  bash "$ROOT_DIR/scripts/dev-down.sh" || true
fi

echo "[uninstall] done."
