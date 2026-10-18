# raven authentication database

Supabase Auth and membership approval, owned by raven. This is preparation only: the existing raven library is not gated by this project. rookery and luwin keep their current sign-in.

## Local development

Install Docker, start its daemon, then run from the repo root:

```sh
bun install
bunx nx run @raven/supabase:db:start
bunx nx run @raven/supabase:test:db
bunx nx run @raven/supabase:lint:db
```

The pinned CLI starts only Postgres, Auth, PostgREST, Kong and Mailpit. API: `http://127.0.0.1:54321`; Mailpit: `http://127.0.0.1:54324`. Email callbacks use raven at `http://localhost:5173/auth/confirm`. The UI for those callbacks is a later PR.

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

This PR does not create a paid project, send production email or change the running server. Do these steps deliberately when ready to deploy.

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
7. Sign up and confirm your owner account. Until the signup UI ships, use the normal Supabase Auth signup API. Find that account's UUID in Auth, then run the following as the database operator in the SQL editor, replacing the UUID:

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

## CI and rollout

The `Supabase` PR job starts the Docker stack, runs the pgTAP authorization tests and database lint, then stops it even on failure. General `verify`, `affected` and git hooks do not start Docker or deploy anything.

After this project, stack `raven-auth-server` on `supabase-foundation`. Web signup, the Users screen and desktop support follow. Authentication enforcement is a separate cutover, not part of either foundation PR. Before inviting people, communicate that progress and favourites remain shared until the later per-account migration.
