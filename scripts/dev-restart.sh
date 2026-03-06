#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

printf '[stack:restart] Restarting stack\n'
bash "$ROOT_DIR/scripts/dev-down.sh"
bash "$ROOT_DIR/scripts/dev-up.sh"
printf '[stack:restart] Stack restart complete\n'
