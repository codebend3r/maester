# raven direct media

On Netlify, raven lags on large files while Plex on the same NAS plays them smoothly on the LAN. The cause is the route the bytes take, not the server: every `/api` request, the video included, goes browser → Netlify edge → Tailscale Funnel relay → Vhagar and back the same way. This splits raven into a **control plane** (JSON, cookies, events), which can stay behind Netlify's proxy, and a **media plane** (streams, files), which goes from the browser straight to Vhagar by the fastest route available.

## What was measured

On `raven-player.netlify.app`, 2026-10-16, playing American Fiction (2160p HEVC 10-bit HDR, EAC3 5.1, about 25 Mbps) in remux mode:

| Observation | Value |
| --- | --- |
| Route of `/api/media/6354/stream?mode=remux` | Netlify (`cache-status: fwd=miss`), then `RAVEN_API_ORIGIN`, the Funnel address |
| Time to first byte of small API calls (cast photos, tracks, logo, `/api/home`) | 9 to 12 seconds |
| Time to first byte of `/api/admin`, `/api/settings/playback` at idle | 0.35 to 1.8 seconds |
| Buffer ahead shortly after starting | about 0.5 seconds |
| Stream shape | One long fMP4 response per start point (by design, see README, Playback) |

Plex on the LAN reads from the NAS directly, so its ceiling is the LAN. raven's ceiling is the smallest of: Vhagar's upload, Tailscale Funnel's relay (Tailscale documents Funnel traffic as subject to non-configurable bandwidth limits), and Netlify's proxy (26 seconds to first byte, counted bandwidth). Even at home the bytes leave the house and come back.

## Goals

- At home, a browser on the Netlify site plays a 4K remux as smoothly as Plex does on the LAN.
- Away, playback uses the fastest route that reaches Vhagar, and steps down to a transcode when that route cannot carry the file's bitrate.
- The PIN and the admin lock keep working, with their cookies still first party.
- Nothing changes for the web app served by Vhagar itself, or for the desktop app.

## Non goals

- Accounts or per-viewer progress.
- Moving video off Vhagar (no CDN, no cloud storage).
- Replacing the fMP4 through MSE pipeline (Phase 3 changes how it is requested, not what it is).

## Phase 1: the media plane goes direct

### Media origins

raven learns a list of origins that serve its media routes, best first:

| Kind | Example | Who it reaches |
| --- | --- | --- |
| `lan` | `https://raven.home.example.com` (split DNS to Vhagar's LAN IP, DSM reverse proxy, Let's Encrypt via DNS challenge) | Browsers on the home network |
| `tailnet` | `https://raven.<tailnet>.ts.net` reached as a tailnet peer (Tailscale Serve) | Devices signed in to the tailnet, at home or away, over WireGuard, direct when possible |
| `public` | the Funnel address, or a forwarded domain | Everyone else |

Every origin must be HTTPS: the Netlify page is HTTPS, so an `http://192.168.x.x` media URL is blocked as mixed content.

On a tailnet device, MagicDNS resolves the `ts.net` name to Vhagar's tailnet address, so the same hostname is direct for tailnet devices and relayed through Funnel for the rest. That alone may make the `tailnet` and `public` entries the same URL; the client still measures which it gets.

**Config.** A new env var on Vhagar:

```
# Origins the browser may fetch media from, best first. Each kind:url.
RAVEN_MEDIA_ORIGINS=lan:https://raven.home.example.com,tailnet:https://raven.<tailnet>.ts.net
# Origins allowed to call the media routes cross-origin (the Netlify site, previews).
RAVEN_WEB_ORIGINS=https://raven-player.netlify.app
# Signs media tickets. 32+ random bytes, base64. Rotating it ends every ticket.
RAVEN_MEDIA_SECRET=
```

Unset, raven behaves as today: media URLs are relative and go wherever `/api` goes.

**Contract.** A new guard in `libs/raven/core/src/contract.ts`, `isMediaOrigins`, read off by `GET /api/media-origins` (`@Public()`, `cache-control: no-store`):

```ts
{ origins: [{ kind: 'lan' | 'tailnet' | 'public', url: string }] }
```

### Choosing an origin in the browser

A new `useMediaOrigin` in `@raven/ui` (platform logic in `@raven/core` as a pure `pickOrigin`):

1. On app start, and again on `online` and on `visibilitychange` to visible after 10 minutes away, probe each origin in parallel with `GET {origin}/api/media-origins/ping?bytes=262144` (CORS, `no-store`), a 2 second timeout each.
2. Score each origin that answers by time to first byte and the measured throughput of the 256 KB body. Prefer `lan` over `tailnet` over `public` when within 20% of each other.
3. No origin answers: fall back to the relative path (today's route through Netlify).
4. Keep the pick in memory and in `sessionStorage` (wrapped in try/catch). A stream that fails to connect triggers a re-probe.

`ping` returns random bytes from a fixed buffer, never touches disk, and is `@Public()`.

### Media tickets

The media routes are `@PrivateBy('media')`, and the PIN cookie is `SameSite=Strict; Path=/api` on the Netlify origin, so a cross-site request to Vhagar would not carry it. Instead of moving cookies, the control plane hands out a short-lived ticket:

- `GET /api/media/:id/ticket` goes through Netlify as today, guarded by `LockGuard` like any media route, and returns `{ ticket, expiresAt }` (new guard `isMediaTicket`).
- The ticket is `base64url(id.expiresAt).hmac`, HMAC-SHA256 with `RAVEN_MEDIA_SECRET`, valid for 6 hours and for that media id only.
- `LockGuard` accepts `?t=` on routes marked `@PrivateBy('media')` when the ticket verifies for the route's `:id` and has not expired, compared in constant time (as `@shared/server` already does for the PIN).
- Tickets never unlock anything else and never set a cookie.
- The client fetches a ticket when the player opens and refetches 10 minutes before `expiresAt`.

### CORS and Private Network Access

On the media routes (`/api/media/:id/stream`, `/file`, `/subtitles/*`, `/thumbnail`, `/api/media-origins/ping`), for an `Origin` in `RAVEN_WEB_ORIGINS`:

- `Access-Control-Allow-Origin: <origin>`, `Vary: Origin`
- `Access-Control-Allow-Methods: GET, HEAD, OPTIONS`
- `Access-Control-Allow-Headers: range`
- `Access-Control-Expose-Headers: content-length, content-range, accept-ranges`
- On a preflight carrying `Access-Control-Request-Private-Network: true`: `Access-Control-Allow-Private-Network: true` (Chrome's Private Network Access, for a public page reaching a LAN address)
- No `Access-Control-Allow-Credentials`: tickets, not cookies, authorize these.

Any other origin gets no CORS headers, so a foreign page cannot read the bytes.

### Client changes

- `createApiClient` takes `mediaBaseUrl` beside `baseUrl` (default: `baseUrl`). `streamUrl`, `fileUrl`, `thumbnailUrl` and the subtitles call build on it and take a `ticket` that becomes `t=`.
- `useMediaSource` passes the picked origin and the current ticket.
- `WatchPage`'s "open in VLC/IINA" link uses the media origin and a ticket, so it works outside the browser too.
- The desktop app passes nothing new and keeps today's behaviour.

### Netlify

- `_redirects` keeps proxying `/api/*`, for the control plane and as the fallback.
- No change to `netlify.toml`.
- README, "On Netlify": replace "Every `/api` request goes through Netlify, video included" with the media plane and its env vars.

### Vhagar setup (outside the code)

- `lan`: a DSM reverse proxy rule (or Caddy) for `raven.home.example.com` → `raven:8484`, a certificate by DNS challenge, and a local DNS record (router or DSM DNS Server) pointing the name at Vhagar's LAN IP.
- `tailnet`: Tailscale Serve already terminates TLS for the `ts.net` name inside the tailnet. Confirm viewing devices are on the tailnet and the ACL lets them reach the `raven` node on 443.
- `public`: unchanged Funnel, or a router port forward of 443 to the reverse proxy if Funnel's limits are too low for remote 4K (see open questions).

## Phase 2: playback that copes with the route

### Resume instead of fail

`streamSource.load` calls `fail()` when the response errors mid-stream. Instead:

- On a network error after at least one fragment arrived, restart from the buffered end (file time) with the same mode, up to 3 times with 1, 2, 4 second backoff. Count resets after 30 seconds of clean reading.
- Only after the retries does it fail, and `usePlaybackLadder` steps down as today.
- A 401/423 (ticket expired or lock) fetches a new ticket once and retries.

### Step down on bandwidth

Remux copies the video, so `maxHeight` cannot apply to it (it only shapes a transcode). The player instead watches delivery:

- `streamSource` reports bytes per second over a sliding 10 second window, and buffer ahead.
- When buffer ahead stays under 5 seconds for 10 seconds while delivered bits per second are below 1.2 × the file's `bitrate`, the ladder steps from remux (or direct play) to transcode at the current spot, using `maxHeight` and `quality` from Settings.
- It never steps back up within the same play. Show the step in the existing PlaybackNote: "Switched to 1080p: the connection is slower than this file."
- Direct play gets the same rule from the `<video>` element's `progress` and `waiting` events.

### Quality picker

Add Original, 4K, 1080p, 720p to the player's settings menu. Original keeps today's ladder; any other forces transcode at that height for this play. Stored per browser like the audio language.

## Phase 3 (optional): chunked stream requests

One open response per start point is fragile through any proxy and holds a connection idle while the player pauses reading. Instead, the player asks for fixed windows:

- `GET /api/media/:id/stream?mode=&start=&duration=10`, each a self-contained fMP4 run of 10 seconds starting on a keyframe at or before `start`.
- The player keeps two to three requests in flight ahead and appends in order. Each is short, retriable and needs no backpressure.
- The server keeps a warm ffmpeg per (media, mode, audio) for 30 seconds after a window ends, so the next window continues the same process instead of seeking again. A window that does not follow on starts a new one.
- This also makes the windows cacheable per ticket, should a cache ever sit in front.

Decide after Phase 1 and 2 are measured: if direct playback is already smooth, skip it.

## Diagnostics

A "Stats for nerds" toggle in the player (key `i`): media origin and kind, mode (direct, remux, transcode), source bitrate, delivered throughput, buffer ahead, dropped frames, restarts. Everything it needs is already in the client; it makes the next report a screenshot.

## Tests

- `pickOrigin`: ordering, the 20% preference band, all-fail fallback.
- Ticket: signs and verifies, rejects another id, an expired ticket, a tampered one, a missing secret (feature off).
- `LockGuard`: a valid ticket opens a locked library's stream; it does not open `/api/items/:id`.
- CORS: allowed origin gets headers, others do not; the PNA preflight answers.
- `streamSource`: resume from the buffered end after a dropped connection; gives up after 3; refreshes a ticket on 423.
- Ladder: a slow fake stream steps remux to transcode once and only once.
- e2e (desktop harness or Playwright): play a clip through a media origin on another port with a ticket.

## Rollout

1. Ship Phase 1 with `RAVEN_MEDIA_ORIGINS` unset (no behaviour change), then set `tailnet` only, then `lan`.
2. Measure with Diagnostics at home and away.
3. Ship Phase 2.
4. Decide on Phase 3 and on the public route.

## Decisions (2026-10-17)

Answered before implementation; the plan in `docs/superpowers/plans/2026-10-17-raven-direct-media.md` builds on them.

- **Netlify stays** as the web app's host, so Phase 1 builds the full cross-origin path: tickets, CORS and the local network preflight.
- **Scope:** Phases 1 and 2 and Diagnostics now, as a stack of PRs on `main`; `redesign` is rebased onto the stack once the last PR is open. Phase 3 stays deferred.
- **Web origins:** `https://raven-player.netlify.app`, the deploy previews `https://deploy-preview-*--raven-player.netlify.app` (so `RAVEN_WEB_ORIGINS` takes a `*` for one hostname label) and `http://localhost:5173` for the Vite dev server. A custom domain on Netlify is not set up yet and is added to the list when it is.
- **Clients:** Chrome and Safari on a Mac or PC, and Safari on an iPhone or iPad (`ManagedMediaSource`). Chrome has replaced Private Network Access preflights with a Local Network Access permission prompt, which needs nothing from the server beyond CORS; the `Access-Control-Allow-Private-Network` answer stays for older builds. Safari has neither.
- The remaining questions below only set env values and the Vhagar setup, not the code; they stay open until deployment.

## Open questions

Answers from CJ that decide the choices above:

1. **Who watches away from home**, and are those devices on your tailnet? Only you and family on Tailscale means `tailnet` covers remote playback and Funnel only matters for guests.
2. **Do you have a domain** you'd use for `raven.home.<domain>` (and possibly a public `raven.<domain>`), and where is its DNS hosted (needed for the DNS-challenge certificate)?
3. **Home internet**: ISP, plan upload speed, and whether you're behind CGNAT. This sets the remote ceiling and whether a port forward is possible.
4. **Vhagar's network**: its LAN IP, whether DSM's reverse proxy or another service already uses 443, and what does local DNS on your network (router model, Pi-hole, DSM DNS Server).
5. **Why Netlify** for the web app: always up when Vhagar is down, a shareable URL, or something else? If it is only for the URL, serving the app from Vhagar at the `ts.net` or own-domain name removes the cross-origin work entirely.
6. **Which web origins** besides `raven-player.netlify.app` should be allowed: deploy previews, a custom domain on Netlify?
7. **Target clients**: Chrome, Safari, iOS, a TV browser? iOS uses `ManagedMediaSource` and Safari has no Private Network Access, which changes testing.
8. **Remote 4K**: should remote viewers ever get the original 4K, or always a 1080p transcode? This decides whether a port forward is worth it over Funnel.
