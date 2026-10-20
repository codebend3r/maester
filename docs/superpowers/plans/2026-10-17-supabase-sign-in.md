# raven-first Supabase implementation

Design: `docs/superpowers/specs/2026-10-17-supabase-sign-in-design.md`.

The first two PRs are explicitly requested as `supabase-foundation` targeting `main`, then `raven-auth-server` targeting `supabase-foundation`. Include this plan and the revised design in the foundation PR, not a third prerequisite PR. No cloud deployment, paid resource creation, production email or enforcement cutover is part of this work.

## PR 1: supabase-foundation

- [x] Pin the CLI and add `@raven/supabase`, with Nx tasks for keys, start/stop/reset, status, tests, lint, linking and manual deployment.
- [x] Configure confirmation, password policy, refresh rotation, recovery and host-specific email links; keep unused local services off.
- [x] Add private owner configuration, confirmed-account enrolment, membership RLS and owner-only list/status RPCs. No custom claim hook or service-role runtime key.
- [x] Seed verified owner, approved, pending and revoked accounts for local reset only.
- [x] Test enrolment, email synchronization, direct-write refusal, owner protection, malicious user metadata, paging and approval/removal with unchanged identity.
- [x] Add a dedicated Docker database CI job and a production/owner-bootstrap runbook.
- [x] Run all workspace verification before opening the foundation PR.

### Findings from the local stack

- CLI `2.121.0` works with `--workdir ..` from the Nx project. The required service set is Postgres, Auth, PostgREST, Kong and Mailpit; the rest can be excluded.
- Its npm CLI validates remote project refs before expanding `env()` in a remote block. The production script instead renders a temporary config from the local source, changes the origin, omits the local key path and adds SMTP via env references. It validates the linked ref before doing so.
- With a configured but missing key file, signing-key generation needs an initial empty key array. The key task creates that with private permissions, appends one generated ES256 key and preserves it thereafter.
- All four seeded accounts can sign in through Auth's password endpoint. Their authoritative membership states match the seed.
- A fresh signup delivers the custom template to Mailpit. Taking its token hash into an independent HTTP verification request creates a pending membership and a session. The local JWKS publishes ES256.
- The database authorization suite passes 36 assertions; database lint reports no public/private schema errors.
- Email links deliberately use the configured `SiteURL`, not caller-provided `RedirectTo`, so the first version needs no cross-origin return URL handling.

### Remaining deployment/client checks

These are not claimed as completed by the foundation PR:

- Cloud configuration push, real SMTP and sender DNS, asymmetric cloud signing-key setup, leaked-password protection and manual owner bootstrap require an operator and real project settings.
- Browser cookie refresh, Netlify forwarding/SSE and actual recovery UI are checked in the web PR before cutover.
- Desktop secure storage and long-running ticket playback are checked in the desktop PR before cutover.

## PR 2: raven-auth-server

- [x] Add raven-core constants, guards and derived contracts for auth configuration, accounts, access refusals and owner member management; API client methods consume them.
- [x] Read optional auth config from raven's product environment. Partial/invalid settings fail closed for new account endpoints, while existing routes retain their current behavior.
- [x] Verify JWTs against the configured JWKS, pin issuer/audience/algorithms and distinguish invalid identity from unavailable infrastructure. Provide injectable key and HTTP seams for tests.
- [x] Decode the fixed host-only browser cookie, including chunks and base64url sessions. Bearer takes precedence; cookies never authorize writes.
- [x] Resolve current membership using the user's JWT and `current_membership()`, without caching membership or accepting role/status claims. Validate PostgREST responses at the boundary.
- [x] Introduce a request caller seam and authenticated account endpoints. New owner-management endpoints require the authoritative approved owner regardless of the existing admin password/PIN locks.
- [x] Add account-bound ticket preparation without allowing an account ticket to turn a removed account into a legacy anonymous caller. Keep existing ticket behavior until cutover and protect new ticket issuance immediately.
- [x] Test valid/expired/wrong-algorithm JWTs, malformed cookies, missing/pending/revoked accounts, owner-only RPCs, outages, current revocation and existing-route compatibility.
- [x] Document endpoint/config behavior and explicitly state that existing library access is not yet gated.
- [x] Run affected project tests and workspace verification before opening the child PR against `supabase-foundation`.

### Server validation findings

- The real local Supabase stack works end to end with raven's default remote JWKS verifier and user-scoped RPC calls. Owner listing, member refusal, approval and removal were verified without replacing the member's JWT. The local database was reset to its seed afterward.
- New playback tickets are opaque, bounded, process-local capabilities. They retain the issuing JWT only in server memory and recheck membership at redemption. They expire at the earlier of five minutes and that JWT's expiry, so the desktop follow-up must renew sessions and reacquire tickets before later seeks/subtitle requests. Do not promise six-hour uninterrupted capability URLs before that client work is validated.
- The server's complete test suite and workspace verification pass. Existing library/admin/PIN access is retained; only the new endpoints and account-ticket redemptions enforce account authorization in this PR.

## PR 3: raven-auth-ui

Task plan: `2026-10-18-raven-auth-ui.md`, stacked on `supabase-spec-status` (#242).

- [x] Add the Supabase browser client with the host-only `maester-auth` cookie the server decodes, and a session store, access state and route guard that gate only the web app (the server still gates nothing existing).
- [x] Sign in, sign up and check email with a resend cooldown, `/auth/confirm` with `token_hash` and `verifyOtp` (hash removed from the URL first), forgot and reset password, and a pending or removed screen.
- [x] Settings > Account for everyone and Settings > Users for the owner: Pending, Approved and Removed tabs, Approve and Remove access.
- [x] Validate return paths, refresh once on a refused call, and clear account state on sign out and account switches.
- [x] Document the routes and the gating in `apps/raven/README.md`.
- [x] Walk the flow on the local stack: sign up, confirm in a second browser, Pending, owner approval, Check again, Remove access, forgot and reset.
- [ ] Not verifiable locally: Netlify forwarding and SSE, real SMTP, the cloud redirect allowlist and a second real device. The staging check below covers them.

## PR 4: raven-auth-desktop

Task plan: `2026-10-18-raven-auth-desktop.md`, PR #254 against `main` (#247 merged).

- [x] Pin each server's sign-in endpoints from its public auth config in `desktop-config.json` (version 4), and ask in main's own prompt before a changed pin is used.
- [x] Hold the session in main, one `@supabase/auth-js` client per server, encrypted with `safeStorage` or in memory alone, and add Bearer to every call to a server whose accounts are `ready`. The renderer never sees a token.
- [x] Sign-in, pending and removed screens in Settings and on the server page; Create account and Forgot password open the server's web app.
- [x] Play server titles through a loopback relay that adds account tickets and renews them, so seeks, reconnects and subtitles past five minutes keep working. Download with account tickets under a per-server mint budget.
- [x] Redact tokens, tickets, emails and relay secrets from the log. Make no admin-password call to a `ready` server.
- [x] Fixture server with accounts, e2e and native tests: many ticket lives and a session refresh, an audio switch after expiry, a sidecar fetched once, removal mid-play, a relaunch that keeps or loses the sign-in.
- [x] Off and pre-accounts servers behave as before (D1).
- [ ] Not verifiable in this PR: a packaged, ad hoc signed build's keychain behaviour after an update, the cloud project's real JWT lifetime, and a production server with enforcement on (that is `raven-auth-enforcement`).

## Later PR stack

| Branch | Scope | Cutover dependency |
|---|---|---|
| `raven-auth-ui` | Login, signup, confirmation, recovery, pending and Settings > Users. Task plan: [`2026-10-18-raven-auth-ui.md`](2026-10-18-raven-auth-ui.md) | Test the complete owner approval flow in staging |
| `raven-auth-desktop` | Main-owned session, login, pending, secure storage and playback tickets. Task plan: [`2026-10-18-raven-auth-desktop.md`](2026-10-18-raven-auth-desktop.md) | Release before enforcement |
| `raven-auth-enforcement` | Account gate across every protected API/media path, owner-only management, remove admin-password authorization, bind PIN state to accounts | Configure production and verify anonymous access is denied |
| `raven-account-data` | Per-account progress, plays, watched and favourites with owner adoption | Follow-up; viewing data is shared until this ships |

Rebase and retarget each child after its parent merges. Preserve the security boundary: only the enforcement PR changes existing library access, but every newly introduced account, management and account-ticket route is protected from its first merge.
