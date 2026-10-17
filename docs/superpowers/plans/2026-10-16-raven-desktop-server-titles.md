# raven desktop server titles (P6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship step P6 of the desktop spec: raven player plays titles from raven servers the user added. Servers live in Settings (add, rename, remove, which clears that server's session); a `raven://play` link or a pasted `https://<origin>/watch/<id>` (Open Link, Command L) names a title by ids; an unknown origin needs a native confirmation from main before anything is fetched; each server has its own `persist:server:<serverId>` session; the renderer reaches a server only through eight allowlisted calls that main runs with `ses.fetch`; mpv reads `/api/media/:id/file` with the session's `raven_unlock` and `raven_admin` cookies as a `Cookie` header and adds the server's sidecars with `sub-add`; `UnlockDialog` moves to `@raven/ui` and asks for the PIN, or first the admin password while the admin lock hides the title; progress and history go to the server; up next comes from the link; without libmpv a server title opens in the browser. On the web, a per-browser setting "Open videos in raven player" (off by default) adds "Open in raven player" to Unplayable and to the player's settings menu.

**Architecture:** The renderer still holds only ids: a server is an opaque `serverId`, a title a `mediaId`. The page's `ApiClient` is `createApiClient({ fetch: bridgedFetch })`; `bridgedFetch` sends `{ serverId, method, path, body }` as a desktop request, and main runs it only when `matchCall` recognises one of the eight calls, rebuilding the path and body from the narrowed fields itself, in that server's own session, never following a redirect. Trust, links, the allowlist, the cookie header, server sources and the config are pure main-process modules taking Electron's pieces as arguments, so `bun test` covers them; the player service resolves a `{ kind: 'server' }` source to a URL, a header and sidecars from main's own allowlisted calls; `src/main/main.ts` alone wires sessions, the native dialog and `shell.openExternal`. A small HTTP fixture in `e2e/fixtureServer.ts` stands in for raven in the real-mpv suite and in Playwright.

**Tech Stack:** Electron 44.7.0 (`session.fromPartition`, `ses.fetch`, `ses.cookies`, `dialog.showMessageBox`, `shell.openExternal`), `@raven/mpv` over libmpv 0.41 (`http-header-fields`, `stream-lavf-o`, `sub-add`), `@raven/core` (`createApiClient`, `isLockedError`, guards), `@raven/ui` (Vite library), React 19.3 + React Router 7 + TanStack Query 5 + zustand 5, `bun test` + happy-dom, Node 24 `node:test` via tsx 4.23.15 for real libmpv, `@playwright/test` 1.64.1 `_electron`, Nx 23 over Bun 1.4.2 workspaces.

**Spec:** `docs/superpowers/specs/2026-10-12-raven-desktop-design.md` (P6 under "Order of work > Phase 1"; sections 2 "First release: Open in raven player", 4 "Server titles", "Opening files", "Screens", "State that persists", "Security", "Menus", 5 "Sources" and "The bridge", 6, 9, "Risks", "Verification", "Spike outcomes > P0"). Builds on `docs/superpowers/plans/2026-10-16-raven-desktop-shell.md` (P4) and `docs/superpowers/plans/2026-10-16-raven-desktop-native-playback.md` (P5), whose Rulings still hold.

## Rulings (where the spec, the brief and the repo disagree or the spec is silent)

1. **A locked title answers 423, not 403.** The spec says "a `403` on `getMedia` opens `UnlockDialog`". The server's `LockGuard` answers `LOCKED_STATUS` (423) for a locked library and 404 while the admin lock hides it (`apps/raven/server/src/lock/lockGuard.ts`), and core already has `isLockedError`. The plan follows the repo: 423 asks for the PIN; 404 reads `getAdminLock()` and asks for the admin password only when it answers `{ state: 'on', available: true }`; any other 404 is a title that is gone. The admin password gates the PIN: `LockService.isUnlocked` is false while the admin lock holds.
2. **No remembered unlock.** `raven_unlock` has no `Max-Age` and its signing key lives only as long as the server process (P0 outcome); `raven_admin` has `Max-Age` 400 days. So after a relaunch the PIN is asked again while the admin step usually is not. No copy promises otherwise, nothing copies or re-creates cookies, and cookies never move between jars.
3. **A server's name.** The server has no name endpoint and P6 changes no server code. A new server is named by its origin's `host` (punycode, with a port when not the default), shown in Settings, where it can be renamed (1 to 80 characters). That a server is raven is checked after consent by `GET /api/lock` answering 200 with a valid `LockState`; anything else is not stored and its fresh session is cleared.
4. **Main's own server calls use the allowlist too.** The trust probe (`getLock`), the sidecar lookup (`getTracks`) and the failure explanation (`getMedia`) go through the same `matchCall`/`requestFor` and the same session as the page's calls. Main never calls anything else on a server.
5. **The link's writer lives in core, its reader in the desktop.** `playLinkFor` (built with `toQueryString`, since core may not use `URL`) and the `PlayRequest` type and `isMediaId` go in `libs/raven/core/src/playLink.ts`, so the web writes what the desktop reads; `readPlayLink` and `serverOriginOf` use `URL` and stay in `apps/raven/desktop/src/shared/playLink.ts`, as the spec says.
6. **`desktop-config.json` becomes version 2** with `servers`, read from version 1 as no servers (P5 Ruling 10).
7. **`UnlockDialog` moves by `git mv` in its own commit**, then takes props (`secret`, `hint`, `unlock`, `onUnlocked`, `onClose`). The web keeps the zustand prompt and the `api` singleton in a new wrapper, `apps/raven/web/src/components/PinPrompt/PinPrompt.tsx` (a new path, so `git log --follow` keeps the dialog's history); the web's test moves beside it with only its import path and rendered name changed.
8. **Links.** Only the first link of an `open-url` batch is acted on (the rest are logged); one trust prompt at a time (a link during a prompt is answered "busy"); an origin declined from a link is not prompted again by links for the rest of the session, while Settings' Add and Open Link always prompt. A link that names a trusted server plays at once, replacing whatever plays (the unmount saves its position first, as with files).
9. **A pasted watch page ignores its query and hash**; a `raven://` link is strict: exactly the keys `server`, `media`, `at`, `next`, each at most once.
10. **Recents for server titles** keep `{ serverId, mediaId, label, watched }`; `watched` is a display-only share written when the title opens and when it is left. The resume point still comes from the server only (spec "State that persists"). Removing a server removes its recents.
11. **Server titles show no poster** (`posterUrl: null`): `img-src` stays `'self' data:` and the renderer fetches nothing from a server.
12. **Next from the link:** the Next button's label comes from `getMedia(next[0])`; while that is pending or fails there is no Next.
13. **Errors on a server title are explained by main.** When mpv fails to open or stops a server title, main asks `getMedia` once: unreachable is `network` ("lost its connection"), 423 is `locked` (the page asks for the PIN, then resumes at the last saved position), 404 is a title that is gone, 200 keeps mpv's own reason.
14. **No redirects with cookies.** API calls run with `redirect: 'error'`. mpv gets `stream-lavf-o=max_redirects=0` for server titles (a spike in Task 11, with its fallback there).
15. **Settings' Add goes through the native prompt too**, because a compromised page could send `addServer`.
16. **The browser fallback is page-initiated for trusted servers only.** The server page asks main for `openInBrowser` once per mount when the engine is unavailable, and offers it as Unplayable's escape ("Open in browser", icon `globe`, no VLC hint); main opens `<origin>/watch/<id>` only for a stored server.
17. **Unplayable's "Open in raven player" is the primary action;** when it is offered, "Try playing anyway" drops to the default tone. Both only happen with the setting on, so the web is unchanged with it off.
18. **Only external tracks are `sub-add`ed**, in the server's `external-N` order, so `tracksFromMpv` numbers them as the server does; embedded ones come from the file.

## Deferred, so nothing is lost

| Spec item | Lands in |
| --- | --- |
| libmpv and the addon bundled and signed in the app, the dmg maker, `desktop-release.yml` (until then the CI `make` artifact has no addon, so its server titles open in the browser) | P7 |
| `updates.ts`, Check for Updates, the update switch in Settings | P7 |
| `crashReporter`, the rotating log (allowlist refusals, trust outcomes and mpv warnings go to the console until then), Show Logs, Show Crash Reports, Copy Diagnostics | P7 |
| Memory and CPU budgets (section 8) | P7 |
| Docs: root `CLAUDE.md` project table and CSS section, `apps/raven/CLAUDE.md`, `apps/raven/README.md` (server trust, handoff, the Netlify origin advice from Risks), the spec's outcomes | P7 |
| A server advertising its canonical origin (the Netlify handoff), a server name endpoint | Follow-ups |
| Remote library browsing, the remote proxy host, mkv transcodes, Switch server | D4 |
| P5's addon rebuild items and real-hardware gates | As P5 recorded them |

## Global Constraints

Binding for every task. From the root `CLAUDE.md` and the P4 and P5 plans unless marked.

- Run tasks through Nx from the repo root. Every task ends green on `bunx nx run-many -t typecheck lint:ts lint:css format:check test build -p @raven/desktop @raven/ui @raven/core @raven/mpv @raven/web`, and `bunx nx run @raven/desktop:e2e` stays green on macOS (23 tests at the start of P6).
- TypeScript only: no `.js`, `.jsx`, `.mjs` or `.cjs` source or config file. A `package.json` script runs one command (`bun run --sequential a b`, never `&&`, `||` or `;`); every desktop script is in `nx.includedScripts`.
- Imports of a project's own modules go through `@/` with no extension (`@/main/servers/allowlist`); assets keep theirs. Only exception: `forge.config.ts`.
- No em dashes or en dashes anywhere, including comments, UI copy and test names.
- Type guards wherever possible; never `any`; never cast (`as const` is not a cast); `unknown` when a type cannot be inferred; discriminated unions switched with a `never` check in `default`; no enums; `type`, never `interface`; `as const satisfies T`; derive types (`Infer`, `ReturnType`, indexed access); no non-null assertion outside tests; never `@ts-ignore`.
- Validate untrusted data at the boundary with a guard: every IPC payload and port message in main and in the renderer, `location.state`, route params, link strings, files read from disk, every server reply (core's guards), every value out of `@raven/mpv`. `object()` guards let unknown fields through, so receivers rebuild what they keep from the fields they know. Past the boundary, trust the narrowed type.
- No `for`, `for...of` or `for...in`; array methods, `reduce`, recursion for sequential async work. `!!value`; `?.` with `??`; one object parameter (library-fixed callbacks exempt); JSX `&&`; guard clauses; `const`; never mutate inputs; `??` for defaults; no floating promises; throw only `Error`s; named exports only; booleans named `is`/`has`/`should`/`can`; comments only for a non-obvious why.
- CSS: SCSS modules through `@/`; grid with `gap` and container padding, no flex, no margins for spacing; named `grid-template-areas` in fixed layouts, overlays share a named area; semantic elements first; raven's tokens from `libs/raven/ui/src/styles/globals.scss`; desktop first (`30rem`, `40rem`, `48rem`, `64rem`); works at 320px; motion inside `@media (prefers-reduced-motion: no-preference)`; no `:global()`; a label on every control and `:focus-visible` with `--focus-ring`.
- `libs/raven/core` stays platform-agnostic: no DOM, no Node APIs, not even `URL` or `URLSearchParams` (use `toQueryString`).
- Main-process modules other than `src/main/main.ts` import `electron` with `import type` only and take Electron's pieces, the file system and mpv as arguments. Only main-process code imports `@raven/mpv`.
- **Security posture (P4 and P5 rulings, binding):** the renderer holds only ids, no cookies, no URLs, and no network beyond `app://raven`; the CSP and `connect-src 'self'` are unchanged; the `raven://` link carries ids, not URLs; only added servers play; an unknown origin needs a native `dialog.showMessageBox` from main and nothing is fetched (no session made) before consent; the allowlist is exactly the eight calls, method and path matched, and main builds every outgoing path and body itself; one session `persist:server:<serverId>` per server, cookies never copied between jars, a server's removal clears its session; mpv reads the file with the `Cookie` header main assembles from that session's `raven_unlock` and `raven_admin`, with the cache forced on (the addon's `cache=yes`, `demuxer-max-bytes` 1 GiB, `demuxer-max-back-bytes` 256 MiB, unchanged); `access-references=no`, no raw mpv commands, `loadfile` only inside the player service, sources resolved in main. `app.setAsDefaultProtocolClient` is never called; `raven://` arrives through `open-url` (queued before ready, capped).
- **The bridge (P5, binding):** the port accepts only `isPlayerRequest`; main builds every mpv argument from narrowed fields it picks itself; numbers are finite and clamped where applied; a server source's `serverId` must pass `isOpaqueId` and its `mediaId` `isMediaId` before anything is resolved.
- `@raven/ui` and `@raven/web` stay web-identical while the new setting is off: every new `PlayerServices` field is optional and the web passes none of them unless the setting is on; `@raven/web`'s existing tests pass untouched (apart from Ruling 7's moved test); UI and web keep their 96% line and 88% function coverage floors.
- Test hooks (`RAVEN_DESKTOP_USER_DATA`, `RAVEN_DESKTOP_MPV`) are read only when `app.isPackaged` is false. Logs name cookies, never their values.
- Never build libmpv locally; use the CI-built `libs/raven/mpv/resources/darwin-arm64` already in the worktree.
- Nothing for P7 (see "Deferred").
- Commits follow the `commit-format` skill: `MAE:` subject, short bullet body, no agent attribution. Never `--no-verify`.

## Review Focus

The inputs most likely to bite a person using server titles, most likely first. Each has its test in the owning task.

1. **A hostile or odd `raven://` link** (a web page firing links): `javascript:` or `file:` origins, credentials or a path in the origin, an IDN homograph shown in the prompt as punycode, 101 `next` ids, a negative or `NaN` `at`, a repeated key, 5 KB of text. Rejected with one notice, or prompted with the ASCII origin. (Task 1 parser tests; Task 4 first-of-batch and busy tests.)
2. **Trusting a server that is not raven, or not there:** after consent the probe fails (HTML, 404, timeout, a redirect); nothing is stored and the fresh session is cleared, and declining fetches nothing at all. (Task 4 trust tests; Task 14 e2e "fetches nothing".)
3. **A locked library, with and without the admin lock, and an unlock that fails:** 423 asks for the PIN, 404 under the admin lock asks for the password first, a wrong PIN or a 429 says the server's reason and stays open, a 404 with the lock off says the title is gone. (Task 8 page tests; Task 14 e2e both modes.)
4. **The server going away, or the unlock lapsing, mid-film:** mpv's error is explained (`network`, or `locked`, which asks for the PIN and resumes), never a bare "could not play", and the last saved position stays. (Task 10 explain tests; Task 8 relock test.)
5. **Replies that are not what they seem:** a 5xx, an HTML page with 200, a redirect, a body over 1 MiB, a call that never answers. Each becomes a clear message, never a hang. (Task 3 call tests; Task 8 HTML test.)
6. **Origins that look different but are the same:** a trailing slash, upper case, `:443` on https, the same origin added twice; one server, never two. (Tasks 1 and 2.)
7. **Quitting while saves are in flight:** waits up to the quit gate for the server's `PUT progress` and `POST plays`, then stops mpv and flushes the stores. (Task 12 shutdown tests.)
8. **A stale or forged server id** (a removed server's recent, a request after removal, a load naming a removed server): refused with "That server is no longer in raven player.", and removing the playing server stops it. (Tasks 4, 5, 10.)
9. **The twenty-first server:** refused before any prompt. (Tasks 2 and 4.)
10. **No libmpv:** a server title opens `<origin>/watch/<id>` in the browser for a trusted server only. (Tasks 5, 8, 14.)

---

### Task 1: Play links and server origins

**Files:**
- Create: `libs/raven/core/src/playLink.ts`, `libs/raven/core/src/playLink.test.ts`
- Modify: `libs/raven/core/src/index.ts` (`export * from '@/playLink'`)
- Create: `apps/raven/desktop/src/shared/playLink.ts`, `apps/raven/desktop/src/shared/playLink.test.ts`

**Interfaces:**
- Consumes: `isNumber`, `toQueryString` (core).
- Produces (`@raven/core`):

```ts
export const PLAY_LINK_MAX_NEXT = 100
/** A server's id for a video: a whole number above 0 that fits a double exactly. */
export const isMediaId = (value: unknown): value is number
/** What a link asks the desktop to play: the server's origin, the title, where to start, and what plays after it. */
export type PlayRequest = { origin: string; mediaId: number; at: number; next: number[] }
export const playLinkFor = (request: PlayRequest): string
```

- Produces (`@/shared/playLink`):

```ts
export const MAX_LINK_LENGTH = 4096
export const MAX_ORIGIN_LENGTH = 2048
/** The normalised origin of a server address, or null for anything that is not a bare http or https origin. */
export const serverOriginOf = (raw: string): string | null
export const isServerOrigin = (value: unknown): value is string
export const readPlayLink = (link: string): PlayRequest | null
export const watchUrlFor = ({ origin, mediaId }: { origin: string; mediaId: number }): string
```

Rules:
- `isMediaId`: `isNumber`, `Number.isSafeInteger`, above 0.
- `playLinkFor` gives `raven://play?` + `toQueryString({ server: origin, media: String(mediaId), at: String(Math.max(0, Math.floor(at))) })`, plus `&next=` with the first `PLAY_LINK_MAX_NEXT` ids joined by `,` (encoded by `toQueryString`) only when `next` is not empty.
- `serverOriginOf` trims; refuses more than `MAX_ORIGIN_LENGTH` characters, anything `URL.canParse` refuses, a protocol other than `http:` or `https:`, a raw string containing `@`, `?`, `#`, any whitespace or control character inside it, a path other than nothing or one `/` after the host (`https://x/watch` and `https://x/./` are refused), and an empty hostname. It returns `new URL(raw).origin`: lower case, punycode, default port dropped, IPv6 bracketed. `isServerOrigin` is `isString(value) && serverOriginOf(value) === value`.
- `readPlayLink` trims and refuses more than `MAX_LINK_LENGTH`. Two forms, everything else is `null`:
  - `raven://play?...`: protocol `raven:`, host `play`, path `''` or `/`, no hash; the keys are only `server`, `media`, `at`, `next`, each at most once; `server` through `serverOriginOf`; `media` matches `/^[1-9]\d{0,15}$/` and passes `isMediaId`; `at` absent is 0, else matches `/^\d+(\.\d+)?$/` and is finite; `next` absent or `''` is `[]`, else split on `,`, each a media id as above, at most `PLAY_LINK_MAX_NEXT`.
  - A watch page: protocol `http:` or `https:`, no username or password, path `/^\/watch\/([1-9]\d{0,15})\/?$/`; the origin is `url.origin`; query and hash are ignored (Ruling 9); `at` 0, `next` `[]`.
- `watchUrlFor` is `` `${origin}/watch/${mediaId}` ``.

- [ ] **Step 1: Write the failing tests.**
  - `playLink.test.ts` (core): `isMediaId` accepts 1 and 9007199254740991, rejects 0, -1, 1.5, `NaN`, `'1'`, 2 ** 53; `playLinkFor({ origin: 'https://raven.example', mediaId: 7, at: 12.9, next: [8, 9] })` equals `'raven://play?server=https%3A%2F%2Fraven.example&media=7&at=12&next=8%2C9'`; with `next: []` there is no `next` key; with 150 ids it carries the first 100; a negative `at` writes `at=0`.
  - `playLink.test.ts` (desktop), `serverOriginOf` accepted (input, output): `'https://raven.example.ts.net'` same; `'https://raven.example.ts.net/'` without the slash; `'  HTTPS://Raven.Example.TS.net  '` lower case; `'http://127.0.0.1:8080'`; `'http://[::1]:3000'`; `'http://localhost:3000'`; `'https://raven.example:443'` gives `'https://raven.example'`; `'https://rāven.example'` gives a value starting `'https://xn--'`. Refused: `'ftp://x'`, `'javascript:alert(1)'`, `'file:///etc/passwd'`, `'raven://play'`, `'data:text/html,x'`, `'https://user:pw@raven.example'`, `'https://@raven.example'`, `'https://raven.example/watch'`, `'https://raven.example/./'`, `'https://raven.example/?a=1'`, `'https://raven.example?'`, `'https://raven.example#x'`, `'https://raven.example\n.evil'`, `'https://'`, `''`, `'https://' + 'a'.repeat(2050)`.
  - `readPlayLink`: the round trip `readPlayLink(playLinkFor(request))` equals `{ ...request, at: Math.floor(request.at) }` for two requests (one with `next`, one without); `'raven://play?server=https%3A%2F%2Fraven.example&media=7'` gives `at: 0, next: []`; `at=12.5` keeps 12.5; `'https://raven.example/watch/7'`, `'https://raven.example/watch/7/'` and `'https://raven.example/watch/7?t=30#x'` give `{ origin: 'https://raven.example', mediaId: 7, at: 0, next: [] }`. Refused, one `it` each: `media=0`, `media=-3`, `media=1.5`, `media=abc`, missing `media`, missing `server`, `server=javascript%3Aalert(1)`, `server=https%3A%2F%2Fu%3Ap%40x`, `server=https%3A%2F%2Fx%2Fpath`, `at=-1`, `at=NaN`, `at=1e3`, `next=1,,2`, `next=1,x`, 101 `next` ids, a repeated `media`, an unknown key `url=https://x`, `raven://open?...`, `raven://play/x?...`, a link of 5,000 characters, `'https://u:p@raven.example/watch/7'`, `'https://raven.example/watch/7/edit'`, `'not a link'`.
  - `watchUrlFor({ origin: 'http://[::1]:3000', mediaId: 4 })` is `'http://[::1]:3000/watch/4'`.
- [ ] **Step 2: Run to verify they fail.** `bunx nx run-many -t test -p @raven/core @raven/desktop`.
- [ ] **Step 3: Implement** both modules and the core re-export.
- [ ] **Step 4: Verify** with the Global Constraints command.
- [ ] **Step 5: Commit** `MAE: read and write raven play links`.

---

### Task 2: Servers in the desktop config

**Files:**
- Modify: `apps/raven/desktop/src/main/desktopConfig.ts`, `src/main/desktopConfig.test.ts`
- Create: `apps/raven/desktop/src/main/servers/serverList.ts`, `src/main/servers/serverList.test.ts`
- Modify: `apps/raven/desktop/src/main/main.ts` (load with `loadConfig`)

**Interfaces:**
- Consumes: `isServerOrigin` (Task 1), `isOpaqueId` (`@/shared/protocol`), `loadJson`, `JsonStore`, `StateFs` (`@/main/stateStore`).
- Produces (`@/main/desktopConfig`):

```ts
export const isServerEntry = object({ id: isOpaqueId, origin: isServerOrigin, name: isString, addedAt: isNumber })
export type ServerEntry = Infer<typeof isServerEntry>
export const isDesktopConfig = object({ version: oneOf([2]), output: isOutputSettings, servers: listOf(isServerEntry) })
export type DesktopConfig = Infer<typeof isDesktopConfig>
export const isStoredConfig = union(object({ version: oneOf([1]), output: isOutputSettings }), isDesktopConfig)
export const EMPTY_CONFIG: DesktopConfig // { version: 2, output: DEFAULT_OUTPUT_SETTINGS, servers: [] }
export const upgradeConfig = (stored: Infer<typeof isStoredConfig>): DesktopConfig
export const loadConfig = ({ fs, file, now }: { fs: StateFs; file: string; now: () => number }): Promise<DesktopConfig>
// kept: CONFIG_FILE, ConfigStore, setOutput, pickOutput
```

- Produces (`@/main/servers/serverList`):

```ts
export const SERVERS_CAP = 20
export const NAME_MAX = 80
export const cleanName = (name: string): string | null
export const nameFor = (origin: string): string
export const serverById = (config: DesktopConfig, { serverId }: { serverId: string }): ServerEntry | null
export const serverByOrigin = (config: DesktopConfig, { origin }: { origin: string }): ServerEntry | null
export type AddOutcome = { ok: true; config: DesktopConfig; server: ServerEntry } | { ok: false; reason: 'full' }
export const addServer = (config: DesktopConfig, { id, origin, at }: { id: string; origin: string; at: number }): AddOutcome
export const renameServer = (config: DesktopConfig, { serverId, name }: { serverId: string; name: string }): DesktopConfig | null
export const removeServer = (config: DesktopConfig, { serverId }: { serverId: string }): DesktopConfig
```

Rules: `upgradeConfig` turns version 1 into version 2 with `servers: []` and the output through `pickOutput`; a version 2 file keeps its first 20 servers whose `id` and `origin` were not seen before, each rebuilt from its four fields. `loadConfig` is `loadJson({ guard: isStoredConfig, empty: EMPTY_CONFIG })` then `upgradeConfig` (a corrupt file is still renamed aside by `loadJson`). `cleanName` trims and collapses inner whitespace to one space; `null` when the result is empty, longer than `NAME_MAX`, or holds a control character (`/\p{Cc}/u`). `nameFor` is `new URL(origin).host`. `addServer` with an origin already stored returns `ok` with that server and the config unchanged; at `SERVERS_CAP` it is `{ ok: false, reason: 'full' }`; else appends `{ id, origin, name: nameFor(origin), addedAt: at }`. `renameServer` is `null` for an unknown id or a name `cleanName` refuses. Reducers never mutate their input.

- [ ] **Step 1: Write the failing tests.**
  - `desktopConfig.test.ts`: the existing tests updated to version 2; `upgradeConfig({ version: 1, output })` is `{ version: 2, output, servers: [] }`; a version 2 config with 22 servers, two sharing an origin and two sharing an id, upgrades to 20 unique ones in order; an entry with an extra field (built as a variable) comes back with exactly four keys; `isServerEntry` rejects `origin: 'https://x/path'`, `id: '../x'`; `loadConfig` over the fake `StateFs` reads a version 1 file as version 2 and renames a truncated one to `desktop-config.json.corrupt-1700000000000`.
  - `serverList.test.ts`: `cleanName('  Vhagar   NAS ')` is `'Vhagar NAS'`; `''`, `'   '`, 81 characters and `'a\u0007b'` are `null`; `nameFor('https://raven.example.ts.net')` is `'raven.example.ts.net'`, `nameFor('http://127.0.0.1:8080')` is `'127.0.0.1:8080'`; `addServer` twice with the same origin keeps one entry and returns the first id; the twenty-first origin is `full`; `renameServer` of an unknown id is `null`; `removeServer` leaves the others in order; no reducer mutates its input (`structuredClone` comparison).
- [ ] **Step 2: Run to verify they fail**, **implement**, and in `main.ts` replace the config's `loadJson(...)` with `loadConfig(...)`.
- [ ] **Step 3: Verify** with the Global Constraints command.
- [ ] **Step 4: Commit** `MAE: keep raven servers in the desktop config`.

---

### Task 3: The allowlist, the cookie header and server calls

**Files:**
- Create under `apps/raven/desktop/src/main/servers/`: `allowlist.ts`, `cookieHeader.ts`, `serverCalls.ts`, each with its `*.test.ts`

**Interfaces:**
- Consumes: `isProgressChange`, `isUnlockRequest`, `isAdminUnlockRequest`, `isLockState`, `isMediaId` (core); `ServerEntry` (Task 2).
- Produces (`@/main/servers/allowlist`):

```ts
export const SERVER_METHODS = ['GET', 'PUT', 'POST'] as const
export type ServerMethod = (typeof SERVER_METHODS)[number]
export const MAX_BODY = 4096
export const MAX_SECRET = 256
export type AllowedCall =
  | { name: 'getMedia'; mediaId: number }
  | { name: 'getTracks'; mediaId: number }
  | { name: 'saveProgress'; mediaId: number; position: number }
  | { name: 'recordPlay'; mediaId: number }
  | { name: 'getLock' }
  | { name: 'unlock'; pin: string }
  | { name: 'getAdminLock' }
  | { name: 'unlockAdmin'; password: string }
export const matchCall = (input: { method: string; path: string; body: string | null }): AllowedCall | null
export const requestFor = (call: AllowedCall): { method: ServerMethod; path: string; body: string | null }
export const isWrite = (call: AllowedCall): boolean
```

- Produces (`@/main/servers/cookieHeader`):

```ts
export const SERVER_COOKIES = ['raven_unlock', 'raven_admin'] as const
export const cookieHeader = (cookies: readonly { name: string; value: string }[]): string | null
```

- Produces (`@/main/servers/serverCalls`):

```ts
export const CALL_TIMEOUT_MS = 10_000
export const MAX_REPLY_CHARS = 1_048_576
export const MAX_IN_FLIGHT = 6
export const CALL_MESSAGES = {
  unknownServer: 'That server is no longer in raven player.',
  offList: 'raven player does not make that call.',
  unreachable: (name: string) => `raven player could not reach ${name}.`,
  tooBig: (name: string) => `${name} sent more than raven player reads.`,
  busy: (name: string) => `raven player is still waiting on ${name}.`,
} as const
export type ServerFetch = (input: {
  url: string; method: ServerMethod; headers: Record<string, string>; body: string | null; timeoutMs: number
}) => Promise<{ status: number; text: () => Promise<string> }>
export const fetchThrough = (fetch: (url: string, init: RequestInit) => Promise<Response>): ServerFetch
export type ServerCallResult = { ok: true; status: number; body: string } | { ok: false; message: string }
export type ServerCalls = {
  call: (input: { serverId: string; call: AllowedCall }) => Promise<ServerCallResult>
  callFromPage: (input: { serverId: string; method: string; path: string; body: string | null }) => Promise<ServerCallResult>
  hasPendingWrites: () => boolean
  settleWrites: () => Promise<void>
}
export const createServerCalls = ({ serverOf, fetchFor, warn }: {
  serverOf: (serverId: string) => ServerEntry | null
  fetchFor: (serverId: string) => ServerFetch
  warn: (message: string) => void
}): ServerCalls
export const probeServer = ({ fetch, origin }: { fetch: ServerFetch; origin: string }): Promise<boolean>
```

Rules:
- **`matchCall`** (spec "What exploration found", the eight calls), each regex anchored, the id `([1-9]\d{0,15})` and `isMediaId`: `GET /api/media/<id>` `getMedia`; `GET /api/media/<id>/tracks` `getTracks`; `PUT /api/media/<id>/progress` `saveProgress`, body JSON passing `isProgressChange`; `POST /api/media/<id>/plays` `recordPlay`; `GET /api/lock` `getLock`; `POST /api/lock/unlock` `unlock`, body passing `isUnlockRequest` with `pin` at most `MAX_SECRET`; `GET /api/admin` `getAdminLock`; `POST /api/admin/unlock` `unlockAdmin`, body passing `isAdminUnlockRequest` with `password` at most `MAX_SECRET`. A body is required exactly for those three and must be `null` for the rest; a body over `MAX_BODY` characters, unparsable JSON, a query string, a fragment, a trailing slash or any other method or path is `null`.
- **`requestFor`** builds the path from the call's fields and the body from only the known field (`JSON.stringify({ position })`, `{ pin }`, `{ password }`), never from what the page sent. `isWrite` is true for `saveProgress` and `recordPlay`.
- **`cookieHeader`** keeps cookies named in `SERVER_COOKIES` whose value matches `/^[A-Za-z0-9._~-]+$/` (a value with `,`, `;`, a space or a line break would split or extend the header), the first of a repeated name, in `SERVER_COOKIES` order: `'Cookie: raven_unlock=a; raven_admin=b'`; `null` when none is left.
- **`fetchThrough`** calls `fetch(url, { method, headers, body: body ?? undefined, redirect: 'error', signal: AbortSignal.timeout(timeoutMs), credentials: 'include' })`.
- **`createServerCalls.call`**: an unknown server is `{ ok: false, message: unknownServer }`; more than `MAX_IN_FLIGHT` calls in flight to one server is `busy(name)`; else `fetchFor(serverId)` with `` `${origin}${path}` `` from `requestFor`, headers `{ accept: 'application/json' }` plus `'content-type': 'application/json'` with a body, `timeoutMs: CALL_TIMEOUT_MS`; a rejection (network, timeout, redirect) is `unreachable(name)` and `warn`ed; a reply text longer than `MAX_REPLY_CHARS` is `tooBig(name)`; else `{ ok: true, status, body }` whatever the status (the page's `ApiClient` reads it). Writes are tracked until they settle.
- **`callFromPage`** runs `matchCall` first; `null` is `{ ok: false, message: offList }` and is `warn`ed with the method and path (never the body).
- **`settleWrites`** resolves once every write in flight at the moment of the call has settled; `hasPendingWrites` is true while any is.
- **`probeServer`** is `true` only for a 200 whose text parses as JSON passing `isLockState`; any rejection or other answer is `false`.

- [ ] **Step 1: Write the failing tests** (a fake `ServerFetch` recording calls, answering from a table, holding a reply on demand, rejecting on demand):
  - `allowlist.test.ts`: one accepted case per call with its exact `AllowedCall`; `requestFor` of each equals the method, the path, and for `saveProgress` with `position: 40` the body `'{"position":40}'`; `matchCall` of a `saveProgress` body `'{"position":40,"extra":"x"}'` gives a call whose `requestFor` body is `'{"position":40}'`. Refused, one `it` each: `GET /api/media/1/location`, `GET /api/media/1/file`, `GET /api/media/1/subtitles/external-0`, `GET /api/media/1/stream`, `DELETE /api/media/1`, `GET /api/libraries`, `POST /api/lock/lock`, `POST /api/admin/lock`, `GET /api/media/0`, `GET /api/media/01`, `GET /api/media/1?x=1`, `GET /api/media/1/`, `GET /api/media/1#x`, `GET /api/media/../admin`, `GET //evil.example/api/lock`, `GET https://evil.example/api/lock`, `get /api/lock`, `GET /api/lock` with a body, `PUT .../progress` with `'{"position":"x"}'`, with no body, with 5,000 characters, `POST /api/lock/unlock` with a 300-character PIN.
  - `cookieHeader.test.ts`: both cookies in either input order give `'Cookie: raven_unlock=a.b; raven_admin=c.d'`; only `raven_admin` gives `'Cookie: raven_admin=c.d'`; an unrelated `session=x` is dropped; a value `'a, b'` or `'a\r\nX: y'` is dropped; none gives `null`.
  - `serverCalls.test.ts`: `fetchThrough` passes `redirect: 'error'` and a signal (a fake `fetch` records its init); `call` for `getMedia` 7 on `https://raven.example` fetches `'https://raven.example/api/media/7'` with `accept: application/json` and no body; a `saveProgress` call sends `content-type`; an unknown server never fetches and answers `unknownServer`; a rejecting fetch answers `unreachable('raven.example')` and warns; a 2 MB text answers `tooBig`; a 500 with `'<html>'` answers `{ ok: true, status: 500, body: '<html>' }`; seven calls held at once: the seventh answers `busy` without fetching; `callFromPage` with `GET /api/media/1/location` answers `offList`, fetches nothing and warns `GET /api/media/1/location`; `hasPendingWrites` is true while a `saveProgress` is held and `settleWrites` resolves only after it is released, while a held `getMedia` does not count; `probeServer` is true for 200 `{"available":true,"unlocked":false}`, false for 200 `'<html>'`, 200 `{"ok":1}`, 404 and a rejection.
- [ ] **Step 2: Run to verify they fail**, **implement**, **verify** with the Global Constraints command.
- [ ] **Step 3: Commit** `MAE: allow eight server calls and nothing else`.

---

### Task 4: Trusting servers and opening links

**Files:**
- Create: `apps/raven/desktop/src/main/servers/serverTrust.ts`, `serverTrust.test.ts`
- Create: `apps/raven/desktop/src/main/servers/linkOpener.ts`, `linkOpener.test.ts`

**Interfaces:**
- Consumes: `serverByOrigin`, `addServer`, `removeServer`, `SERVERS_CAP`, `ConfigStore`, `ServerEntry` (Task 2); `readPlayLink`, `PlayRequest`, `isMediaId` (Task 1).
- Produces (`@/shared/protocol`, added here because the opener replies with it): `isServerTarget = object({ serverId: isOpaqueId, mediaId: isMediaId, at: isNumber, next: listOf(isMediaId) })`, `type ServerTarget`, and `isDesktopReply` gains `object({ type: oneOf(['playServer']), target: isServerTarget })`. The exhaustive switches over replies gain a `playServer` case: `eventForOpen` (`@/main/openBatch`) returns `null` and the Shell's `applyReply` does nothing, until Task 5 turns it into an event and a navigation.
- Produces (`@/main/servers/serverTrust`):

```ts
export const TRUST_MESSAGES = {
  prompt: (origin: string) => `Add the raven server at ${origin}?`,
  detail: 'raven player plays titles from it and keeps its sign-in for this server alone. Add only servers you trust.',
  full: 'raven player keeps at most 20 servers. Remove one in Settings first.',
  unreachable: (origin: string) => `No raven server answered at ${origin}.`,
  busy: 'raven player is already asking about another server.',
} as const
export type TrustOutcome =
  | { kind: 'trusted'; server: ServerEntry; isNew: boolean }
  | { kind: 'declined' }
  | { kind: 'full' }
  | { kind: 'busy' }
  | { kind: 'unreachable'; origin: string }
export type ServerTrust = {
  trust: (input: { origin: string; from: 'link' | 'app' }) => Promise<TrustOutcome>
  remove: (serverId: string) => Promise<boolean>
}
export const createServerTrust = (deps: {
  config: ConfigStore
  confirm: (origin: string) => Promise<boolean>
  probe: (input: { serverId: string; origin: string }) => Promise<boolean>
  forget: (serverId: string) => Promise<void>
  onRemoved: (serverId: string) => void
  newId: () => string
  now: () => number
  warn: (message: string) => void
}): ServerTrust
```

- Produces (`@/main/servers/linkOpener`):

```ts
export const LINK_MESSAGES = {
  unreadable: 'raven player could not read that link. It opens raven://play links and raven watch pages.',
} as const
export const replyForTrust = ({ outcome, request }: { outcome: TrustOutcome; request: PlayRequest }): DesktopReply
export type LinkOpener = {
  open: (input: { link: string; from: 'link' | 'app' }) => Promise<DesktopReply>
  openBatch: (links: readonly string[]) => Promise<DesktopReply>
}
export const createLinkOpener = ({ trust, warn }: { trust: Pick<ServerTrust, 'trust'>; warn: (message: string) => void }): LinkOpener
```

Rules (spec "Server titles", Rulings 3, 8 and 15):
- `trust`: an origin already stored is `trusted` with `isNew: false`, and neither `confirm` nor `probe` runs. At `SERVERS_CAP` it is `full` before any prompt. While another `trust` is between `confirm` and its end it is `busy`. From `'link'`, an origin declined from a link earlier this session is `declined` without a prompt. Else `confirm(origin)`; `false` is `declined` (remembered when from a link) and nothing else runs. `true`: `serverId = newId()`, `probe({ serverId, origin })` (a throw counts as `false`); `false` calls `forget(serverId)` and is `unreachable`; `true` then `addServer` (`full` if the list filled meanwhile, which also forgets), `config.update`, `trusted` with `isNew: true`.
- `remove`: an unknown id is `false`; else `config.update(removeServer)`, `await forget(serverId)` (a rejection is `warn`ed), `onRemoved(serverId)`, `true`.
- `replyForTrust`: `trusted` is `{ type: 'playServer', target: { serverId: server.id, mediaId, at, next } }`; `declined` is `done`; `full`, `busy`, `unreachable` are `refused` with their message.
- `open`: `readPlayLink(link)`; `null` is refused `LINK_MESSAGES.unreadable` (and `warn`ed with at most the first 100 characters); else `trust({ origin, from })` and `replyForTrust`.
- `openBatch` opens the first link with `from: 'link'` and `warn`s how many more it dropped; an empty batch is `done`.

- [ ] **Step 1: Write the failing tests** with a real config store over the fake `StateFs`, a `confirm` the test resolves by hand, a recording `probe` and `forget`, sequential ids:
  - a stored origin is trusted with no prompt and no probe;
  - an unknown origin prompts once with that origin; declining returns `declined`, `probe` and `forget` never ran, the config is unchanged;
  - after a decline from a link, a second link for that origin does not prompt; the same origin from `'app'` prompts again;
  - accepting probes with the new id and the origin, stores `{ id, origin, name: 'raven.example', addedAt }` and returns `isNew: true`;
  - a probe that resolves `false` or throws: `forget` ran with that id, `unreachable`, nothing stored;
  - a second `trust` while the first waits on `confirm` is `busy` and does not prompt;
  - with 20 servers stored, an unknown origin is `full` and does not prompt;
  - `remove` of a stored id updates the config, then `forget`, then `onRemoved`, in that order, and returns `true`; an unknown id returns `false` and calls nothing; a rejecting `forget` is warned and `onRemoved` still runs;
  - `open('raven://play?server=https%3A%2F%2Fraven.example&media=7&at=30&next=8')` with an accepting fake trust replies `{ type: 'playServer', target: { serverId, mediaId: 7, at: 30, next: [8] } }`; `open('javascript:alert(1)')` replies refused `unreadable` and `trust` never ran; `full`, `busy`, `unreachable` reply refused with `TRUST_MESSAGES`; `openBatch` of three links trusts only the first and warns `2`; `openBatch([])` is `done`.
- [ ] **Step 2: Run to verify they fail**, **implement**, **verify** with the Global Constraints command.
- [ ] **Step 3: Commit** `MAE: trust servers only after a native yes`.

---

### Task 5: Desktop protocol, service and recents for server titles

**Files:**
- Modify: `apps/raven/desktop/src/shared/protocol.ts`, `src/shared/protocol.test.ts`
- Modify: `apps/raven/desktop/src/main/playerState.ts`, `src/main/playerState.test.ts`
- Modify: `apps/raven/desktop/src/main/desktopService.ts`, `src/main/desktopService.test.ts`
- Modify: `apps/raven/desktop/src/main/openBatch.ts`, `openBatch.test.ts` (`eventForOpen`), `src/renderer/Shell/Shell.tsx` (exhaustive cases), `src/main/main.ts` (new service deps, wired in Task 12; pass working stand-ins here: see Step 3)

**Interfaces:**
- Consumes: Tasks 1 to 4 (`isMediaId`, `serverOriginOf`, `watchUrlFor`, `ServerEntry`, `cleanName`, `renameServer`, `serverById`, `ServerCalls`, `ServerTrust`, `LinkOpener`, `TRUST_MESSAGES`, `CALL_MESSAGES`).
- Produces (`@/shared/protocol`), additions:

```ts
export const isServerMethod = oneOf(['GET', 'PUT', 'POST'])
export const isServerView = object({ serverId: isOpaqueId, origin: isString, name: isString })
export type ServerView = Infer<typeof isServerView>
// isDesktopRequest gains:
//   object({ type: oneOf(['serverCall']), serverId: isOpaqueId, method: isServerMethod, path: isString, body: nullable(isString) })
//   object({ type: oneOf(['listServers']) })
//   object({ type: oneOf(['addServer']), origin: isString })
//   object({ type: oneOf(['renameServer']), serverId: isOpaqueId, name: isString })
//   object({ type: oneOf(['removeServer']), serverId: isOpaqueId })
//   object({ type: oneOf(['openLink']), link: isString })
//   object({ type: oneOf(['openInBrowser']), serverId: isOpaqueId, mediaId: isMediaId })
//   object({ type: oneOf(['noteServerTitle']), serverId: isOpaqueId, mediaId: isMediaId, label: isString, watched: nullable(isNumber) })
// isDesktopReply gains:
//   object({ type: oneOf(['serverReply']), status: isNumber, body: isString })
//   object({ type: oneOf(['serverUnreachable']), message: isString })
//   object({ type: oneOf(['servers']), servers: listOf(isServerView) })
// isDesktopEvent gains:
//   object({ type: oneOf(['playServer']), target: isServerTarget })
```

- Produces (`@/main/playerState`): `isRecentEntry` becomes `union(fileRecent, serverRecent)` where `serverRecent = object({ kind: oneOf(['server']), serverId: isOpaqueId, mediaId: isMediaId, label: isString, watched: nullable(isNumber), openedAt: isNumber })` (version stays 1: every version 1 file still passes); `recentKey(entry: RecentEntry): string` (`file:<path>` or `server:<serverId>:<mediaId>`); `noteServerRecent(state, { serverId, mediaId, label, watched, at })`; `removeRecentByKey(state, { key })`; `removeServerRecents(state, { serverId })`. `addRecent` (file) and the 50 cap dedupe by `recentKey`.
- Produces (`@/main/desktopService`): `MESSAGES` gains `badServer: 'That is not a server address raven player can use. Use one like https://raven.example.ts.net.'`, `badName: 'A server name needs 1 to 80 characters.'`, `noBrowser: 'raven player could not open your browser.'`; `DesktopServiceDeps` gains `config: ConfigStore`, `serverCalls: Pick<ServerCalls, 'callFromPage'>`, `trust: ServerTrust`, `links: LinkOpener`, `openExternal: (url: string) => Promise<void>`; `DesktopService` gains `openLinks: (links: readonly string[]) => Promise<DesktopReply>` (`links.openBatch`).

Behaviour:
- `serverCall`: `callFromPage`; `ok` is `{ type: 'serverReply', status, body }`, else `{ type: 'serverUnreachable', message }`.
- `listServers`: `servers` as `ServerView`s in stored order.
- `addServer`: `serverOriginOf(origin)` or refused `badServer`; then `trust({ origin, from: 'app' })`: `trusted` answers `servers`, `declined` answers `done`, `full`, `busy` and `unreachable` are refused with their `TRUST_MESSAGES`.
- `renameServer`: `cleanName` or refused `badName`; unknown id refused `CALL_MESSAGES.unknownServer`; else `servers`.
- `removeServer`: `trust.remove`, `store.update(removeServerRecents)`, then `servers` (an unknown id still answers `servers`).
- `openLink`: `links.open({ link, from: 'app' })`.
- `openInBrowser`: unknown server refused `unknownServer`; else `openExternal(watchUrlFor({ origin, mediaId }))`, `done`; a rejection is refused `noBrowser`.
- `noteServerTitle`: unknown server refused; else `store.update(noteServerRecent(...))` with `watched` clamped to 0..1, `done`.
- `listRecents`: a server recent is `{ recentId, label, from: server.name, watched }`; one whose server is gone is left out; ids come from a session map keyed by `recentKey`.
- `openRecent` of a server recent: unknown server refused `unknownServer`; else `{ type: 'playServer', target: { serverId, mediaId, at: 0, next: [] } }`.
- `removeRecent` and `clearRecents` work for both kinds.
- `eventForOpen`: `playServer` now becomes `{ type: 'playServer', target }`; `servers`, `serverReply`, `serverUnreachable` give `null`. The Shell's `onEvent` and `applyReply` handle `playServer` by navigating to `` `/server/${serverId}/${mediaId}` `` with state `{ at, next }`, replacing when the path starts with `/play/` or `/server/` (the route arrives in Task 8); the three new replies do nothing.

- [ ] **Step 1: Write the failing tests.**
  - `protocol.test.ts`: one valid value per new variant; rejected: `serverCall` with `method: 'DELETE'`, with `serverId: 'vhagar'`, with `body: 3`; `openInBrowser` with `mediaId: 0` and `'7'`; `noteServerTitle` without `watched`; a `playServer` event with `next: [1.5]`; `isServerTarget` with `at: 'x'`.
  - `playerState.test.ts`: a version 1 file with only file recents still passes `isPlayerState`; `noteServerRecent` twice for the same title keeps one entry, newest first, with the second `label` and `watched`; file and server recents share the 50 cap; `removeServerRecents` drops only that server's entries; `recentKey` of each kind.
  - `desktopService.test.ts` (fakes for the new deps): `serverCall` maps both results; `addServer` with `'https://raven.example/x'` is refused `badServer` and `trust` never ran; with `'https://raven.example/'` it called `trust` with `{ origin: 'https://raven.example', from: 'app' }`; `renameServer` to `''` is refused `badName`; `removeServer` removes that server's recents from `listRecents`; `openInBrowser` called `openExternal('https://raven.example/watch/7')`, and for an unknown id it did not; `noteServerTitle` then `listRecents` lists `{ label: 'Dune', from: 'raven.example', watched: 0.5 }` with no `/` in `recentId`; `openRecent` of it replies `playServer` with `at: 0, next: []`; after the server is removed from the config, `openRecent` of a stale id is refused; `openLinks` forwards to `openBatch`.
  - `openBatch.test.ts`: `eventForOpen` of a `playServer` reply is the event; of `servers` is `null`.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement.** In `main.ts`, until Task 12 wires them, pass `config` (the store already made), `serverCalls` and `trust` from `createServerCalls` and `createServerTrust` with `fetchFor` and `probe` that reject with `Error('Server titles arrive in a later step.')`, `confirm: async () => false`, `forget: async () => undefined`, `onRemoved: () => undefined`, `links` from `createLinkOpener`, and `openExternal: shell.openExternal`. The link batch keeps its P4 notice until Task 12.
- [ ] **Step 4: Verify** with the Global Constraints command.
- [ ] **Step 5: Commit** `MAE: answer server, link and recent requests in the desktop service`.

---

### Task 6: `@raven/ui` seams for a handoff and a server host

**Files:**
- Modify: `libs/raven/core/src/player.ts` (`export type PlayerErrorReason = Infer<typeof isPlayerErrorReason>`)
- Modify: `libs/raven/ui/src/components/Player/PlayerServices.tsx`, `Unplayable.tsx`, `SettingsMenu.tsx`, `SettingsMenu.module.scss`, `Stage.tsx` (`PlayerChrome`), `useNativeEngine.tsx`
- Modify: `libs/raven/ui/src/stores/playerPrefs.ts`, `libs/raven/ui/src/index.ts`, `libs/raven/ui/README.md`
- Test: `libs/raven/ui/src/components/Player/playerEngine.test.tsx`, `nativeEngine.test.tsx` (add cases)

**Interfaces:**
- Produces:

```ts
// PlayerServices.tsx, all optional
export type Handoff = { label: string; run: (at: number) => void }
export type PlayerServices = {
  // ...P4 and P5 fields
  escape: { label: string; run: () => void; icon?: IconName } | null
  /** Under Unplayable's escape. Left out: the VLC and IINA hint; null: none. */
  escapeHint?: string | null
  /** Plays this title in another player: Unplayable's first action, and the settings menu's last. */
  handoff?: Handoff
  /** The native engine's error, before Unplayable shows it, for a host that can recover (a relocked library). */
  onEngineError?: (error: { reason: PlayerErrorReason; message: string }) => void
}
// playerPrefs.ts
// PlayerPrefs gains: opensInRavenPlayer: boolean (default false, persisted under 'raven-player')
//                    setOpensInRavenPlayer: (isOn: boolean) => void
```

- Exported from the root entry: `type Handoff`.

Behaviour:
- `Unplayable`: with `handoff`, a `<Button tone="primary" icon="play">` with `handoff.label` comes first and calls `handoff.run(title.resumeAt)`; "Try playing anyway" then renders without `tone="primary"` (Ruling 17). The escape button's icon is `escape.icon ?? 'copy'`. The hint paragraph shows `escapeHint === undefined ? <today's VLC and IINA text> : escapeHint`, only with an escape and a non-null hint. With no new field set the markup is exactly today's.
- `SettingsMenu` gains optional `onHandoff?: () => void` and `handoffLabel?: string`; when both are given, a `<button type="button">` with that label (icon `play`) sits under the groups, above the mode line, styled with a new `.handoff` class (grid, tokens, `:focus-visible` with `--focus-ring`).
- `PlayerChrome` passes them when `services.handoff` exists: the click calls `actions.pause()`, then `handoff.run(engine.position.current)`, then closes the menu.
- `useNativeEngine`: on an `error` event, `onEngineError?.({ reason: event.reason, message: event.message })` runs before `fail`.
- README: hosts may pass `handoff`, `escapeHint`, `escape.icon` and `onEngineError`; the web passes `handoff` only while "Open videos in raven player" is on.

- [ ] **Step 1: Write the failing tests.**
  - "offers the host's handoff first on Unplayable": services with `handoff: { label: 'Open in raven player', run }`, `escape: { label: 'Copy file link', run }`, an html file source that fails; the buttons in order are `Open in raven player`, then `Copy file link`; clicking the first calls `run` with `title.resumeAt`.
  - "keeps Unplayable as it was without a handoff": the same without `handoff`: `Copy file link` has the copy icon (`data-icon="copy"`) and the VLC hint shows; with `escape.icon: 'globe'` and `escapeHint: null` the icon is `globe` and no hint shows.
  - "offers the handoff in the settings menu, paused, at the current position": a fake handle at `position.current = 42.7`, open Settings, click `Open in raven player`: `actions.pause` called before `run`, `run` got `42.7`, the menu closed; without `handoff` the menu has no such button.
  - `nativeEngine.test.tsx` "tells the host about an engine error first": emit `{ type: 'error', reason: 'locked', message: 'Locked again' }`: `onEngineError` got it, then Unplayable shows `Locked again`.
  - "remembers whether to open videos in raven player": `usePlayerPrefs.getState().opensInRavenPlayer` is `false`; after `setOpensInRavenPlayer(true)`, `localStorage.getItem('raven-player')` holds `"opensInRavenPlayer":true`.
- [ ] **Step 2: Run to verify they fail.** `bunx nx run @raven/ui:test`.
- [ ] **Step 3: Implement**, then **verify** with the Global Constraints command; `@raven/web` passes with no test edited.
- [ ] **Step 4: Commit** `MAE: let player hosts hand a title off and hear engine errors`.

---

### Task 7: `UnlockDialog` moves to `@raven/ui`

**Files:**
- Move (`git mv`): `apps/raven/web/src/components/UnlockDialog/UnlockDialog.tsx` and `UnlockDialog.module.scss` to `libs/raven/ui/src/components/UnlockDialog/`; `apps/raven/web/src/components/UnlockDialog/UnlockDialog.test.tsx` to `apps/raven/web/src/components/PinPrompt/PinPrompt.test.tsx`
- Create: `apps/raven/web/src/components/PinPrompt/PinPrompt.tsx`
- Create: `libs/raven/ui/src/components/UnlockDialog/UnlockDialog.test.tsx`
- Modify: `libs/raven/ui/src/index.ts`, `libs/raven/ui/README.md`, `apps/raven/web/src/AppRoutes.tsx`

**Interfaces:**
- Produces (`@raven/ui`):

```ts
export type UnlockSecret = 'pin' | 'adminPassword'
export const UnlockDialog = ({ secret, hint, unlock, onUnlocked, onClose }: {
  secret: UnlockSecret
  /** Under the title. Left out: the web's own words for the secret. */
  hint?: string
  /** Rejects with the server's reason, which the dialog shows. */
  unlock: (entered: string) => Promise<unknown>
  onUnlocked: () => void | Promise<unknown>
  onClose: () => void
}) => JSX.Element
```

- Produces (`@/components/PinPrompt/PinPrompt` in web): `PinPrompt` (no props), today's `UnlockDialog` behaviour: open while `useUnlockPrompt` says so, `unlock: api.unlock`, `onUnlocked: () => queryClient.invalidateQueries()`, `onClose: useUnlockPrompt.close`.

Behaviour: the dialog keeps today's markup, classes and `showModal` on mount. `pin`: title `Locked library`, label `PIN`, `type="password"`, `inputMode="numeric"`, default hint `Enter the PIN to open the locked libraries in this browser.`; `adminPassword`: title `Admin lock`, label `Admin password`, `type="password"`, no `inputMode`, default hint `Enter the admin password to see the locked libraries in this browser.`. Both `autoComplete="off"`. Submit runs `unlock` (through `useMutation`, as today): success closes the dialog (`dialog.close()`, which fires `onClose`) after `onUnlocked`; failure clears the field and shows the error's message in `role="alert"`; Unlock is disabled while empty or pending. Exported after `Button` in `index.ts`, with `type UnlockSecret`.

- [ ] **Step 1: Move.** `git mv` the three files as listed and make the smallest change that builds: the moved component takes `unlock`, `onUnlocked` and `onClose` in place of its imports of `@/lib/api`, `useQueryClient` and `@/stores/unlockPrompt` (PIN only, today's words), `PinPrompt.tsx` passes them, `AppRoutes.tsx` renders `<PinPrompt />`, and the moved web test changes only its import and rendered element from `UnlockDialog` to `PinPrompt`. Export `UnlockDialog` from `@raven/ui`. Run the Global Constraints command: green. Commit `MAE: move the unlock dialog into the shared UI` (the files keep most of their lines, so `git log --follow` follows them).
- [ ] **Step 2: Write the failing tests** in `libs/raven/ui/src/components/UnlockDialog/UnlockDialog.test.tsx` (a `QueryClientProvider` in the test render) for `secret` and `hint`:
  - "asks for the PIN by default words": `secret: 'pin'`: heading `Locked library`, field `PIN` with `inputmode="numeric"`, the default hint;
  - "uses the host's hint": `hint: 'Enter the PIN for Vhagar.'` shows it instead;
  - "asks for the admin password": `secret: 'adminPassword'`: heading `Admin lock`, field `Admin password`, no `inputmode`;
  - "says a wrong secret is wrong and clears it": `unlock` rejecting `ApiError({ status: 401, message: 'That PIN is not right.' })`: alert text, empty field, `onUnlocked` not called;
  - "says when the server wants a pause": rejecting `Too many wrong PINs. Try again in a minute.` shows it;
  - "unlocks and closes": resolving: `unlock` got `'3001'`, `onUnlocked` then `onClose` ran, no dialog;
  - "keeps Unlock off until something is typed, and while it waits": disabled when empty; with a held promise, disabled after submit;
  - "Cancel closes without unlocking".
- [ ] **Step 3: Run to verify they fail**, **implement** `secret` and `hint`, **verify** with the Global Constraints command (`@raven/web`'s moved test passes with only its import and name changed; UI coverage floors hold).
- [ ] **Step 4: Commit** `MAE: let hosts ask for the PIN or the admin password`.

---

### Task 8: The renderer plays server titles

**Files:**
- Create: `apps/raven/desktop/src/shared/test/mediaItem.ts` (a full `MediaItem` fixture, `mediaItemFor(overrides)`, checked with `isMediaItem` in its own test)
- Create: `apps/raven/desktop/src/renderer/desktop/serverApi.ts`, `serverApi.test.ts`
- Create: `apps/raven/desktop/src/renderer/ServerPage/ServerPage.tsx`, `ServerPage.module.scss`, `ServerPage.test.tsx`, `serverServices.ts`, `serverServices.test.ts`
- Create: `apps/raven/desktop/src/renderer/PlayPage/useChosenEngine.ts` (moved out of `PlayPage.tsx`), `src/renderer/PlayPage/NativePlaying.tsx` (moved out, taking a `PlayerSource`)
- Modify: `apps/raven/desktop/src/renderer/PlayPage/PlayPage.tsx`, `src/renderer/routes.tsx`, `src/renderer/Shell/Shell.test.tsx`, `apps/raven/desktop/.oxlintrc.json` (test override gains `src/shared/test/**`)

**Interfaces:**
- Consumes: Task 5's protocol; Task 6's `handoff`-free services, `escape.icon`, `escapeHint`, `onEngineError`; Task 7's `UnlockDialog`; `createApiClient`, `ApiError`, `isLockedError`, `mediaLabel`, `MediaItem`, `FetchLike`, `FetchResponse` (core); `playerActionFor` (`@/renderer/PlayPage/playerServices`).
- Produces:

```ts
// @/renderer/desktop/serverApi
export class ServerUnreachable extends Error {}
export const bridgedFetch = ({ client, serverId }: { client: DesktopClient; serverId: string }): FetchLike
export const serverApiFor = ({ client, serverId }: { client: DesktopClient; serverId: string }): ApiClient
export const SERVERS_KEY = ['desktop', 'servers'] as const
export const useServers = (): UseQueryResult<ServerView[]>
// @/renderer/ServerPage/serverServices
export const isServerPlayState = object({ at: isNumber, next: listOf(isMediaId) })
export const resumeAtFor = ({ at, media }: { at: number; media: MediaItem }): number
export const SERVER_COPY = {
  pinHint: (name: string) => `Enter the PIN to open ${name}'s locked libraries in raven player. raven player asks again after it restarts.`,
  adminHint: (name: string) => `${name} hides its locked libraries while its admin lock is on. Enter the admin password to see them in raven player.`,
  gone: (name: string) => `This title is not on ${name} any more.`,
  unknownServer: 'That server is no longer in raven player.',
  inBrowser: (name: string) => `raven player's video engine did not start, so this title opened from ${name} in your browser.`,
  engineStopped: "raven player's video engine stopped. Open this title in your browser to keep watching.",
  unplayable: (name: string) => `raven player could not play this title from ${name}.`,
} as const
export const serverServicesFor = (input: {
  media: MediaItem; server: ServerView; api: ApiClient; client: DesktopClient; menu: MenuHub
  at: number; next: { mediaId: number; label: string; rest: number[] } | null
  /** The page's ref: `progress.save` writes each saved position here, for the relock path. */
  lastSaved: { current: number }
  onEngineError: PlayerServices['onEngineError']
}): PlayerServices
// @/renderer/ServerPage/ServerPage
export const ServerRoute: () => JSX.Element
```

Behaviour:
- **`bridgedFetch`**: the URL is the path (`baseUrl` is `''`); `init.method ?? 'GET'` must pass `isServerMethod`, else it throws `ServerUnreachable('raven player does not make that call.')` without a request; sends `{ type: 'serverCall', serverId, method, path, body: init.body ?? null }`; `serverReply` becomes a `FetchResponse` (`ok` for 200 to 299, `statusText: ''`, `json` parses the body and rejects on bad JSON, `text` the body); `serverUnreachable` and `refused` throw `ServerUnreachable(message)`; anything else throws `ServerUnreachable('raven player could not read its own reply.')`.
- **`resumeAtFor`**: `from = at > 0 ? at : media.position`; `from` when above 0 and more than 10 s before a known duration, else 0 (the web's rule).
- **`serverServicesFor`**: `title` `{ label: mediaLabel(media), duration: media.duration, resumeAt: resumeAtFor(...), backTo: '/', next }` with `next` `{ to: '/server/<serverId>/<mediaId>', state: { at: 0, next: rest }, label }` or `null`; `progress.started` runs `api.recordPlay(media.id)`, `save(position)` runs `api.saveProgress({ id, position })` and sets `lastSaved.current`, `duration` remembers the length, `left(position)` sends `noteServerTitle` with `watched` `position / length` (or `null`); every call handles its rejection; `posterUrl: null`; `escape: { label: 'Open in browser', icon: 'globe', run: send openInBrowser }`; `escapeHint: null`; `hostActions` through `playerActionFor`; `chrome.shown` sends `windowButtons`; `unplayableNote: SERVER_COPY.unplayable(server.name)`; no `trackPicks` (server titles follow the language preferences, spec "State that persists"); `onEngineError` passed through.
- **`ServerRoute`** reads `serverId` (`isOpaqueId`) and `mediaId` (`/^[1-9]\d{0,15}$/` then `isMediaId`) from the params, else the refused view without a request; `at` and `next` from `location.state` through `isServerPlayState` (default `{ at: 0, next: [] }`); renders `ServerPage` keyed by `` `${serverId}:${mediaId}` ``.
- **`ServerPage`** (states, each its own small component; the refused view reuses PlayPage's `Refused` layout, exported from `PlayPage.tsx`):
  - `useServers()` pending: the waiting view; the server missing: refused `SERVER_COPY.unknownServer`.
  - the chosen engine (`useChosenEngine`) `unavailable`, or lost mid-play: `BrowserFallback`: sends `openInBrowser` once per mount (a ref, so StrictMode sends one), shows `SERVER_COPY.inBrowser(name)` (or `engineStopped` after a loss) in a `<main>` with Home and `Open in browser` buttons.
  - `native`: `useQuery({ queryKey: ['desktop', 'server', serverId, 'media', mediaId], queryFn: () => api.getMedia(mediaId), retry: false, staleTime: Infinity, gcTime: 0 })`. Errors: `isLockedError` shows `UnlockDialog` `secret: 'pin'`, `hint: pinHint(name)`, `unlock: (pin) => api.unlock(pin)`; an `ApiError` 404 runs `api.getAdminLock()` (a second query, only then) and with `{ state: 'on', available: true }` shows `UnlockDialog` `secret: 'adminPassword'`, `hint: adminHint(name)`, `unlock: api.unlockAdmin`, else refused `SERVER_COPY.gone(name)`; `ServerUnreachable` and any other error show the refused view with the error's message, a `Try again` button (refetch) and `Open in browser`. Unlocking invalidates both queries; closing the dialog without unlocking returns Home.
  - ready: `noteServerTitle` once with `watched` `media.position / media.duration` (or `null`); `useQuery` for `next[0]`'s media (label only, `retry: false`); `PlayerServicesProvider` with `serverServicesFor(...)` around `NativePlaying` with `source: { kind: 'server', serverId, mediaId }`.
  - `onEngineError` with reason `locked`: remember `lastSaved.current` as the resume point, invalidate the media query (which now answers 423 and shows the PIN dialog), and on success remount the player (a key) at that point.
  - the Playback menu's `next` navigates to `title.next` with `replace: true`, as PlayPage does.
- **Routes:** `{ path: 'server/:serverId/:mediaId', element: <ServerRoute /> }`.

- [ ] **Step 1: Write the failing tests** (`fakeClient` answering `listServers` with `[{ serverId: S, origin: 'https://raven.example', name: 'Vhagar' }]` and `serverCall` from a table keyed by method and path; `connectionsOf` for the engine):
  - `serverApi.test.ts`: `getMedia(7)` sends `{ type: 'serverCall', serverId: S, method: 'GET', path: '/api/media/7', body: null }` and resolves the fixture; `saveProgress({ id: 7, position: 40 })` sends `PUT` with body `'{"position":40}'`; a 423 reply rejects with an error `isLockedError` accepts; a 200 `'<html>'` rejects with `The server sent a response this client does not understand.`; `serverUnreachable` rejects a `ServerUnreachable` with its message; a `DELETE` (through `deleteLibrary`) throws without a request.
  - `serverServices.test.ts`: `resumeAtFor` table (`at: 30` wins; `at: 0` uses `position: 50`; `position` within 10 s of the end gives 0; no duration keeps 50); `started` sent `POST /api/media/7/plays`; `save(40)` sent the progress call and set `lastSaved.current` to 40; `left(60)` after `duration(120)` sent `noteServerTitle` with `watched: 0.5`; `title.next` for `{ mediaId: 8, label: 'Episode 2', rest: [9] }` is `{ to: '/server/S/8', state: { at: 0, next: [9] }, label: 'Episode 2' }`; `escape.run` sent `openInBrowser` `{ serverId: S, mediaId: 7 }`.
  - `ServerPage.test.tsx`:
    - "plays a title natively from its server": route state `{ at: 30, next: [] }`; the fake player received `load` with `source: { kind: 'server', serverId: S, mediaId: 7 }` and `start: 30`; the heading is the media's label; `noteServerTitle` was sent;
    - "asks for the PIN on a locked title and plays after it": `GET /api/media/7` answers 423 then 200; the `Locked library` dialog shows `pinHint('Vhagar')`; typing `1234` and Unlock sent `POST /api/lock/unlock` with `'{"pin":"1234"}'`; then `load` was sent;
    - "says a wrong PIN is wrong": the unlock answers 401 `{"message":"That PIN is not right."}`: the alert shows it and no `load` was sent;
    - "asks for the admin password first while the admin lock hides the title": 404, `GET /api/admin` `{"state":"on","available":true}`, password dialog, `POST /api/admin/unlock`, then 423 and the PIN dialog, then 200 and `load`;
    - "says a title that is gone is gone": 404 and `{"state":"off"}`: `This title is not on Vhagar any more.`;
    - "says the server cannot be reached and offers the browser": `serverUnreachable` `raven player could not reach raven.example.`: that text, `Try again` refetches, `Open in browser` sends `openInBrowser`;
    - "opens the title in the browser when the video engine is unavailable": an `unavailable` connection: exactly one `openInBrowser` under `StrictMode`, `inBrowser('Vhagar')` shows, and no `serverCall` was sent;
    - "shows the next title from the link": state `{ at: 0, next: [8] }`, `GET /api/media/8` answers a title `Episode 2`: a link named `Next: Episode 2` points at `/server/S/8`; when it answers 404 there is no Next link;
    - "asks for the PIN again when a library locks mid-play, then resumes": after a `save(40)`, emit `{ type: 'error', reason: 'locked', message: 'x' }`; the media query answers 423: the PIN dialog shows; after unlock a new `load` has `start: 40`;
    - "refuses a route it cannot read": `/server/not-an-id/7` and `/server/<S>/abc` render the refused view without any request; an unknown server id renders `That server is no longer in raven player.`.
  - `Shell.test.tsx`: a `playServer` event navigates to `/server/S/7` with state `{ at: 30, next: [8] }`, replacing while on `/play/...`.
  - `mediaItem.test.ts` (beside the fixture): `isMediaItem(mediaItemFor({}))`.
- [ ] **Step 2: Run to verify they fail**, **implement** (move `useChosenEngine`, `NativePlaying` and `Refused` out of `PlayPage.tsx` unchanged in behaviour first; PlayPage's tests must pass untouched), **verify** with the Global Constraints command.
- [ ] **Step 3: Commit** `MAE: play raven server titles in the desktop renderer`.

---

### Task 9: Servers in Settings, and Open Link

**Files:**
- Create: `apps/raven/desktop/src/renderer/SettingsPage/Servers.tsx`, `Servers.module.scss`, `Servers.test.tsx`
- Create: `apps/raven/desktop/src/renderer/Shell/OpenLinkDialog.tsx`, `OpenLinkDialog.module.scss`, `OpenLinkDialog.test.tsx`
- Modify: `apps/raven/desktop/src/renderer/SettingsPage/SettingsPage.tsx`, `SettingsPage.module.scss`, `src/renderer/Shell/Shell.tsx`, `src/shared/protocol.ts` (+ test), `src/main/menu.ts`, `src/main/menu.test.ts`

**Interfaces:**
- Consumes: Task 5's server requests and replies; `SERVERS_KEY`, `useServers` (Task 8); `useOpenReply` (Shell).
- Produces: `isDesktopEvent` gains `object({ type: oneOf(['openLink']) })`; `Servers` (a section); `OpenLinkDialog({ onClose })`; `MenuActions` unchanged (`send` carries it).

Behaviour and copy (spec "Screens", "Menus"):
- **Menu:** File gains `{ label: 'Open Link…', accelerator: 'CommandOrControl+L', click: () => actions.send({ type: 'openLink' }) }` after Open Recent.
- **Shell:** on `openLink`, renders `OpenLinkDialog` until it closes.
- **`OpenLinkDialog`:** a modal `<dialog>` (`showModal` on mount) with `<h2>Open a link</h2>`, `<p>Paste a raven player link or the address of a title on a raven server.</p>`, a `<label>` `Link` around `<input type="url" required>`, `Open` (primary) and `Cancel`. Submit sends `{ type: 'openLink', link }`; `playServer` closes it and plays (through `useOpenReply`); `refused` keeps it open with the message in `role="alert"`; `done` (declined) closes it.
- **`Servers`:** `<section aria-labelledby>` `<h2>Servers</h2>`, `<p>raven player plays titles from these raven servers. It signs in to each one separately.</p>`; with none, `<p>No servers yet. Open a title with Open in raven player on raven web, or add a server here.</p>`; else a `<ul>` of `<li>`: the name, the origin in a `<code>`, a `Rename` button that swaps in a small form (`<label>` `Name for <origin>`, input, `Save`, `Cancel`) sending `renameServer`, and `<Button tone="danger">` labelled `Remove <name>` sending `removeServer`. An add form: `<label>` `Server address`, `<input type="url" placeholder="https://raven.example.ts.net">`, `Add server` sending `addServer`. Each answer updates `SERVERS_KEY` from the `servers` reply and invalidates the recents, and puts `Server added.`, `Renamed to <name>.`, `Removed <name>. raven player signed out of it.` or the refusal in an always-mounted `<output>`; a declined prompt (`done`) says nothing. In `SettingsPage`, above "This computer".
- Styles: grid with `gap`, named areas for each row (`name actions` / `origin actions`, stacking below `30rem`), tokens only, `:focus-visible` with `--focus-ring`, works at 320px.

- [ ] **Step 1: Write the failing tests.**
  - `menu.test.ts`: File labels include `Open Link…` after `Open Recent` with `CommandOrControl+L`; its click sends `{ type: 'openLink' }`; the absent-items list drops Open Link.
  - `OpenLinkDialog.test.tsx`: the field has focus; submitting `https://raven.example/watch/7` sends `openLink` with it; a `refused` reply shows its message and keeps the dialog; a `playServer` reply navigates to `/server/S/7` and closes it; Cancel closes without a request; the Shell opens it on an `openLink` event.
  - `Servers.test.tsx`: with no servers the empty copy shows; with two, each row shows its name and origin; Rename then `NAS` and Save sends `{ type: 'renameServer', serverId, name: 'NAS' }` and shows `Renamed to NAS.`; a `refused` reply shows its message; `Remove Vhagar` sends `removeServer` and shows `Removed Vhagar. raven player signed out of it.`; Add with `https://raven.example` sends `addServer` and shows `Server added.`; a `done` reply leaves the status empty; the add field has a label.
- [ ] **Step 2: Run to verify they fail**, **implement**, **verify** with the Global Constraints command.
- [ ] **Step 3: Commit** `MAE: list servers in Settings and open links from the File menu`.

---

### Task 10: Server sources in the player service

**Files:**
- Create: `apps/raven/desktop/src/main/servers/serverSources.ts`, `serverSources.test.ts`
- Modify: `apps/raven/desktop/src/main/player/playerService.ts`, `playerService.test.ts`, `src/main/test/playerFakes.ts`, `src/main/main.ts` (the new `resolveSourceWith` shape, with servers from Task 5's stand-ins)

**Interfaces:**
- Consumes: `cookieHeader` (Task 3), `ServerCalls`, `requestFor` (Task 3), `ServerEntry`, `serverById` (Task 2), `isMediaId` (Task 1), `isOpaqueId`, `isMediaTracks`, `PlayerErrorReason` (Task 6), `PlayerSource`.
- Produces (`@/main/player/playerService`), replacing P5's resolver shape:

```ts
export type ServerTarget = {
  kind: 'server'; serverId: string; mediaId: number; url: string
  /** `Cookie: ...` from the server's own session, or '' when it holds none. */
  headerFields: string
  sidecars: readonly { url: string; title: string; language: string }[]
}
export type LoadTarget = { kind: 'file'; path: string } | ServerTarget
export type ResolvedSource = { ok: true; target: LoadTarget } | { ok: false; message: string }
export type FailureExplainer = (input: { target: ServerTarget; phase: 'loading' | 'loaded' }) =>
  Promise<{ reason: PlayerErrorReason; message: string }>
export const resolveSourceWith = ({ grants, servers }: {
  grants: Pick<Grants, 'fileOf'>
  servers: { resolve: (source: Extract<PlayerSource, { kind: 'server' }>) => Promise<ResolvedSource> }
}) => (source: PlayerSource) => Promise<ResolvedSource>
// createPlayerService deps gain: explain: FailureExplainer
// PlayerService gains: resetIfServer: (serverId: string) => Promise<void>
// PLAYER_MESSAGES drops serverTitles
export const SERVER_LOAD_OPTIONS = { lavf: 'max_redirects=0' } as const
```

- Produces (`@/main/servers/serverSources`):

```ts
export const SOURCE_MESSAGES = {
  unknownServer: 'That server is no longer in raven player.',
  badTitle: 'raven player cannot open that title.',
  lost: (name: string) => `raven player lost its connection to ${name}. Where you stopped last is saved there.`,
  relocked: (name: string) => `${name} locked this library again.`,
  gone: (name: string) => `This title is not on ${name} any more.`,
  cannotOpen: (name: string) => `raven player could not open this title from ${name}.`,
} as const
export const EXPLAIN_TIMEOUT_MS = 5000
export const createServerSources = ({ serverOf, cookiesFor, calls, warn }: {
  serverOf: (serverId: string) => ServerEntry | null
  cookiesFor: (input: { serverId: string; url: string }) => Promise<readonly { name: string; value: string }[]>
  calls: Pick<ServerCalls, 'call'>
  warn: (message: string) => void
}): { resolve: (source: Extract<PlayerSource, { kind: 'server' }>) => Promise<ResolvedSource>; explain: FailureExplainer }
```

Rules:
- **`resolve`**: `serverId` must pass `isOpaqueId` and `mediaId` `isMediaId` (else `badTitle`); an unknown server is `unknownServer`; `url` is `` `${origin}/api/media/${mediaId}/file` ``; `calls.call({ serverId, call: { name: 'getTracks', mediaId } })` answering 200 with a body passing `isMediaTracks` gives the `external` subtitles in order as sidecars (`url` `` `${origin}/api/media/${mediaId}/subtitles/${encodeURIComponent(id)}` ``, `title ?? ''`, `language ?? ''`), anything else gives none and is `warn`ed (the title still plays); `headerFields` is `cookieHeader(await cookiesFor({ serverId, url })) ?? ''`.
- **`explain`**: `getMedia` through `calls.call`, raced with `EXPLAIN_TIMEOUT_MS`: not `ok` or timed out is `{ reason: 'network', message: lost(name) }`; 423 `{ reason: 'locked', message: relocked(name) }`; 404 `{ reason: 'open', message: gone(name) }`; any other status `phase === 'loading' ? { reason: 'open', message: cannotOpen(name) } : { reason: 'decode', message: PLAYER_MESSAGES.stopped }`. A server gone from the config is `network` with `lost` of `'the server'`.
- **Player service `load`**: awaits `resolveSource` (refusals as today); remembers the target; before `loadfile` sets `http-header-fields` to the target's `headerFields` (a file sets `''`) and `stream-lavf-o` to `SERVER_LOAD_OPTIONS.lavf` (a file sets `''`), both checked against the load's generation like the existing `pause` set; `loadfile` gets the path or the URL, never anything the page sent.
- **`file-loaded` for a server target:** before reading `track-list`, each sidecar is added in order with `['sub-add', url, 'auto', title, language]`, one at a time, each failure `warn`ed and skipped, stopping if overtaken (the epoch token).
- **Endings for a server target:** where P5 emits `{ type: 'error', reason: 'open' | 'decode', ... }` (an `error` end-file, a short `eof`), it awaits `explain({ target, phase })` (a rejection counts as `network` with `lost`) and emits that instead, only if not overtaken. `ended` and file targets are unchanged.
- **`resetIfServer(serverId)`** runs `reset()` when the current target is that server's.

- [ ] **Step 1: Write the failing tests.**
  - `serverSources.test.ts` (fake `calls` and `cookiesFor`): a known server and title resolve to `url` `'https://raven.example/api/media/7/file'`, `headerFields` `'Cookie: raven_unlock=a.b'`, and two sidecars from tracks with `external-0` (`en`) and `external-1` (no language) plus an embedded one, in order, with `language: ''` for the second; `cookiesFor` got the file URL; tracks answering 500 or `'<html>'` give no sidecars and warn; `serverId: 'vhagar'` and `mediaId: 7.5` are `badTitle` and call nothing; an unknown server is `unknownServer`; no cookies give `headerFields: ''`; `explain` maps unreachable, a held call past 5 s (fake timers), 423, 404, and 200 in both phases exactly as above.
  - `playerService.test.ts`: every P5 test passes with the async resolver; a server load logs `set http-header-fields Cookie: raven_unlock=a.b`, `set stream-lavf-o max_redirects=0`, `set pause false`, then `loadfile https://raven.example/api/media/7/file replace -1 start=30`; a following file load logs `set http-header-fields ''` and `set stream-lavf-o ''` before its `loadfile`; after `file-loaded` the log has the commands `['sub-add', url0, 'auto', 'Spanish', 'es']` then `['sub-add', url1, 'auto', '', '']` before the `track-list` read; a failing first `sub-add` still runs the second; a load overtaken during `resolve` sends no `loadfile`; an `error` end-file while `loaded` for a server target emits `{ type: 'error', reason: 'locked', message: 'Vhagar locked this library again.' }` from a fake `explain`, and nothing when a new load overtook it meanwhile; a short `eof` on a server target is explained too; a rejecting `explain` emits `network`; `resetIfServer` stops only for the matching server; `PLAYER_MESSAGES` has no `serverTitles`.
- [ ] **Step 2: Run to verify they fail**, **implement**, **verify** with the Global Constraints command.
- [ ] **Step 3: Commit** `MAE: resolve server titles to a URL, a cookie and sidecars in main`.

---

### Task 11: Server titles against real headless libmpv

**Files:**
- Create: `apps/raven/desktop/e2e/fixtureServer.ts`
- Modify: `apps/raven/desktop/test/player.native.ts`

**Interfaces:**
- Consumes: `mediaItemFor` (Task 8), `makeClips`, `makeTrackClip` (`@/e2e/clips`), Task 10's service and `cookieHeader`.
- Produces (`@/e2e/fixtureServer`):

```ts
export const FIXTURE_MEDIA = { first: 1, second: 2, redirecting: 3 } as const
export type FixtureMode = { pin: string; isLocked: boolean; adminPassword: string | null }
export type FixtureRequest = {
  method: string; path: string; hasUnlock: boolean; hasAdmin: boolean; hasOtherCookie: boolean
  range: string | null; body: string | null
}
export type FixtureServer = {
  origin: string
  requests: FixtureRequest[]
  /** A second listener the redirecting title points at, with its own log. */
  elsewhere: { origin: string; requests: FixtureRequest[] }
  /** Forgets every unlock, as a server restart does. */
  relock: () => void
  close: () => Promise<void>
}
export const startFixtureServer = ({ clips, mode }: {
  clips: { first: string; second: string; tracks: string }
  mode: FixtureMode
}): Promise<FixtureServer>
```

Fixture rules (the shapes of `apps/raven/server`, Ruling 1; `node:http` on `127.0.0.1:0`; logs record cookie presence, never values):
- `GET /api/lock` `{ available: true, unlocked }`; `POST /api/lock/unlock` with the right `{ pin }` 200 and `Set-Cookie: raven_unlock=<token>; Path=/api; HttpOnly; SameSite=Strict`, a wrong one 401 `{ message: 'That PIN is not right.' }`, the fourth wrong in a row 429 `{ message: 'Too many wrong PINs. Try again in a minute.' }`; with an admin password set, `GET /api/admin` is `{ state: 'on', available: true }` until `raven_admin` arrives, then `{ state: 'off' }`, and `POST /api/admin/unlock` sets `raven_admin=<token>; Path=/api; HttpOnly; SameSite=Strict; Max-Age=34560000`; without one it is `{ state: 'off' }`.
- Media 1 (`clips.tracks`, the two-audio MKV), 2 (`clips.second`) and 3: while locked, every `/api/media/<id>...` route answers 404 `{ message: 'No media <id>' }` when the admin lock holds for the request, else 423 `{ message: 'This library is locked.' }`, until the request carries a valid `raven_unlock`. `GET /api/media/<id>` is `mediaItemFor({ id, title, duration: 30, fileName })` (`Fixture One`, `Fixture Two`); `/tracks` answers a `MediaTracks` with the two audio tracks `makeTrackClip` writes (`en`, `fr`), its `embedded-0`, and `external-0` (`language: 'en'`, `source: 'external'`, `codec: 'subrip'`), checked with `isMediaTracks` when the fixture starts; `/subtitles/external-0` answers a two-cue WebVTT; `/file` serves byte ranges (200, 206, 416 as `apps/raven/server/src/media/mediaController.ts`); media 3's `/file` answers 302 to `<elsewhere>/api/media/3/file`; `PUT /progress` and `POST /plays` answer 204. Anything else is 404 and logged.

- [ ] **Step 1: Write the tests** in a new `describe('server titles')` in `test/player.native.ts`, unlocking with `fetch` against the fixture and building the target with `cookieHeader` from its `set-cookie`:
  - "plays a server title with its unlock cookie on every file request": load media 1: `paused: false` arrives; every logged `/api/media/1/file` request has `hasUnlock`, at least one has a `range`, none has `hasOtherCookie`;
  - "adds the server's sidecar through the same cookie": the `tracks` event has `external-0` with language `en`; the fixture logged `GET /api/media/1/subtitles/external-0` with `hasUnlock`;
  - "a title the server refuses is an open error the source explains": a target with `headerFields: ''` on a locked fixture: the fake `explain` received `phase: 'loading'` and its `locked` error was emitted;
  - "never follows a redirect with the cookie" (the Ruling 14 spike): load media 3: an `error` event arrives within 10 s and `elsewhere.requests` holds no request with `hasUnlock`;
  - "a local file after a server title plays with no cookie sent anywhere": load media 1, then the local track clip: the clip plays and the fixture logs no new request.
- [ ] **Step 2: Run** `bunx nx run @raven/desktop:test:native` locally: all pass. If the redirect test fails because `max_redirects` is unknown to this FFmpeg (mpv logs it), replace `SERVER_LOAD_OPTIONS.lavf` with `'cookies=<the cookie pairs>; path=/api; domain=<host>'` set through `stream-lavf-o` instead of the header, so lavf scopes the cookie to the server's host, update Task 10's tests to match, and record the outcome in the commit body. If neither stops it, keep the header, record that a redirect carries the server's own cookie to where that server points (no other server's cookie can ride along, since each has its own jar), and leave the test asserting only the error.
- [ ] **Step 3: Verify** with the Global Constraints command (the Ubuntu job never runs `test:native`; CI's `🧪 Desktop player against headless libmpv` step already runs this file).
- [ ] **Step 4: Commit** `MAE: test server titles against headless libmpv and a fixture server`.

---

### Task 12: Main process wiring for servers

**Files:**
- Modify: `apps/raven/desktop/src/main/main.ts`
- Modify: `apps/raven/desktop/src/main/shutdown.ts`, `src/main/shutdown.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2 to 5 and 10.
- Produces (`@/main/shutdown`): `createShutdown` gains `writes: { hasPending: () => boolean; settle: () => Promise<void> }`; `isPending` is also true while writes are pending; `settle` waits for the writes (raced with `wait(DESTROY_MS)`, a timeout `warn`ed) alongside `stopEngine`, then flushes the stores.

`main.ts`, in this order (spec "Server titles", "Security"; Rulings 2, 8, 14, 16):
1. **Sessions:** a `Map` of `serverId` to `session.fromPartition(\`persist:server:${serverId}\`)`, made on first use; each new session's `setPermissionRequestHandler` and `setPermissionCheckHandler` deny everything. `fetchFor(serverId)` is `fetchThrough((url, init) => sessionOf(serverId).fetch(url, init))`. `forget(serverId)` awaits `clearStorageData()` and `clearCache()` on that session and drops it from the map.
2. **Calls and trust:** `createServerCalls({ serverOf: (id) => serverById(config.read(), { serverId: id }), fetchFor, warn })`; `createServerTrust` with `confirm` as `dialog.showMessageBox` (on the live window when there is one) `{ type: 'question', message: TRUST_MESSAGES.prompt(origin), detail: TRUST_MESSAGES.detail, buttons: ['Add Server', 'Cancel'], defaultId: 1, cancelId: 1 }` resolving `response === 0`, `probe` as `probeServer({ fetch: fetchFor(serverId), origin })` (the session for the new id is made only here, after consent), `forget`, `onRemoved` calling `resetIfServer` on the live engine's service, `newId: randomUUID`; `createLinkOpener`. These replace Task 5's stand-ins.
3. **Links:** the link batch delivers through `service.openLinks(items)`, then `announce` (the `playServer` event) and `reveal`; `LINK_NOTICE` goes.
4. **Sources:** `createServerSources({ serverOf, cookiesFor: ({ serverId, url }) => sessionOf(serverId).cookies.get({ url }), calls, warn })`; the player service gets `resolveSourceWith({ grants, servers: sources })` and `explain: sources.explain`.
5. **Browser:** `openExternal` is `shell.openExternal`; `windowOpenFor` is unchanged.
6. **Quit:** `createShutdown` gets `writes: { hasPending: calls.hasPendingWrites, settle: calls.settleWrites }`.
7. **Logs:** every allowlist refusal, trust outcome and `unreachable` is `console.warn`ed with the origin or method and path, never a body or cookie value (P7 moves these to the log).

- [ ] **Step 1: Write the failing tests** in `shutdown.test.ts`: with a write pending, `isPending` is true; `settle` waits for the write before any store flushes, while the engine's destroy runs alongside; a write that never settles gives up after `wait(DESTROY_MS)` with a warning and the stores still flush; with nothing pending `isPending` is false.
- [ ] **Step 2: Run to verify they fail**, **implement**, **verify** with the Global Constraints command.
- [ ] **Step 3: Smoke it by hand** with `RAVEN_DESKTOP_USER_DATA=$(mktemp -d) bunx nx run @raven/desktop:dev` against a local raven server (`bun run dev:raven`, a library locked, `LIBRARY_PIN` and a strong `ADMIN_PASSWORD` set in its `.env`). The dev app is not registered for `raven://` (P4 Ruling 9), so paste `raven://play?server=http%3A%2F%2F127.0.0.1%3A<port>&media=<id>` into Open Link (Command L), which takes the same trust path:
  - the native sheet names the origin; Cancel fetches nothing (the server log shows no request);
  - Add, then the admin password, then the PIN, and the title plays with its sidecar subtitles; Settings lists the server; relaunch and the PIN is asked again (Ruling 2);
  - quit mid-film and reopen raven web: the position is within 10 s of where it stopped;
  - stop the raven server mid-film: `raven player lost its connection to ...` shows;
  - with `RAVEN_DESKTOP_MPV=off`, the link opens `<origin>/watch/<id>` in the browser.
  Record each result in the commit body.
- [ ] **Step 4: Commit** `MAE: give each raven server its own session and a native trust prompt`.

---

### Task 13: "Open in raven player" on the web

**Files:**
- Create: `apps/raven/web/src/lib/ravenPlayer.ts`
- Modify: `apps/raven/web/src/pages/WatchPage/WatchPage.tsx` (`WatchPlayer`), `WatchPlayer.test.tsx` (new cases only)
- Modify: `apps/raven/web/src/pages/SettingsPage/SettingsPage.tsx`, `SettingsPage.module.scss`, `SettingsPage.test.tsx` (new cases only)

**Interfaces:**
- Consumes: `playLinkFor`, `PLAY_LINK_MAX_NEXT` (Task 1); `usePlayerPrefs` `opensInRavenPlayer` and `handoff` (Task 6).
- Produces (`@/lib/ravenPlayer`): `export const ravenPlayer = { open: (link: string): void => window.location.assign(link) }` (an object, so tests spy on `open`).

Behaviour (spec section 2 "First release"):
- **Settings:** `SettingsSection` gains an optional `browser?: ReactNode`, rendered after its fieldset and outside it, so the admin lock never disables it. The Playback section passes a `<fieldset className={styles.setting}>` with `<legend>` `This browser` and a checkbox labelled `Open videos in raven player`, hint `Offers raven player for videos this browser cannot play, and in the player's settings. Turn it on only where raven player is installed.`, bound to `opensInRavenPlayer`.
- **`WatchPlayer`:** reads `opensInRavenPlayer`; only when it is on, services gain `handoff: { label: 'Open in raven player', run: (at) => ravenPlayer.open(playLinkFor({ origin: window.location.origin, mediaId: media.id, at, next: upNext.slice(0, PLAY_LINK_MAX_NEXT).map(({ id }) => id) })) }`. Off, the services object is exactly today's.

- [ ] **Step 1: Write the failing tests.**
  - `SettingsPage.test.tsx`: the checkbox `Open videos in raven player` is unchecked by default; clicking it sets `usePlayerPrefs.getState().opensInRavenPlayer` to `true`; with the admin lock on it is still enabled while the server settings are disabled.
  - `WatchPlayer.test.tsx`: with the setting off, a title that cannot play shows no `Open in raven player` and the settings menu has none (the existing tests stand as they are); with it on, Unplayable's buttons are `Open in raven player` then `Copy file link`, and clicking the first called `ravenPlayer.open` with `playLinkFor({ origin: window.location.origin, mediaId: 7, at: 0, next: [8, 9] })` for a title handed over with up next `[8, 9]`; in a playing title, the settings menu's `Open in raven player` paused the video first and opened a link whose `at` is the current position rounded down.
- [ ] **Step 2: Run to verify they fail**, **implement**, **verify** with the Global Constraints command (the web's coverage floors hold; no existing web test edited).
- [ ] **Step 3: Commit** `MAE: offer Open in raven player on the web when a browser asks for it`.

---

### Task 14: End to end against a fixture server

**Files:**
- Modify: `apps/raven/desktop/e2e/harness.ts`
- Create: `apps/raven/desktop/e2e/server.e2e.ts`
- Modify: `apps/raven/desktop/e2e/security.e2e.ts`

**Interfaces:**
- Consumes: `startFixtureServer`, `FIXTURE_MEDIA` (Task 11); `playLinkFor` (Task 1); `requestFromPage`, `launchApp`, `withApp`, `closeApp`, `freshUserData`, `removeDir` (the harness).
- Produces (`@/e2e/harness`):

```ts
export const openUrl = ({ app, url }: { app: ElectronApplication; url: string }): Promise<void>
/** Answers main's trust sheet without showing it, and records what it asked. */
export const stubTrustPrompt = ({ app, answer }: { app: ElectronApplication; answer: 'add' | 'cancel' }): Promise<void>
export const trustPrompts = ({ app }: { app: ElectronApplication }): Promise<string[]>
/** Records what main hands the browser instead of opening it. */
export const stubBrowser = ({ app }: { app: ElectronApplication }): Promise<void>
export const browserOpens = ({ app }: { app: ElectronApplication }): Promise<string[]>
```

`openUrl` emits `open-url` the way `openFile` emits `open-file`. The stubs replace `dialog.showMessageBox` (response 0 for `add`, 1 for `cancel`) and `shell.openExternal` inside `app.evaluate`, pushing the message or URL onto an array on `globalThis` that the readers return.

- [ ] **Step 1: `server.e2e.ts`**, headless mpv, a fixture per describe (`isLocked: true`, PIN `3001`):
  - "asks before trusting a server a link names, and fetches nothing when declined": `stubTrustPrompt` `cancel`, `openUrl` with `playLinkFor({ origin, mediaId: 1, at: 0, next: [] })`: `trustPrompts` equals `[\`Add the raven server at ${origin}?\`]`; after 1 s the fixture logged nothing and the page is still Home.
  - "plays a locked title after the PIN, with the cookie sent to mpv, and saves progress there": `add`; `Locked library` shows; `1234` gives `That PIN is not right.`; `3001` plays (`Pause (k)`); every logged `/api/media/1/file` request has `hasUnlock`; `/api/media/1/subtitles/external-0` was requested; `k` then a logged `PUT /api/media/1/progress` with a numeric `position`; a logged `POST /api/media/1/plays`.
  - "asks for the PIN again after a relaunch, from the recent" (serial with the previous): relaunch on the same userData; Home lists `Fixture One` from `127.0.0.1:<port>`; choosing it shows `Locked library` again with no new trust prompt.
  - "plays the next title from the link": a link with `next: [2]` after unlocking; `End`: heading `Fixture Two` within 15 s.
  - "asks for the admin password first while the admin lock hides the title": a fixture with `adminPassword` set; `Admin lock` then `Locked library`, then it plays.
  - "opens the title in the browser without the video engine": `mpv: 'off'`, `stubBrowser`, `add`: `browserOpens` equals `[\`${origin}/watch/1\`]` and the page says it opened in the browser.
  - "removes a server and signs out of it": after unlocking once, Settings, `Remove 127.0.0.1:<port>`; the server is gone from the list and its recent from Home; adding it again through a link asks for the PIN again.
- [ ] **Step 2: `security.e2e.ts`** gains "refuses a server call off the allowlist": with a trusted fixture server, `requestFromPage` of `{ type: 'serverCall', serverId, method: 'GET', path: '/api/media/1/location', body: null }` (the id from `listServers`) answers `serverUnreachable` with `raven player does not make that call.`, and the fixture never logged `/location`; the same with an unknown `serverId` answers `That server is no longer in raven player.`.
- [ ] **Step 3: Verify on macOS.** `bunx nx run @raven/desktop:e2e` passes locally (P5's 23 plus 8 new) and `bunx nx run-many -t typecheck lint:ts format:check -p @raven/desktop` passes.
- [ ] **Step 4: Commit** `MAE: test server titles end to end against a fixture server`.

---

## Testing for the PR (manual, macOS arm64)

What tests prove: the link parser and writer, origins, the config, the eight-call allowlist and the bodies main rebuilds, the cookie header, calls that time out, redirect, overflow or answer HTML, trust with consent, decline, probe failure, busy and the cap, links in bursts, recents for server titles, the shared dialogs and seams, the server page's PIN, admin and error paths and its browser fallback, server sources with sidecars and explained failures, real libmpv reading a cookie-gated file and sidecar, and the app end to end against a fixture server: the prompt that fetches nothing, a locked title played with the cookie reaching mpv, progress and history saved, the PIN asked again after a relaunch, up next, the admin lock, the browser fallback, removal signing out, and a call off the allowlist refused. What only a person can check, on the `make` artifact installed in `~/Applications` (P0's pending gates) and on the dev app with the window surface:

- A real `raven://` click from raven web on Vhagar in Safari and in Chrome, cold and warm, with the browser's own confirmation; the setting off shows nothing new on the web.
- M2 handed over from Unplayable on Vhagar plays with every track, including a title in a locked library with the admin lock on; the position on Vhagar after quitting mid-film is within 10 s.
- An IDN origin in a link shows its punycode form in the sheet.
- Stopping the raven server mid-film shows the lost-connection message and the web resumes from the last save.
- With `libs/raven/mpv/resources/darwin-arm64` renamed away, a link opens the title in the browser.

## Self-review notes

- **Spec coverage (P6):** servers in Settings with add, rename and remove clearing the session (Tasks 2, 4, 5, 9, 12); the play link and the pasted watch page (Tasks 1, 4, 9); the native trust prompt with nothing fetched before consent (Tasks 4, 12, 14); a session per server (Task 12); the eight-call allowlist (Tasks 3, 5, 8, 14); mpv reading the file with the session's cookies and the cache on, and sidecars by `sub-add` (Tasks 3, 10, 11); `UnlockDialog` in `@raven/ui` with the PIN and the admin password first (Tasks 7, 8); progress and history to the server, quit waiting for saves (Tasks 8, 12); up next from the link (Tasks 1, 8, 14); the browser fallback (Tasks 5, 8, 14); recents of kind server (Task 5); Open Link in the File menu (Task 9); the web setting and its two actions (Tasks 6, 13); the e2e items "a request off the allowlist is refused" and "a play link to an unknown server shows the prompt and fetches nothing" (Task 14).
- **Types across tasks:** `PlayRequest`, `isMediaId`, `playLinkFor` (1) in 4, 5, 8, 13, 14; `serverOriginOf`, `readPlayLink`, `watchUrlFor` (1) in 4, 5; `ServerEntry`, `serverById`, `cleanName`, `SERVERS_CAP` (2) in 3 to 5, 10, 12; `AllowedCall`, `matchCall`, `requestFor`, `cookieHeader`, `ServerCalls`, `fetchThrough`, `probeServer` (3) in 5, 10, 12; `ServerTrust`, `TRUST_MESSAGES`, `LinkOpener`, `isServerTarget` (4) in 5, 12; `ServerView`, the server requests and replies (5) in 8, 9, 14; `Handoff`, `escapeHint`, `onEngineError`, `opensInRavenPlayer`, `PlayerErrorReason` (6) in 8, 13; `UnlockDialog`, `UnlockSecret` (7) in 8; `serverApiFor`, `SERVERS_KEY`, `mediaItemFor` (8) in 9, 11; `ServerTarget`, `resolveSourceWith`, `createServerSources` (10) in 11, 12; `startFixtureServer` (11) in 14.
