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

## Later PR stack

| Branch | Scope | Cutover dependency |
|---|---|---|
| `raven-auth-ui` | Login, signup, confirmation, recovery, pending and Settings > Users | Test the complete owner approval flow in staging |
| `raven-auth-desktop` | Main-owned session, login, pending, secure storage and playback tickets | Release before enforcement |
| `raven-auth-enforcement` | Account gate across every protected API/media path, owner-only management, remove admin-password authorization, bind PIN state to accounts | Configure production and verify anonymous access is denied |
| `raven-account-data` | Per-account progress, plays, watched and favourites with owner adoption | Follow-up; viewing data is shared until this ships |

Rebase and retarget each child after its parent merges. Preserve the security boundary: only the enforcement PR changes existing library access, but every newly introduced account, management and account-ticket route is protected from its first merge.
