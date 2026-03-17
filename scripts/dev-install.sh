#!/usr/bin/env bash
# dev-install.sh — Install the local toolkit into a running Beige instance.
#
# Beige will symlink this directory so edits take effect on the next gateway
# restart — no publish/reinstall loop needed during development.
#
# Usage:
#   bash scripts/dev-install.sh
#   bash scripts/dev-install.sh --beige-cmd "pnpm run beige"   # custom beige command

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOLKIT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

BEIGE_CMD="${BEIGE_CMD:-beige}"

# Allow overriding the beige command via --beige-cmd flag.
while [[ $# -gt 0 ]]; do
  case "$1" in
    --beige-cmd)
      BEIGE_CMD="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

echo "[dev-install] Installing toolkit from: $TOOLKIT_ROOT"
echo "[dev-install] Using beige command: $BEIGE_CMD"

$BEIGE_CMD install "$TOOLKIT_ROOT"

echo "[dev-install] Done. Restart the gateway to pick up changes:"
echo "  $BEIGE_CMD gateway restart"
