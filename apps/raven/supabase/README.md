# raven authentication database

Supabase Auth and membership approval, owned by raven. This project holds the database; raven's server enforces it. Once raven runs with accounts `ready` (see `apps/raven/README.md`, "Accounts"), every protected route needs an approved account and management is the owner's. rookery and luwin keep their current sign-in.

## Local development

Install Docker, start its daemon, then run from the repo root:

```sh
bun install
bunx nx run @raven/supabase:db:start
bunx nx run @raven/supabase:test:db
bunx nx run @raven/supabase:lint:db
```

The pinned CLI starts only Postgres, Auth, PostgREST, Kong and Mailpit. API: `http://127.0.0.1:54321`; Mailpit: `http://127.0.0.1:54324`. Email callbacks use raven at `http://localhost:5173/auth/confirm`, which raven's web app handles (see `apps/raven/README.md`).

`db:keys` creates a gitignored ES256 key once with private file permissions; restart preserves it. `db:status` prints local connection settings, including secrets: never paste its output into a PR. `db:reset` destroys and reseeds the local database; `db:stop` stops this project's containers.

| Email                  | Access          | Password         |
| ---------------------- | --------------- | ---------------- |
| `owner@maester.test`   | Approved owner  | `RavenLocal123!` |
| `friend@maester.test`  | Approved member | `RavenLocal123!` |
| `waiting@maester.test` | Pending         | `RavenLocal123!` |
| `removed@maester.test` | Revoked         | `RavenLocal123!` |

All seeded accounts are verified. Use a fresh signup to test confirmation delivery in Mailpit. Never deploy `seed.sql` or these credentials to production.

## Authorization contract

- Confirmed users receive a `public.members` row with `pending` status. Confirmation and email changes never approve or restore access.
- Authenticated users can read their own membership, but cannot write memberships or read the private owner table.
- `current_membership()` returns zero or one row: `id`, `email`, `status`, `is_owner`. It uses the current caller, not a supplied account id.
- `list_members(page_size, page_offset)` and `set_member_status(member_id, member_status)` require the approved configured owner. Lists are capped at 100 rows per call. Status writes accept only `approved` or `revoked`; the owner cannot change their own access through this RPC.
- Ownership is a UUID in `private.owner`, never an email match, user metadata, a stale JWT role or whichever person signs up first.
- Call RPCs with the publishable key and the user's access JWT. No runtime service-role key is needed. Check current membership on protected requests: deleting refresh sessions alone does not invalidate existing JWTs.

## Production deployment, operator only

A PR never creates a paid project, sends production email or changes the running server. Do these steps deliberately when ready to deploy.

1. Create the Supabase project and choose the same Postgres major version as `config.toml`. Enable an asymmetric ES256 signing key in the Auth dashboard; the runtime will not accept legacy HS256 tokens. Cloud signing keys never come from the local development key file.
2. Configure your SMTP provider and sender SPF, DKIM and DMARC records. The script uses port 587. Enable leaked-password protection in the Auth dashboard if available on the selected plan; it is not a local CLI configuration field.
3. Authenticate the pinned CLI and link it to the intended project, from the repo root:

   ```sh
   bunx nx run @raven/supabase:db:login
   bunx nx run @raven/supabase:db:link -- --project-ref YOUR_PROJECT_REF
   ```

4. Export `SUPABASE_PROJECT_REF`, `RAVEN_AUTH_SITE_URL` (the HTTPS raven origin, no trailing slash), `SUPABASE_AUTH_SMTP_HOST`, `SUPABASE_AUTH_SMTP_USER`, `SUPABASE_AUTH_SMTP_PASS` and `SUPABASE_AUTH_SMTP_FROM` in your operator shell. Keep saved secrets under `apps/raven/`, never in a root `.env` or a committed file. Supply the database password securely when the CLI requests it.
5. Run `bunx nx run @raven/supabase:deploy`. It validates the linked ref and displays a configuration diff before applying database migrations, then prompts before pushing auth configuration. Check that the diff names the production raven origin, not localhost. Database push does not include the seed. The config script renders from the local config in a temporary workdir, replacing the origin, omitting the local signing key path and adding SMTP via environment references. It leaves the checked-in local config untouched.
6. Check the Auth dashboard and real email delivery. Email templates use the configured `SiteURL` plus `/auth/confirm`, not a client-supplied redirect. The handler will call `verifyOtp` with the hash and the email type and immediately strip it from the URL. Recovery and email changes have their own token types. Never log hashes.
7. Sign up and confirm your owner account. Sign up through raven's own `/sign-up` page (or the Supabase Auth signup API) and confirm the email. Find that account's UUID in Auth, then run the following as the database operator in the SQL editor, replacing the UUID:

   ```sql
   begin;
   update public.members set status = 'approved', updated_at = now()
   where id = 'YOUR_VERIFIED_USER_UUID';
   insert into private.owner (account_id)
   values ('YOUR_VERIFIED_USER_UUID');
   commit;
   ```

   The foreign key refuses an unverified or nonexistent member; the singleton refuses a second owner. Do not turn this into a public bootstrap endpoint. Check `current_membership()` using your user session before proceeding.

8. Run security/performance advisors and verify that the publishable key alone cannot read memberships or call the RPCs. Keep configuration changes in code; dashboard-only settings are the signing key, leaked-password protection and this explicit owner bootstrap.

Ownership transfer is an operator-only transaction: approve the verified replacement account, update the singleton owner UUID and verify the new owner's access. Never expose that transaction through a member-management screen.

## Cutover to enforced accounts, operator only

Setting the three Supabase variables on raven turns enforcement on for everyone who reaches it, so do this once, in order, and not before the steps above are done.

1. Push migrations, then the auth config, to the cloud project (the production deployment above). Confirm the asymmetric ES256 signing key is active, leaked-password protection is on and the rate limits are set.
2. Configure the SMTP provider and the sender DNS (SPF, DKIM, DMARC). Send a real signup and a real recovery email, and open each link in another browser.
3. Set `site_url` and the redirect allowlist to raven's real web origins: the Netlify site and the Funnel address.
4. Bootstrap the owner (step 7 above): sign up, verify, set the private owner UUID and approve the owner.
5. Release the compatible raven player (`raven-auth-desktop` merged and tagged) and tell its users that older builds lose access to an enforcing server.
6. Back up `/volume1/docker/raven/data` (SQLite, settings and the admin secret), for a rollback.
7. Stage the whole flow: a staging raven with accounts `ready` behind a Netlify deploy preview. Verify Netlify forwards `Cookie`, `Authorization` and server-sent events unbuffered, and caches no `/api` response.
8. Set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and `RAVEN_WEB_URL` in Vhagar's `.env`, and review `RAVEN_MEDIA_ORIGINS` and `RAVEN_WEB_ORIGINS`. `ADMIN_PASSWORD` becomes inert; keep it only for the rollback. Deploy (the `deploy-raven-vhagar` skill). The first `ready` start records that this server enforces accounts.
9. From outside the tailnet, check: anonymous API, media and artwork requests fail (`401`), `/api/health` answers, the owner approves a second account, that account plays but cannot manage (`PUT /api/settings/display` gives `403`), and removing it blocks its original JWT and its ticket on the next request, and ends an open playback within a minute.
10. Before inviting anyone, tell them that progress, plays, watched marks and favourites are still shared. Per-account data is a later change.

A server that has run `ready` stays closed if its Supabase settings go missing: it answers `503` everywhere but `/api/health`, `/api/auth/config` and `/api/media-origins/ping`. Rolling back is `RAVEN_ACCOUNTS=off` with the Supabase variables removed, which reopens anonymous access and brings the admin password and the browser PIN back. It is an explicit security decision, not an automatic fallback, and raven logs a warning on every start while it is set.

## CI and rollout

The `Supabase` PR job starts the Docker stack, runs the pgTAP authorization tests and database lint, then stops it even on failure. General `verify`, `affected` and git hooks do not start Docker or deploy anything.

Stacked on this project: raven's server (`raven-auth-server`), web (`raven-auth-ui`) and player (`raven-auth-desktop`), then enforcement (`raven-auth-enforcement`). Per-account progress and favourites are the follow-up (`raven-account-data`).
