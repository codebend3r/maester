#!/usr/bin/env bash
set -euo pipefail

# Keep the same local key across restarts, without ever committing it.
if [ -s signing_keys.json ]; then
  exit 0
fi
umask 077
printf '[]\n' > signing_keys.json
trap 'rm -f signing_keys.json' ERR
supabase gen signing-key --algorithm ES256 --append --workdir ..
