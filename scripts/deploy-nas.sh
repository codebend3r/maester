#!/usr/bin/env bash
# Push this repo to the Synology NAS over a mounted SMB share. Safe to re-run.
#
# Deliberately EXCLUDED so live NAS state is never clobbered:
#   .env            the NAS has its own (service URLs as the NAS sees them)
#   maester-data/   the bot's SQLite file
#
# Prereq: mount the share first: Finder > Cmd+K > smb://192.168.50.2 > "docker".
# Override the destination with:  NAS_MOUNT=/Volumes/docker/maester scripts/deploy-nas.sh
set -euo pipefail

DEST="${NAS_MOUNT:-/Volumes/docker/maester}"
MOUNT_ROOT="$(dirname "$DEST")"

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
  --exclude '.env' \
  --exclude 'maester-data' \
  "$(cd "$(dirname "$0")/.." && pwd)/" \
  "$DEST/"

echo "✓ Code synced. On the NAS, apply it with:"
echo "    ssh crivas@192.168.50.2 'cd /volume1/docker/maester && sudo -n /usr/local/bin/docker compose up -d --build'"
