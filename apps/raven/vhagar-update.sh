#!/usr/bin/env bash
# Deploys raven's newest image on Vhagar. It lives beside the compose file in
# /volume1/docker/raven as update.sh, and DSM's Task Scheduler runs it as root
# every five minutes.
#
# The main smoke test publishes ghcr.io/codebend3r/raven:latest on every merge
# that changes raven's image. This pulls it, and when the pulled image is not
# the one raven runs on, stops raven, copies the index aside, and starts the
# new image, which may migrate the index. Most runs pull nothing and exit.
#
#   bash /volume1/docker/raven/update.sh    # by hand, as root
#
# What it did goes to update.log beside it.
set -euo pipefail

cd "$(dirname "$0")"
DOCKER=/usr/local/bin/docker
SERVICE=raven
KEEP_BACKUPS=5

# A slow pull must not overlap the next run.
exec 9>/tmp/raven-update.lock
flock -n 9 || exit 0

# Keep the log short: a day of failed pulls would otherwise pile up.
if [ -f update.log ]; then
  tail -n 500 update.log > update.log.tmp && mv update.log.tmp update.log
fi
exec >> update.log 2>&1
log() { echo "$(date '+%F %T') $*"; }
trap 'log "✗ update failed on line $LINENO"' ERR

image="$("$DOCKER" compose config --images "$SERVICE")"
"$DOCKER" compose pull --quiet "$SERVICE"
pulled="$("$DOCKER" image inspect --format '{{.Id}}' "$image")"
container="$("$DOCKER" compose ps --all --quiet "$SERVICE")"
running=""
if [ -n "$container" ]; then
  running="$("$DOCKER" inspect --format '{{.Image}}' "$container")"
fi
if [ "$pulled" = "$running" ]; then
  exit 0
fi

log "→ $image is ${pulled:7:12}; $SERVICE runs ${running:7:12}"

# Stopped first, so the database and its write-ahead log copy as one.
"$DOCKER" compose stop "$SERVICE"
backup="backups/$(date '+%Y%m%d-%H%M%S')"
mkdir -p "$backup"
cp -p data/raven.db* "$backup/" 2>/dev/null || log "  no index to copy yet"
"$DOCKER" compose up -d "$SERVICE"
log "✓ $SERVICE runs ${pulled:7:12}; the index from before is in $backup"

# The oldest copies go, and so does the image raven ran on before, unless
# something else still uses it. Every build stays on GHCR under its commit.
find backups -mindepth 1 -maxdepth 1 -type d | sort | head -n "-$KEEP_BACKUPS" | xargs -r rm -rf
if [ -n "$running" ]; then
  "$DOCKER" image rm "$running" > /dev/null 2>&1 || true
fi
