#!/usr/bin/env bash
# Push this repo to the Synology NAS over a mounted SMB share, then print the
# command that rebuilds a product there. Safe to re-run.
#
#   scripts/deploy-nas.sh             # luwin
#   scripts/deploy-nas.sh <product>   # any folder under apps/ with a docker-compose.yml
#
# The whole repo is synced because each product's image builds from the repo
# root. Deliberately EXCLUDED so live NAS state is never clobbered, at any depth:
#   .env            each product's own (service URLs as the NAS sees them)
#   luwin-data/   luwin's SQLite file
#   data/           raven's index and thumbnail cache
#
# Prereq: mount the share first: Finder > Cmd+K > smb://192.168.50.2 > "docker".
# Override the destination with:  NAS_MOUNT=/Volumes/docker/maester scripts/deploy-nas.sh
set -euo pipefail

PRODUCT="${1:-luwin}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${NAS_MOUNT:-/Volumes/docker/maester}"
MOUNT_ROOT="$(dirname "$DEST")"

if [ ! -f "$REPO/apps/$PRODUCT/docker-compose.yml" ]; then
  echo "✗ apps/$PRODUCT/docker-compose.yml not found; nothing to deploy for '$PRODUCT'."
  exit 1
fi

if [ ! -d "$MOUNT_ROOT" ]; then
  echo "✗ $MOUNT_ROOT is not mounted."
  echo "  In Finder press Cmd+K, connect to smb://192.168.50.2, and mount the 'docker' share."
  exit 1
fi

echo "→ Deploying code to $DEST"
rsync -av \
  --exclude '.git' \
  --exclude '.venv' \
  --exclude '.pytest_cache' \
  --exclude '.ruff_cache' \
  --exclude '__pycache__' \
  --exclude 'node_modules' \
  --exclude 'dist' \
  --exclude '.nx' \
  --exclude '.env' \
  --exclude 'luwin-data' \
  --exclude 'data' \
  "$REPO/" \
  "$DEST/"

echo "✓ Code synced. On the NAS, apply it with:"
echo "    ssh crivas@192.168.50.2 'cd /volume1/docker/maester/apps/$PRODUCT && sudo -n /usr/local/bin/docker compose up -d --build'"
