# raven auth UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** raven web gets login, signup, email confirmation, password recovery, a pending/removed screen, Settings > Account and the owner's Settings > Users, on top of the account endpoints #239 added.

**Architecture:** `@supabase/ssr`'s browser client keeps the session in the host-only `maester-auth` cookie the server already decodes. The session lives in a zustand store; the signed-in account and the member list are TanStack Query data from `/api/me` and `/api/auth/members`. One pure function turns config, session and account into an access state that a route guard switches on. The server does not gate existing routes until the enforcement PR, so this UI gates only itself.

**Tech Stack:** React 19, react-router-dom 7, TanStack Query, zustand, SCSS modules, bun test + happy-dom, `@supabase/supabase-js` and `@supabase/ssr` (pinned exactly).

**Spec:** `docs/superpowers/specs/2026-10-17-supabase-sign-in-design.md` (section "raven screens"; desktop is a later PR). Parent plan: `docs/superpowers/plans/2026-10-17-supabase-sign-in.md`. Branch `raven-auth-ui`, stacked on `supabase-spec-status` (#242), itself on `raven-auth-server` (#239).

## Global Constraints

- Contracts come from `@raven/core` (#239): `AUTH_PATHS`, `AUTH_REFUSALS`, `AUTH_CONFIG_STATES`, `AUTH_COOKIE` (`maester-auth`), `MEMBER_STATUSES`, `Account` (`{id, email, status, isOwner}`), `AuthConfig`, `ApiError.refusal`, `api.getAuthConfig/getMe/listMembers/setMemberStatus`. Add nothing to core unless a task says so.
- Bearer for every `/api/` call (`createApiClient({ accessToken })`); the cookie is only ever read by the server for GET/HEAD. A refused call retries after a session refresh at most once.
- Cookie: host-only (no `Domain`), `Path=/`, `SameSite=Lax`, `Secure` on https. Never put the access token in a URL, log or query key.
- Email links use `token_hash` and `verifyOtp` on raven's confirm route; the hash is removed from the URL before anything else renders. Return paths are same-origin paths checked by a guard, never a URL.
- Pending, removed and recovery screens render without an approved membership and show no library data or shell.
- `authConfig.state` `off` leaves raven exactly as today (no gate, no auth routes linked). `unavailable` shows a notice on auth pages and leaves the rest as today.
- Repo rules (root `CLAUDE.md`): no casts, `any`, enums, `interface`, non-null `!` or `for` loops; `type` aliases; named exports; `@/` imports without extensions; every identifier string (route path, query key, status, error code, storage key) is an `as const` value declared once; discriminated unions switched exhaustively with a `never` default; one object parameter; early returns; no comments that restate code; no em or en dashes, UI copy included.
- Shared state in a zustand store under `apps/raven/web/src/stores/`, never `createContext`. Server data stays in TanStack Query with its key in `queryKeys` and its options in `lib/queries.ts`.
- CSS: SCSS modules, grid with `gap` and no flex or margins, tokens only, desktop-first `max-width` queries from `30rem/40rem/48rem/64rem`, motion inside `prefers-reduced-motion: no-preference`, visible `:focus-visible`, a label on every control. No dead selectors.
- Coverage floors in `apps/raven/web/package.json` (`--lines 96 --functions 88`) must still pass. Exact dependency versions, no `^` or `~`.
- Tasks run as `bunx nx run @raven/web:test` (or `:typecheck`, `:lint:ts`, `:lint:css`, `:format:check`) from the worktree root.

## Review Focus

- A `token_hash` that is expired, already used or malformed on the confirm route: an error screen with a way to resend, the hash gone from the URL, no redirect loop (Task 7).
- `return_to` of `//evil.example`, `/\evil.example`, `https://evil.example`, `javascript:alert(1)` and a path with a newline: all become `/` (Task 2).
- Signing out, or a different account signing in on the same browser: the previous account's cached queries, PIN unlock state and selection are gone (Task 4).
- Cookie larger than one chunk: sign out removes every `maester-auth.N` chunk and the whole cookie, since the server rejects a whole cookie beside chunks (Task 4).
- `/api/me` answering 503 `unavailable`, or the network failing: a "try again" screen, not a sign-out and not a redirect loop (Task 3).

---

### Task 0: Spike, no repo code

**Files:** scratchpad only. Record outcomes in this plan under "Spike results" before Task 1.

- [x] **Step 1:** In the scratchpad, install the latest `@supabase/supabase-js` and `@supabase/ssr` that are at least two weeks old (`bun pm view <pkg> time`). Note the exact versions.
- [x] **Step 2:** Create `createBrowserClient(url, key, { cookieOptions: { name: 'maester-auth' } })` under happy-dom, store a session whose JSON is over 4 KB, and print `document.cookie`. Confirm the names are `maester-auth` or `maester-auth.0`, `.1`, the value is `base64-` plus base64url, and a sign out removes every chunk.
- [x] **Step 3:** Feed that `document.cookie` to the server's decoder (`apps/raven/server/src/auth/accessToken.ts`, `accessTokenOf` with method `GET`) in a scratch bun script and confirm it returns the session's `access_token`. If it does not, the plan changes to a hand-written `storage` for `@supabase/supabase-js`; stop and report.
- [ ] **Step 4:** Against the local stack (`bunx nx run @raven/supabase:start`), confirm `signUp` delivers a Mailpit email whose link carries `token_hash` and `type`, and that `verifyOtp({ token_hash, type })` from a client with no session creates one.
- [x] **Step 5:** Write the versions and findings into this file. No commit of scratch code.

**Spike results (2026-10-18):**

- Versions: `@supabase/supabase-js` 2.117.2 (2026-09-25; 2.117.3 and 2.118.0 are under two weeks old) and `@supabase/ssr` 0.12.7 (2026-09-08).
- Steps 2 and 3 pass under happy-dom with a stubbed token endpoint: a small session is one `maester-auth` cookie, a 6 KB one is `maester-auth.0` to `.2`, values start `base64-`, and the server's `accessTokenOf` (GET) returns the session's exact `access_token` for both. No hand-written storage needed.
- Sign out under happy-dom leaves empty-valued entries (`maester-auth.0=`), not absent ones. Task 4's test asserts no `maester-auth*` entry has a value; the server reads an empty value as no token.
- Step 4 (Mailpit) not run here; the stack was down. The confirmation template links `{{ .SiteURL }}/auth/confirm?token_hash=...&type=email` (recovery uses `type=recovery`), so signup confirmation is `verifyOtp` type `email`, not `signup`. Task 7 is corrected below. `site_url` is `http://localhost:5173`, so the link ignores `emailRedirectTo` and lands on raven's `/auth/confirm`; the Task 11 walkthrough confirms `verifyOtp` with no prior session.

### Task 1: Dependencies and the auth client seam

**Files:**
- Modify: `apps/raven/web/package.json`, `bun.lock`
- Create: `apps/raven/web/src/lib/authClient.ts`, `apps/raven/web/src/lib/authClient.test.ts`

**Interfaces:**
- Produces: `AUTH_ERRORS` (`as const` of the Supabase error codes the screens branch on: `invalidCredentials`, `emailNotConfirmed`, `userAlreadyExists`, `otpExpired`, `overEmailSendRateLimit`, `weakPassword`).
- Produces: `type AuthClient` = the slice of the Supabase auth API used (`signInWithPassword`, `signUp`, `signOut`, `resend`, `resetPasswordForEmail`, `updateUser`, `verifyOtp`, `refreshSession`, `getSession`, `onAuthStateChange`), written as `Pick<SupabaseClient['auth'], ...>`.
- Produces: `createAuthClient({ config }: { config: ReadyAuthConfig }): AuthClient` building `createBrowserClient` with `cookieOptions: { name: config.cookieName, sameSite: 'lax', path: '/' }` and no `domain`; `type ReadyAuthConfig = Extract<AuthConfig, { state: 'ready' }>` written with `AUTH_CONFIG_STATES.ready`.

- [ ] **Step 1:** Add both dependencies at the Task 0 versions to `@raven/web`; `bun install`. Knip must not flag them once Task 1 imports them.
- [ ] **Step 2:** Test `createAuthClient` with `document.cookie`: after a stored session the cookie is named `maester-auth` (never a `sb-` name), has no `Domain`, and signing out leaves no `maester-auth*` cookie.
- [ ] **Step 3:** Implement `authClient.ts`; the test passes.
- [ ] **Step 4:** Commit `MAE: add the Supabase browser client to raven web`.

### Task 2: Auth routes and return paths

**Files:**
- Create: `apps/raven/web/src/lib/authRoutes.ts`, `apps/raven/web/src/lib/authRoutes.test.ts`

**Interfaces:**
- Produces: `AUTH_ROUTES` = `{ signIn: '/sign-in', signUp: '/sign-up', checkEmail: '/check-email', confirm: '/auth/confirm', forgot: '/forgot-password', reset: '/reset-password', pending: '/pending' }` as const, and `AUTH_QUERY` = `{ returnTo: 'return_to', tokenHash: 'token_hash', type: 'type', email: 'email' }`.
- Produces: `safeReturnPath(value: string | null): string` returning `value` only if it starts with exactly one `/`, has no backslash, control character or `//` prefix, and parses on `window.location.origin` to the same origin; otherwise `'/'`. A path that is an auth route also becomes `'/'`.
- Produces: `signInPath({ returnTo }: { returnTo: string }): string`.

- [ ] **Step 1:** Test `safeReturnPath` for the Review Focus inputs (each returns `'/'`), for `/libraries/3?x=1#y` (kept) and for `/sign-in` (returns `'/'`).
- [ ] **Step 2:** Implement it; tests pass.
- [ ] **Step 3:** Commit `MAE: add raven's auth routes and a safe return path`.

### Task 3: Session store, access state and route guard

**Files:**
- Create: `apps/raven/web/src/stores/authSession.ts`, `.test.ts`; `apps/raven/web/src/lib/accessState.ts`, `.test.ts`; `apps/raven/web/src/components/AuthGate/AuthGate.tsx`, `.test.tsx`, `AuthGate.module.scss`
- Modify: `apps/raven/web/src/lib/api.ts`, `apps/raven/web/src/lib/queries.ts`, `apps/raven/web/src/lib/queryClient.ts` (keys `authConfig`, `account`, `members`), `apps/raven/web/src/AppRoutes.tsx`, `apps/raven/web/src/main.tsx`

**Interfaces:**
- Produces: `useAuthSession` zustand store: `{ client: AuthClient | null; session: SessionSummary | null; status: 'booting' | 'ready'; start(config), accessToken(): string | null }` where `SessionSummary = { accessToken: string; userId: string }`. `start` builds the client, reads `getSession`, subscribes to `onAuthStateChange`, and marks `ready`.
- Produces: `type AccessState = { kind: 'disabled' } | { kind: 'unavailable' } | { kind: 'loading' } | { kind: 'signedOut' } | { kind: 'failed' } | { kind: 'pending' } | { kind: 'revoked' } | { kind: 'approved'; account: Account }` (kinds from an `ACCESS_KINDS` constant) and `accessStateOf({ config, session, account }): AccessState`.
- Produces: `authConfigQuery`, `accountQuery(userId)` (retry 0; keyed by user id so a switch cannot show another account's data), `useAccessState(): AccessState`.
- Produces: `<AuthGate>` route element: `disabled` and `approved` render `<Outlet />`; `signedOut` navigates to `signInPath({ returnTo: current })`; `pending` and `revoked` navigate to `AUTH_ROUTES.pending`; `loading` shows a loading screen; `failed` shows "Account access is temporarily unavailable" with Try again; `unavailable` renders the outlet (server not gated yet).

- [ ] **Step 1:** Test `accessStateOf` for every kind, including `/api/me` 503 and network error becoming `failed`, a 403 `pending` refusal becoming `pending`, and a 401 `signed_out` becoming `signedOut`.
- [ ] **Step 2:** Test the store with a fake `AuthClient`: boot with and without a session, an `onAuthStateChange` event updates `session`, `accessToken()` is null when signed out.
- [ ] **Step 3:** Implement both; `api` passes `accessToken: () => useAuthSession.getState().accessToken()`; `main.tsx` starts the store once the config query resolves.
- [ ] **Step 4:** Test `AuthGate` per kind, including that a 503 on `/api/me` shows Try again and does not navigate (Review Focus).
- [ ] **Step 5:** Wrap the browsing routes and `watch/:id` in `AuthGate` in `AppRoutes.tsx`; the auth routes sit outside it.
- [ ] **Step 6:** Commit `MAE: gate raven web on the signed-in account`.

### Task 4: Refresh retry, sign out and account switches

**Files:**
- Create: `apps/raven/web/src/lib/signOut.ts`, `.test.ts`
- Modify: `apps/raven/web/src/lib/api.ts`, `apps/raven/web/src/stores/authSession.ts`, `apps/raven/web/src/stores/unlockPrompt.ts` (only if a reset is missing), `apps/raven/web/src/stores/selection.ts` (only if a reset is missing)

**Interfaces:**
- Produces: `signOut({ queryClient }): Promise<void>`: `client.auth.signOut()`, then `queryClient.clear()`, the unlock prompt closed, selection cleared.
- Produces: in `api.ts`, a `fetch` wrapper that on an `ApiError` with `refusal.reason === AUTH_REFUSALS.signedOut` calls `refreshSession()` once and repeats the request once; a second refusal signs out.
- Produces: the store clears the query client when `onAuthStateChange` reports a different `userId` than before.

- [ ] **Step 1:** Test the retry: first 401 `signed_out`, refresh succeeds, second call carries the new token and succeeds; a second 401 does not loop and ends signed out.
- [ ] **Step 2:** Test `signOut` and a user switch empty the query cache, close the PIN prompt and clear selection (Review Focus).
- [ ] **Step 3:** Test that after `signOut` with a three-chunk session, `document.cookie` holds no `maester-auth` entry (Review Focus).
- [ ] **Step 4:** Implement; tests pass.
- [ ] **Step 5:** Commit `MAE: refresh once, clear account state on sign out and switches`.

### Task 5: Sign in

**Files:**
- Modify: `apps/raven/web/src/pages/SignInPage/SignInPage.tsx`, `.module.scss`, `.test.tsx`; `apps/raven/web/src/AppRoutes.tsx`

**Interfaces:**
- Consumes: `useAuthSession`, `AUTH_ROUTES`, `safeReturnPath`, `AUTH_ERRORS`.
- Produces: the existing page reshaped for email and password: the Server field and "Keep me signed in" go (no server choice on web, and the session always persists); Name becomes Email (`type="email"`, `autoComplete="username"`); links to sign up and forgot password; on success navigate to `safeReturnPath(return_to)`. Remove `SignIn`, `SignInDetails` and `signInUnavailable` if nothing else reads them (knip).
- Error copy: `invalidCredentials` "Email or password is wrong."; `emailNotConfirmed` offers resend and links to check-email; anything else "Sign in failed. Try again."

- [ ] **Step 1:** Update the tests: success goes to the return path, an `//evil` return goes home, each error code shows its copy and marks the password invalid.
- [ ] **Step 2:** Implement; tests, `lint:css` and `typecheck` pass.
- [ ] **Step 3:** Commit `MAE: sign in to raven with an email and password`.

### Task 6: Sign up and check email

**Files:**
- Create: `apps/raven/web/src/pages/SignUpPage/`, `apps/raven/web/src/pages/CheckEmailPage/` (each `.tsx`, `.module.scss`, `.test.tsx`)

**Interfaces:**
- `SignUpPage`: email, password, confirm password (matched client-side), copy that explains email verification and manual approval; calls `signUp({ email, password, options: { emailRedirectTo: <webUrl>/auth/confirm } })`; always navigates to `AUTH_ROUTES.checkEmail` with `email`, including for an already registered address (non-enumerating, Review Focus); `weakPassword` shows the server's message.
- `CheckEmailPage`: names the address, `Resend` calls `auth.resend({ type: 'signup', email })` then disables for 60 seconds with a visible countdown; `overEmailSendRateLimit` shows "Wait a moment before asking again."

- [ ] **Step 1:** Tests: mismatch blocks submit, existing-user and new-user navigate identically, resend disables for 60 s (fake timers) and re-enables, rate limit copy shows.
- [ ] **Step 2:** Implement both pages; tests pass.
- [ ] **Step 3:** Commit `MAE: sign up for raven and ask to check email`.

### Task 7: Confirm

**Files:**
- Create: `apps/raven/web/src/pages/ConfirmPage/` (`.tsx`, `.module.scss`, `.test.tsx`)

**Interfaces:**
- Reads `token_hash` and `type` (`email` or `recovery`, otherwise an error; the confirmation template in `apps/raven/supabase/templates` links with `type=email`), immediately replaces the URL with `AUTH_ROUTES.confirm` (no query), then `verifyOtp({ token_hash, type })`. `email` goes to `/` (the gate then shows pending or the library); `recovery` goes to `AUTH_ROUTES.reset`. `otpExpired` or any failure shows "This link has expired or was already used" with a link to resend (`checkEmail` for `email`, `forgot` for `recovery`).

- [ ] **Step 1:** Tests: the URL has no `token_hash` before `verifyOtp` resolves and after it fails; success and failure for both types; a second render with no params shows the error, not a spinner; opened with no prior session (a second browser).
- [ ] **Step 2:** Implement; tests pass.
- [ ] **Step 3:** Commit `MAE: confirm an email link on raven`.

### Task 8: Forgot and reset password

**Files:**
- Create: `apps/raven/web/src/pages/ForgotPasswordPage/`, `apps/raven/web/src/pages/ResetPasswordPage/`

**Interfaces:**
- `ForgotPasswordPage`: email; calls `resetPasswordForEmail(email, { redirectTo: <webUrl>/auth/confirm })`; always shows the same "If that address has an account, a link is on its way" message, whatever the result except a rate limit.
- `ResetPasswordPage`: reachable only with a recovery session (else navigates to `forgot`); new password plus confirmation; `updateUser({ password })`; on success goes to `/`.

- [ ] **Step 1:** Tests: identical message for a known and unknown address, reset without a session redirects, mismatch blocks, success navigates, `weakPassword` copy.
- [ ] **Step 2:** Implement both; tests pass.
- [ ] **Step 3:** Commit `MAE: recover a raven password`.

### Task 9: Pending and removed

**Files:**
- Create: `apps/raven/web/src/pages/PendingPage/` (`.tsx`, `.module.scss`, `.test.tsx`)

**Interfaces:**
- Renders outside `AppShell`: "Waiting for approval" for `pending`, "Your access was removed" for `revoked`; buttons `Check again` (refetches `accountQuery`; on `approved` navigates to `/`, which the gate now lets through) and `Sign out` (`signOut`). Signed out visitors are sent to sign in; approved ones to `/`.

- [ ] **Step 1:** Tests for both variants, Check again turning approved navigates home, Check again still pending stays, sign out clears the session.
- [ ] **Step 2:** Implement; tests pass.
- [ ] **Step 3:** Commit `MAE: show raven's pending and removed screen`.

### Task 10: Settings > Account and Users

**Files:**
- Create: `apps/raven/web/src/pages/SettingsPage/AccountSection.tsx`, `UsersSection.tsx` and a `.test.tsx` each; `apps/raven/web/src/lib/useMembers.ts`
- Modify: `apps/raven/web/src/pages/SettingsPage/SettingsPage.tsx`, `SettingsPage.module.scss`

**Interfaces:**
- `AccountSection`: shown only while auth is on; email, access status, `Sign out`.
- `UsersSection`: shown only when the signed-in account `isOwner`; tabs Pending, Approved, Removed from `MEMBER_STATUSES`; rows email plus `Approve` (on pending and revoked) and `Remove access` (on approved and pending); the owner's own row has no actions. `useMembers` reads `api.listMembers` and invalidates on `setMemberStatus`, keyed by user id. A 403 `not_owner` hides the section. Remove access asks to confirm.

- [ ] **Step 1:** Tests: a non-owner sees Account but not Users, an owner sees the three tabs with the right members, Approve moves a row and refetches, Remove asks first, the owner row has no buttons, a failed change shows its message.
- [ ] **Step 2:** Implement; tests pass.
- [ ] **Step 3:** Commit `MAE: manage raven accounts from Settings`.

### Task 11: Docs, wiring and verification

**Files:**
- Modify: `apps/raven/README.md`, `docs/superpowers/plans/2026-10-17-supabase-sign-in.md` (link the later-stack row to this plan and tick what ships)
- No source files.

- [ ] **Step 1:** README: the auth routes, that web gates itself only when the server reports `ready`, and that the server does not yet gate existing routes.
- [ ] **Step 2:** Run `bunx nx run @raven/web:test`, `:typecheck`, `:lint:ts`, `:lint:css`, `:format:check`, then `bun run verify` from the worktree root. All pass, coverage floors held.
- [ ] **Step 3:** Local walkthrough with the `run` skill: start the Supabase stack and raven with `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `RAVEN_WEB_URL` set; sign up, open the Mailpit link in a private window, see Pending; sign in as the seeded owner, approve, see the other window's Check again let it in; Remove access and see the next request refuse. Note what was and was not seen.
- [ ] **Step 4:** Not verifiable here, listed in the PR: Netlify forwarding and SSE, real SMTP, cloud redirect allowlist, a second real device.
- [ ] **Step 5:** Push and open the PR with base `supabase-spec-status` per `pr-format`, with screenshots of each new screen from the local stack.

---

## Self-review

- **Spec coverage:** Login, signup, check email with cooldown, confirm, forgot/reset, pending/removed, Settings > Account and Users, validated return paths, refresh retry at most once, sign-out and account-switch clearing, Bearer writes: Tasks 3 to 10. Netlify and SMTP: Task 11 step 4, deferred to the operator as the parent plan states. Desktop and enforcement: other PRs.
- **Consistency:** `AccessState` kinds, `AUTH_ROUTES`, `AUTH_ERRORS`, `useAuthSession`, `accountQuery(userId)` are named once in Tasks 1 to 3 and reused.
- **Open risk:** Task 0 may fail the `@supabase/ssr` cookie check; the fallback is a hand-written storage on `@supabase/supabase-js`, which changes Task 1 only.
