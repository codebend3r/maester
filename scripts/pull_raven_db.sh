#!/usr/bin/env bash
# Replaces the local raven database (apps/raven/server/data/raven.db) with a
# consistent copy of production's on Vhagar, rewrites its stored media paths to
# the NAS shares mounted on this Mac, and refreshes posters and thumbnails.
# The old database moves to data/backups/. Run it with the local server
# stopped: a running one holds the file open and would write over the swap.
set -euo pipefail

host="${RAVEN_PROD_HOST:-vhagar}"
remote_dir="${RAVEN_PROD_DIR:-/volume1/docker/raven}"
data_dir="$(cd "$(dirname "$0")/.." && pwd)/apps/raven/server/data"
port="${PORT:-8484}"

if curl -fs -m 2 "http://localhost:${port}/api/health" >/dev/null 2>&1; then
  echo "🛑 A raven server is answering on :${port}. Stop it (and bun run dev:raven) first." >&2
  exit 1
fi

stamp="$(date +%Y%m%d-%H%M%S)"
copy="${data_dir}/raven-prod-${stamp}.db"
mkdir -p "${data_dir}/backups/${stamp}"
trap 'rm -f "${copy}" "${copy}-wal" "${copy}-shm"' EXIT

echo "📡 Copying production's database from ${host}..."
ssh "${host}" "cd ${remote_dir} && rm -f raven-copy.db && sqlite3 data/raven.db '.backup raven-copy.db'"
ssh "${host}" "cat ${remote_dir}/raven-copy.db && rm -f ${remote_dir}/raven-copy.db" >"${copy}"

echo "🔧 Rewriting media paths to /Volumes..."
rewrite() {
  local nas="$1" share="$2"
  sqlite3 "${copy}" "
    UPDATE media SET path = replace(path, '/media/${nas}/', '/Volumes/${share}/') WHERE path LIKE '/media/${nas}/%';
    UPDATE media SET probe_error = replace(probe_error, '/media/${nas}/', '/Volumes/${share}/') WHERE probe_error LIKE '%/media/${nas}/%';
    UPDATE library_paths SET path = replace(path, '/media/${nas}/', '/Volumes/${share}/') WHERE path LIKE '/media/${nas}/%';
  "
}
rewrite vhagar Vhagar
rewrite caraxes Caraxes
rewrite meleys Meleys
rewrite syrax Syrax
rewrite vermithor Vermithor

echo "🔄 Swapping it in (old one kept in data/backups/${stamp})... 💾"
for file in raven.db raven.db-wal raven.db-shm; do
  [ -e "${data_dir}/${file}" ] && mv "${data_dir}/${file}" "${data_dir}/backups/${stamp}/${file}"
done
sqlite3 "${copy}" "PRAGMA wal_checkpoint(TRUNCATE);" >/dev/null
mv "${copy}" "${data_dir}/raven.db"

echo "🖼️  Syncing posters and thumbnails... ⏳"
# tar, not rsync: Vhagar answers rsync's own login with a password prompt.
ssh "${host}" "cd ${remote_dir}/data && tar cf - images thumbnails" | tar xf - -C "${data_dir}"

echo "✅ Done! 🎉 Start the server with bun run dev:raven. 🐦‍⬛"
