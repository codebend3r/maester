#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_PROJECT_REF:?Set the linked production project ref}"
: "${RAVEN_AUTH_SITE_URL:?Set the HTTPS raven origin}"
: "${SUPABASE_AUTH_SMTP_HOST:?Set the SMTP host}"
: "${SUPABASE_AUTH_SMTP_USER:?Set the SMTP username}"
: "${SUPABASE_AUTH_SMTP_PASS:?Set the SMTP password}"
: "${SUPABASE_AUTH_SMTP_FROM:?Set the sender email}"

if [[ ! "$SUPABASE_PROJECT_REF" =~ ^[a-z]{20}$ ]]; then
  echo 'Invalid production project ref' >&2
  exit 1
fi
if [[ ! "$RAVEN_AUTH_SITE_URL" =~ ^https://[a-zA-Z0-9.-]+(:[0-9]+)?$ ]]; then
  echo 'Use an HTTPS origin without a trailing slash' >&2
  exit 1
fi
if [ "$(<.temp/project-ref)" != "$SUPABASE_PROJECT_REF" ]; then
  echo 'The linked project does not match SUPABASE_PROJECT_REF' >&2
  exit 1
fi
# The CLI validates remote refs before expanding env(), so render a temporary
# workdir instead of committing either a placeholder remote or production secrets.
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/supabase"
cp -R templates "$tmp/supabase/templates"
awk '!/^signing_keys_path =/ { gsub("http://localhost:5173", ENVIRON["RAVEN_AUTH_SITE_URL"]); print }' config.toml > "$tmp/supabase/config.toml"
printf '\n[auth.email.smtp]\nenabled = true\nhost = "env(SUPABASE_AUTH_SMTP_HOST)"\nport = 587\nuser = "env(SUPABASE_AUTH_SMTP_USER)"\npass = "env(SUPABASE_AUTH_SMTP_PASS)"\nadmin_email = "env(SUPABASE_AUTH_SMTP_FROM)"\nsender_name = "raven"\n' >> "$tmp/supabase/config.toml"
case "${1:-}" in
  diff|push) supabase config "$1" --project-ref "$SUPABASE_PROJECT_REF" --workdir "$tmp" ;;
  *) echo 'Expected diff or push' >&2; exit 1 ;;
esac
