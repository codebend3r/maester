# Supabase sign-in: raven first

Date: 2026-10-17. Status: step 1 shipped (#237), step 2 in review (#239); later steps open, tracked in `docs/superpowers/plans/2026-10-17-supabase-sign-in.md`.

## Goal

Ship the shortest safe path to a raven library that requires a login. Anyone can create an account and verify their email, but only the owner can approve access, from a Users section inside raven. Pending and removed accounts cannot browse the library or play media, even by calling the API directly.

rookery, luwin, cross-app single sign-on and Google sign-in are not prerequisites for raven. The existing `2026-10-09-shared-sign-in-design.md` continues to describe rookery and luwin until their later migration.

The implementation plan is `docs/superpowers/plans/2026-10-17-supabase-sign-in.md`. It records foundation validation results and the remaining browser, deployment and desktop checks required before cutover.

## Scope decisions

| Area | First delivery | Later |
|---|---|---|
| Login host | raven itself | Consider moving shared account pages to rookery when another app adopts Supabase |
| Account creation | Email and password, email verification, password recovery and reset | Google sign-in |
| Access | Verified accounts start pending; owner approves or removes access in raven | No delegated approval administrators in the first delivery |
| Owner | Explicitly bootstrapped Supabase user UUID | Ownership transfer needs an operator procedure, not a public signup flow |
| Web | Login, signup, check-email, confirm, forgot, reset, pending and Users screens inside raven | Cross-app redirects and shared-domain SSO |
| Desktop | Minimum compatible login, pending state, secure session storage and authenticated playback before enforcement | Google callback flow and broader account-management UI |
| rookery and luwin | Leave their current authentication working | Migrate after raven is protected |
| Viewing data | Existing shared progress, plays, watched and favourites remain shared initially | Separate per-account data in the next phase |
| Hosting | Keep raven's current hosting; no new shared parent domain required | Shared-domain hosting only if later SSO needs it |

The first milestone is an access gate, not separate viewing profiles. Its shared viewing state must be documented before inviting users. Do not claim account isolation until the later data migration ships.

## First milestone: acceptance criteria

1. An anonymous visitor can reach raven's login and signup pages, but no library data, artwork, subtitles or playback bytes.
2. Signup requires email verification. A newly verified account sees an awaiting-approval screen and no library data.
3. The owner signs in and opens Settings > Users, which lists pending, approved and removed accounts. Only the owner can list other accounts or approve and remove them.
4. An approved user can browse and play. Refreshing the pending screen after approval grants access without needing another signup.
5. Removing access denies subsequent protected requests and new playback requests. A still-valid JWT is not sufficient to retain access.
6. A member cannot become the owner, approve themselves, change membership directly, or bypass owner-only management with the old admin password.
7. Sign out removes local session state and clears account-scoped UI caches. Session expiry and password recovery work.
8. The supported desktop release can sign in and play against the gated server. There is no unauthenticated desktop exception.

## Architecture

```
raven web: login, signup, confirm, recovery, pending, Settings > Users
    | Supabase browser client, host-only session cookie
    | Bearer for API writes; cookie permitted for GET/HEAD
    v
Supabase Auth + public.members + private owner configuration
    ^                                ^
    | JWT verification via JWKS      | user-scoped membership lookup / owner-only RPCs
    |                                |
raven server: account gate -> library PIN gate -> owner-only management
    ^
    | Bearer from main; account-bound playback tickets
raven desktop: login and pending screen; signup/recovery open raven web
```

- **Identity:** Supabase `sub` UUID, not email, Plex identity or a browser-provided role. Email is display/contact data and may change.
- **Owner:** one UUID in a private configuration table, set through the deployment runbook. RPCs check that value against `auth.uid()`. Server owner checks use the same authoritative configuration. No first-signup-wins rule and no owner id accepted from a client.
- **Membership:** `public.members` holds the account id, email and status (`pending`, `approved`, `revoked`). A trigger enrols a user when their email becomes confirmed and keeps their email synchronized. Missing membership denies access.
- **Approval:** Supabase is the source of truth. The first implementation checks current membership on protected requests rather than trusting a status or role embedded in a JWT. Do not introduce a membership cache without specifying and testing its revocation delay.
- **Failure:** invalid or missing identity answers 401; pending or revoked membership answers 403; unavailable authentication or membership infrastructure answers 503. Never fail open.
- **Owner bootstrap:** sign up and verify the owner's account, then set the private owner UUID and approve that account through an operator-only database operation. Only then enable production enforcement. Protect the owner's membership from ordinary removal operations.
- **No custom token hook required initially:** authorization comes from the membership table, so claim propagation and approval-triggered token refresh are not blockers.
- **No service-role key in clients:** use the publishable key and user JWT with RLS and narrowly granted RPCs. Privileged bootstrap credentials stay out of web bundles, desktop and logs.

## Supabase as code, under raven

Add `@raven/supabase` at `apps/raven/supabase`, not under rookery for this milestone. Its config, migrations, templates, local seed, pgTAP tests and deployment runbook belong to the product being shipped.

- Pin the Supabase CLI exactly and expose its tasks through Nx. Include new targets in `nx.includedScripts`.
- Configure email/password auth, confirmation, secure email changes, password recovery, refresh token rotation and appropriate password/rate-limit settings.
- Keep Google disabled. Disable unused services locally where supported.
- Email links use `token_hash` and `verifyOtp` on raven's confirmation route, including when opened in another browser. Only configured raven origins and callback paths are allowed.
- Deploy migrations before auth configuration. Keep cloud configuration reproducible; document any settings the CLI cannot manage.
- Local email uses Mailpit. Production signup requires a working SMTP provider and sender DNS, not Supabase's restricted built-in sender.
- RLS permits a user to read their own membership. Only the owner can list other users. Clients cannot insert, update or delete memberships directly.
- Owner-only security definer RPCs list members and change status. They use a fixed search path, validate every status transition and check ownership against the private table, not user metadata or JWT role claims.
- Seed a verified owner, pending member, approved member and revoked member for local tests. No production development passwords.
- Database tests need Docker. Run them through Nx locally and in a dedicated CI job; update verification exclusions and the root `CLAUDE.md` alongside that job.

## raven server and contracts

Keep the initial implementation raven-local. Add guards and derived contracts to `@raven/core`; browser code and Supabase SDK dependencies must not enter this platform-agnostic library. Do not create `@shared/auth` or `@shared/auth-web` before a second product needs them.

- Add auth configuration, JWT verification with pinned issuer, audience and signing algorithms, current membership lookup, and an injectable test seam for both.
- Add public auth configuration and an authenticated current-account endpoint. Expose only public connection settings and safe account fields.
- Resolve one caller per request, then apply the account gate, existing library lock policy and owner authorization. All existing management routes become owner-only when enforcement switches on.
- `@AdminOnly()` may retain its name, but its enforced meaning becomes the configured owner, not someone who knows `ADMIN_PASSWORD`.
- Keep the library PIN and current member visibility rules. Bind unlock state to the account so another account on the same browser does not inherit it.
- Bearer takes precedence. Only GET and HEAD may fall back to a browser session cookie. Cookie-only writes are rejected; do not permit CORS to bypass that rule.
- Explicitly enumerate public routes: health, public auth config and any required media-origin reachability probe. Auth pages are SPA routes, not permission to expose protected API routes. Test the public allowlist.
- Protect thumbnails, SSE, subtitles, downloads and every streaming path, not just JSON controllers. Private API replies must not be publicly cached by Netlify.
- Media tickets are short-lived and bound to the account. Redemption checks current approval; anonymous callers cannot mint tickets. Validate range requests, seeks and sidecar subtitles. Already-buffered bytes cannot be recalled; document whether an existing continuous stream ends on removal or at a bounded recheck.
- SSE must reauthenticate on reconnect and must not remain indefinitely authorized after token expiry or removal. Bound any long-lived authorization check explicitly.
- With enforcement enabled, missing auth configuration leaves health available but protected routes unavailable. Never silently restore anonymous access.

## raven screens

Keep raven's styling and tokens. Shared client state lives in the web app's `src/stores/` using zustand, not a new React context. Server account and membership lists remain TanStack Query data.

| Screen | Behavior |
|---|---|
| Login | Email/password, links to signup and recovery; approved accounts enter raven |
| Signup | Creates an account and explains email verification and manual approval |
| Check email | Resend with cooldown |
| Confirm | Consumes the token hash, removes it from the URL, then opens pending or reset |
| Forgot / reset | Non-enumerating recovery response and a working reset flow |
| Pending / removed | No library shell or data; check access again and sign out |
| Settings > Account | Current email, access status and sign out |
| Settings > Users | Owner only: pending, approved and removed tabs; Approve and Remove access |

- Use same-origin return paths validated at the boundary, not arbitrary redirect URLs.
- UI hiding is not authorization. Test direct member requests to management APIs and Supabase RPCs.
- Session refresh retries an unauthorized call at most once. Account switches and sign out clear the previous account's queries and unlock state.
- Pending and recovery pages must work without an approved membership, but they grant no library access.

## Desktop compatibility, not a suite migration

Before the protected server deploys, ship only the desktop support it actually needs:

- Main owns the Supabase session, adds Bearer to server calls and stores refresh credentials using `safeStorage`; without encryption, use memory only.
- Renderer receives safe account state, never raw tokens. In-app email/password login and pending/removed state are sufficient initially.
- Create account and Forgot password open this raven server's configured web origin, not rookery.
- Trust probing uses public auth configuration. Validate configured endpoints at the existing trust boundary.
- Native playback uses account-bound tickets, including subtitles and seeks; do not put long-lived credentials in media URLs.
- Remove obsolete admin-password calls and redact credentials, email-link tokens and playback tickets from logs.
- Local-file playback remains independent of server accounts.

Do not preserve old desktop server access with an authentication bypass. Release the compatible client before enforcement; old clients must update to access the protected server.

## Implementation order

Each implementation PR leaves main working. Steps 1 to 5 prepare the cutover; step 6 is the protected production milestone. Auth preparation is not a claim that the existing server is already gated.

| Order | PR / deliverable | Deployment or dependency |
|---|---|---|
| 0 | Focused technical checks, update this spec with findings, write the task-level implementation plan | Only raven-critical unknowns block the milestone |
| 1 | `@raven/supabase`: auth config, membership and private owner tables, enrolment, owner RPCs, email templates, tests and runbook | Create cloud project, configure SMTP, verify and bootstrap the owner's account |
| 2 | raven core contracts and server auth foundation: JWT verification, membership lookup, caller, current-account endpoint, owner checks and ticket support | Observation/preparation only on the existing server until cutover |
| 3 | raven web login, signup, confirmation, password recovery, pending state and session handling | Test with enforcement enabled in a local or staging environment |
| 4 | Settings > Users, owner-only approval/removal, Account section and end-to-end authorization tests | Owner can manage accounts entirely inside raven |
| 5 | Minimum desktop login, secure main-process session and authenticated playback | Release compatible desktop before the server cutover |
| 6 | Enforce approved-account access across every protected route; switch management to owner-only; remove admin-password authorization and bind PIN state to accounts | Configure production, deploy the gate and verify it before inviting users |
| 7 | Separate progress, plays, watched and favourites per account; migrate existing rows to the owner | Next feature after the access-gate milestone; initial viewing data is shared |
| 8 | Migrate rookery and luwin; extract shared auth modules when there are real consumers | Not a raven prerequisite |
| 9 | Cross-app SSO, Google sign-in, optional per-account library preferences and expanded desktop account UI | Independently scoped follow-ups |

Steps 3 and 4 can be combined if that yields a smaller, reviewable cutover. Do not turn every module into a separate blocking PR. The priority is a complete raven signup -> verification -> owner approval -> protected playback flow, not the suite's final architecture.

## Focused technical checks

Run only these before the task-level plan; do not retain the previous requirement to complete all fourteen suite-wide spikes first.

| Check | Must settle |
|---|---|
| Supabase local/cloud setup | Nx layout and CLI flags, reproducible config, asymmetric JWT keys, seed login and owner RPC/RLS behavior |
| Email lifecycle | Signup verification and recovery on raven, links opened in another browser, SMTP and redirect allowlist |
| Browser authentication | Host-only cookie format/chunking, refresh behavior, GET/HEAD cookie reads and Bearer-only writes |
| Server authorization | JWKS verification, user-scoped current membership reads, owner lookup, failure handling and removal with an already-issued JWT |
| Delivery path | Netlify forwards cookies, Authorization and SSE without public caching |
| Desktop/playback | Supabase auth in main, encrypted storage, account-bound tickets, subtitles and repeated seeks |

PyJWT, luwin identity matching, shared-subdomain refresh races, rookery deployment, Google PKCE and session-deletion hooks do not block raven. Deleting refresh sessions is not a substitute for checking current membership: it does not invalidate an already-issued access JWT.

## Verification and cutover

- Run project tasks through Nx from the repo root and use `bun run verify` or `bun run affected`, without bypassing hooks. Desktop native/e2e checks run only on supported Apple Silicon macOS and in the required desktop CI job.
- Database tests cover confirmed enrolment, missing membership, owner bootstrap, self-approval attempts, direct writes, non-owner RPC calls, protected owner membership and status changes.
- Server tests cover anonymous, unverified, pending, approved, revoked and owner callers across JSON, writes, artwork, SSE, files, ranges, subtitles and tickets. Include JWT expiry, wrong issuer/audience/algorithm, unavailable membership service and cache headers.
- Browser tests exercise signup, email confirmation, recovery, pending, owner approval, ordinary-user management refusal, sign out and account switching.
- Desktop tests exercise approved playback, pending/refused access, refresh, secure-storage fallback and secret redaction.
- Before production enforcement: verify SMTP, bootstrap the owner, configure the actual raven origins, release the compatible desktop, back up SQLite and stage the complete flow.
- After enforcement: anonymous direct API and media requests fail; owner can approve a second account; that account can play but cannot manage; removal blocks its next protected request even with its original JWT or ticket.
- Any rollback that removes enforcement reopens access. Treat it as an explicit security decision, not an automatic fallback.
