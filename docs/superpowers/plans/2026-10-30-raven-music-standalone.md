# raven music: Wren, offline, and listening quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build PRs 8, 9 and 10 of the raven audio spec: Wren, a standalone music app on raven's server and accounts; offline listening, CarPlay and Android Auto; and loudness levelling, crossfade, EQ, bitrate steps, mixes, radio, scrobbling, shared playlists and the `/music` mode on the web and Raven.

**Architecture:** Wren (`@raven/music`, `apps/raven/music`) is a second Expo app beside `@raven/app`, on the same tvOS fork. Sign-in, the server client and media access move out of `@raven/app` into a new React Native lib, `@raven/native`, which both apps import. Music plays through `@raven/audio`, which gains its Android side (Media3) in PR 8 and a browse tree that CarPlay and Android Auto share in PR 9. The server gains a per-track AAC transcode cache (PR 9), then a loudness scan, mixes, radio, scrobbling and shared playlists (PR 10a). The web gets a `/music` route tree above the same audio host (PR 10b), and Wren catches up with PR 10c.

**Tech Stack:** Expo 58.0.14 on `react-native-tvos` 0.88.0-0, expo-router, Media3 (ExoPlayer, `MediaLibraryService`), AVFoundation, MediaPlayer, CarPlay, NestJS 12 on Fastify with vitest, SQLite, ffmpeg, React 19 with Vite, zustand, TanStack Query, bun test, jest-expo, Maestro, Nx 23 over Bun workspaces.

**Spec:** `docs/superpowers/specs/2026-10-27-raven-audio-design.md`, sections 7 to 9, "Plan" rows 8 to 10, "Spikes" (engine prototype) and "Risks". It builds on the device apps plan, `docs/superpowers/plans/2026-10-18-raven-device-apps.md`, for the app's tooling and sign-in.

## Global Constraints

- Everything in the root `CLAUDE.md`, `apps/raven/CLAUDE.md` and `apps/raven/app/CLAUDE.md`. That means no `any`, casts, `interface`, enums or loops. Functions take one object parameter. Untrusted data is checked by a guard at the boundary. Identifiers come from `as const` objects declared once. Imports use `@/` and no extension. No em or en dashes anywhere. Comment only a non-obvious why. No dead code. Named exports only.
- Names, from the user (2026-10-30):
  - The app is **Wren**: project `@raven/music` in `apps/raven/music`.
  - The iOS bundle id and the Android package are both `app.netlify.wren`. The scheme is `wren`, and the slug is `wren`.
  - Anything hosted lives on Netlify, never github.io.
- Wren runs on the tvOS fork: `react-native` is `npm:react-native-tvos@0.88.0-0`. The root `overrides` is workspace-wide, and the user chose the fork over reworking it. Every Expo and React Native pin matches `@raven/app`'s exactly.
- New Expo modules are pinned to Expo 58.0.14's `bundledNativeModules.json`: `expo-file-system` 58.0.9 and `expo-web-browser` 58.0.6. Pin Media3 exactly to the newest stable release on the day Task 4 runs, and record the version in `apps/raven/music/CLAUDE.md`.
- Every dependency is pinned exactly, never with a caret or tilde.
- Transcodes are AAC in `.m4a` only. The bitrates are `AUDIO_BITRATES = { low: 128, standard: 256, high: 320 }` kbps. Downloads default to 256. There is no Opus.
- A listen counts at half the track or 240 s, whichever comes first, as today. Only a track in a `music` library is scrobbled; audiobooks never are.
- Last.fm stays off until both `LASTFM_API_KEY` and `LASTFM_API_SECRET` are set on the server. ListenBrainz needs no server key.
- No secret is ever logged: not a scrobble token, a session key, a ticket or a JWT. Scrobble tokens are encrypted at rest.
- Every new per-account table has `account_id` in its primary key, a row in `appAccountData.test.ts`, and plan assertions.
- Every new route gets:
  - a row in the server's `ROUTES` inventory (`server/test/enforced.ts`);
  - its lock-suite coverage, through `PRIVACIES`;
  - an `APP_CLIENT_CALLS` entry, when an app calls it.
- Each PR follows `commit-format` and `pr-format` (concise, 300 to 400 words, ready for review, not draft).
  - The PRs are stacked: PR 8 targets `main`, and each later PR targets the branch before it.
  - Before each PR: run `bun run verify`, then the thermo-nuclear review over the whole branch, with its fixes in one final commit.
  - Pushing, opening the PRs and force-with-lease restacks are pre-approved.
- The CarPlay entitlement (`com.apple.developer.carplay-audio`) is the user's to request from Apple. CarPlay code ships behind it and is verified in the CarPlay simulator only.

## Rulings (where the spec is silent, or the code says otherwise)

1. **Upstream React Native is dropped for the fork.** Section 9 of the spec says "upstream React Native rather than the TV fork". The root `overrides` makes that impossible without breaking `@raven/app` (see app `CLAUDE.md`, "Pins"). The fork is a superset that builds iOS and Android phone apps unchanged. Task 1 amends the spec's line, with the reason.
2. **`@raven/native` is new, and pieces move into it rather than being copied.** Wren needs exactly `@raven/app`'s account session, Supabase sign-in, refreshing fetch, server fetch, cookie jar, allowlist, active-server store, secret stores, tickets, media access and the `@raven/audio` adapter.
   - **What moves:** they move to `libs/raven/native/src/` with the same names, and `@raven/app` imports them from there. There are no re-export shims.
   - **How it builds:** `tsc` plus `tsc-alias` into `dist`, like `@raven/audio`. Metro reads it through `^build`.
   - **What stays in the app:** app-specific stores (`RAVEN_SERVER`'s TV bits, voice) and anything that imports a `*.focus.tsx` file.
   - **Pure music helpers:** the pure ones (`musicRows.ts`, `musicCards.ts`, `playlistOrder.ts`, with no `react-native` import) go to `libs/raven/ui/src/music/` and are exported from `@raven/ui/headless`.
   - **Shared keys:** the server origin, `RAVEN_SERVER`, is shared. Each app keeps its own secure-store key prefix (`raven.` and `wren.`), passed in by the app.
3. **Wren is touch-only and has its own look.** It imports no layout from `@raven/app` and nothing with a `TVFocusGuideView`. It has no `@react-native-tvos/config-tv` plugin and no `EXPO_TV`. Its colours and type come from `@raven/ui/designTokens` (raven's tokens and themes), with a music-first layout:
   - tabs: Home, Library, Search, Settings;
   - a now-playing bar above the tab bar;
   - Now Playing as a full-screen sheet holding the queue and lyrics.
4. **On Android, a track ExoPlayer cannot decode is skipped until PR 9.** That is ALAC, which loads silent. `canPlayAudio({platform, codec})` in core holds the spec's table. In PR 8, Wren on Android skips such a track with core's `COULD_NOT_PLAY` copy. PR 9 plays it from the transcode cache instead. The library holds 14 M4A files, so the gap is small.
5. **Media3 starts as a `MediaLibraryService` in PR 8.** In PR 8 its root has no children. PR 9 fills the browse tree. Android Auto reads the same service, so it is built once.
6. **The `@raven/audio` contract stays a window of two tracks on both platforms.** Android uses one ExoPlayer holding the playing and the next item, sends `advanced` on `onMediaItemTransition`, and sends `ended` after the last item. The JS contract (`AudioItem`, `AUDIO_PLAYER_EVENTS`, the `audioPlayer` functions) does not change in PR 8. Only `expo-module.config.json` gains `"android"`.
7. **The transcode cache lives on disk, with no migration.**
   - **Layout:** `<dataDir>/transcodes/<mediaId>/<mtimeMs>-<kbps>.m4a`. The file is written to a dot-file and renamed, like `ImageCache`. Work in flight is shared through `once`, and a `createGate({ limit: 2 })` bounds CPU.
   - **Size:** capped by `TRANSCODE_CACHE_GB` (default 20), evicting the least recently served files first. Serving touches the file's mtime-free `atime` with `utimes`.
   - **Encoding:** `-map 0:a:0 -vn -c:a aac -b:a <kbps>k -map_metadata 0 -movflags +faststart`. ffmpeg's mp4 muxer writes the AAC priming as an edit list, which AVPlayer and ExoPlayer honour, so the seams stay gapless.
   - **Route:** `GET /api/media/:id/transcode?kbps=` is `@MediaPlane() @OpenedByPass(PASS_KINDS.ticket)`. It waits for a first transcode, then serves ranges like `/file`. Any `kbps` value outside `AUDIO_BITRATES` gets a 400. A video file gets a 409.
8. **Desktop downloads keep the file as it is.** Raven downloads the original file for album and playlist targets (disk is plentiful there). The path builder becomes `mediaPathFor({container})`: `media.<container>` for an audio container (`isAudioContainer`), and `video.<container>` otherwise. The state needs no version bump.
   - **Kinds and groups:** `DOWNLOAD_TARGET_KINDS` and `DOWNLOAD_KINDS` gain `album` and `playlist`, with groups `album:<albumId>` and `playlist:<playlistId>`.
   - **Offline play:** the music engine's `resolve` first asks `downloads.openTitle({serverId, mediaId})`, as `serverTitles.play` already does, and plays the file kind when one is found.
9. **Wren downloads transcodes, and plays from them.**
   - **Bitrate:** the "Download quality" setting (default 256) picks it.
   - **Storage:** files go under `documentDirectory/downloads/<serverId>/<mediaId>/media.m4a`. Each entry also stores the `Track` and its album's summary, so the Downloads tab works with no server.
   - **What `itemOf` plays, in order:**
     1. a downloaded file, as a `file://` uri with no headers;
     2. on cellular (NetInfo), the transcode at "Cellular quality" (default 256);
     3. the original file.
   - **Limit:** "Storage limit" (Off, 2, 5, 10 or 20 GB) refuses new downloads past it, with a message.
   - Smart auto-downloads are deferred (YAGNI).
10. **CarPlay and Android Auto share one browse bridge.**
    - **Event:** native asks JS with an `onAudioEvent` of type `browse`: `{ type: 'browse', requestId: string, parentId: string }`.
    - **Answer:** JS replies with `audioPlayer.answerBrowse({ requestId, nodes: BrowseNode[] })`.
    - **Node shape:** `BrowseNode = { id: string, title: string, subtitle: string | null, artworkUri: string | null, isPlayable: boolean }`.
    - **Roots:** `BROWSE_ROOTS = { home: 'root', albums: 'albums', playlists: 'playlists', downloads: 'downloads' }`. PR 10c adds `mixes`.
    - **Playing:** choosing a node sends `{ type: 'playFromBrowse', id }`, and JS plays it with `playTracks`.
    - **Ids:** `album:<id>`, `playlist:<id>` and `track:<mediaId>`, parsed by a guard in `@raven/native`'s `browseTree.ts`.
    - **Cache:** native keeps the last answer per parent (UserDefaults or SharedPreferences, JSON). When JS has not answered within 3 s (the app not yet running), native answers from that cache. With no cache it shows one node, "Open Wren on your phone".
11. **The loudness scan fills the gains that the tags left empty.** Its template is `MarkerDetection`.
    - **Migration 45:** `tracks.loudness_state` (`'pending'`, `'done'` or `'failed'`), `tracks.loudness_version`, and `tracks.replaygain_source` and `albums.replaygain_source` (`'tags'` or `'scan'`).
    - **Track gain:** ffmpeg `-nostats -i <file> -map 0:a:0 -filter:a ebur128=peak=true -f null -`, with the summary parsed from stderr. `trackGain = -18 - integratedLufs`, where -18 LUFS is ReplayGain 2.0's reference. `trackPeak = 10^(truePeakDbtp / 20)`.
    - **Album gain:** `albumLufs = 10 * log10(Σ(dᵢ · 10^(Lᵢ / 10)) / Σdᵢ)` over the album's tracks, weighted by duration, and `albumGain = -18 - albumLufs`. `albumPeak` is the highest track peak.
    - **Scheduling:** the scan is gated by `LOUDNESS_SCAN` (`flag`, default on). It yields to playback as markers do, and runs at the lowest CPU priority.
    - **ffmpeg:** `FfmpegService` gains `analyseErr(args): Promise<string>`, which resolves stderr.
12. **Levelling is a volume factor, applied by each engine.**
    - **API:** `isTrack` gains `gain: { track: number | null, album: number | null, trackPeak: number | null, albumPeak: number | null }`.
    - **Core:** `levelOf({ track, mode })` returns `min(10^(gain / 20), 1 / peak, 1)`, for `mode` in `LEVELLING_MODES = { off, track, album }` (default `album`). An album gain falls back to the track gain.
    - **Web:** the factor multiplies the volume.
    - **Raven:** mpv sets `replaygain=no` and puts `volume=<dB>dB` first in its `af` lavfi chain.
    - **`@raven/audio`:** applies it in the same audio processor as the EQ (ruling 14).
13. **Crossfade overlaps tracks where an engine can.**
    - **Values:** `CROSSFADE_SECONDS = [0, 2, 4, 6, 8, 12]`, with 0 (off) the default.
    - **Web:** at `duration - seconds`, the preloaded element starts and the two gains ramp linearly through Web Audio.
    - **`@raven/audio`:** a second player plays the overlap (an `AVQueuePlayer` on Apple, a second ExoPlayer on Android). Now Playing and the media session stay on the lead player, which takes over the next item when the overlap ends.
    - **Raven:** mpv cannot overlap two files on one instance, so Raven's mpv engine does not crossfade. Its setting reads "Crossfade plays in the browser and in Wren; Raven's player joins it later."
14. **The EQ is ten bands.**
    - **Bands:** `EQ_BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]` Hz, one octave wide, with gains from -12 to +12 dB.
    - **Presets:** `EQ_PRESETS` are `flat`, `bassBoost`, `trebleBoost`, `vocal` and `loudness`, with the gains given in Task 22.
    - **Web:** `BiquadFilterNode`s (`peaking`, `Q = 1.41`) between a `MediaElementAudioSourceNode` and the destination. The media plane already sends CORS (`mediaPlaneCors.ts`), so the elements set `crossOrigin="anonymous"`.
    - **Raven:** `af=lavfi=[volume=…,equalizer=f=32:t=o:w=1:g=…,…]`.
    - **`@raven/audio`:**
      - Apple: an `MTAudioProcessingTap` on each item's `audioMix`, running biquads with `vDSP_biquad`.
      - Android: a Media3 `AudioProcessor` with the same coefficients, plus the levelling gain.
    - **API:** `audioPlayer.setSound({ level, eq: number[], crossfade })` replaces three separate calls.
15. **Mixes come from plays, and radio from ListenBrainz similarity.**
    - **Routes:** `GET /api/music/mixes` returns `MixSummary[]`, and `GET /api/music/mixes/:id` returns `MixDetails`. Each mix has up to 50 tracks and is deterministic for a calendar day (seeded by the date).
    - **`MIX_KINDS`:**
      - `heavyRotation`: the most played in 30 days, plus unplayed tracks by those artists.
      - `rediscover`: played at least three times, and not in the last 90 days.
      - `onThisDay`: played on this date in an earlier year.
      - `recentlyAdded`: tracks of albums added in the last 30 days.
      - A mix with fewer than 10 tracks is left out.
    - **Radio:** `GET /api/music/radio?seed=` takes `track:<mediaId>`, `artist:<id>` or `album:<id>`, and returns 50 tracks.
      - **Order:** the seed artist's tracks, then tracks by ListenBrainz similar artists held in the library, then the same genre, then the whole library.
      - **Exclusions:** tracks played in the last 24 hours are left out.
      - **Order of play:** interleaved so that no artist plays twice in a row where avoidable.
    - **Similar artists:** `similar_artists(artist_id, similar_id, score, fetched_at)` caches them for 30 days. They come from `ListenBrainzClient.similarArtists(mbid)`, at 1 request a second with `RAVEN_USER_AGENT`. An artist with no mbid skips that step.
    - **Recent albums:** `GET /api/music/recent` returns `{ played: AlbumSummary[], added: AlbumSummary[] }` (20 each) for Home.
    - **Queue sources:** core's `QUEUE_SOURCE_KINDS` gains `mix` and `radio`. A radio source's id is the seed's numeric id, and its kind is kept in `RADIO_SEED_KINDS`.
16. **Scrobbling is per account, and forwarded from the server.**
    - **Tables:**
      - `scrobble_links(account_id, service, username, secret_cipher, created_at, PK(account_id, service))`. The secret is AES-256-GCM under a key from `settings.secretAt('scrobble')`, stored as `iv.tag.cipher` in base64url.
      - `scrobble_queue(id, account_id, service, media_id, listened_at, attempts, next_at)`.
    - **Services:** `SCROBBLE_SERVICES = { listenBrainz, lastFm }`.
    - **Routes:** all are `@ForViewers()` under `api/me/scrobbling`, and the `'local'` account may link too.
      - `GET /` returns `ScrobbleStatus[]`: `{ service, isAvailable, username | null }`.
      - `PUT /listenbrainz` takes `{ token }`, checked with ListenBrainz's `GET /1/validate-token`.
      - `POST /lastfm/start` takes `{ returnTo }`, which must match `SCROBBLE_RETURNS` (the web's `/settings` or `wren://scrobbling`). It returns `{ url }` for Last.fm's `auth` page, with a signed one-use `state`.
      - `GET /lastfm/callback?token=&state=` is `@OpenToAnyone()`, since `state` names the account. It runs `auth.getSession` (signed with md5 per Last.fm's API), stores the session key, and redirects to `returnTo`.
      - `DELETE /:service`.
    - **Forwarding:** `recordPlay` on a music track queues one row per linked service, with `listened_at = now - min(duration / 2, 240)`.
    - **`ScrobbleSender`:**
      - drains the queue at 1 request a second per service;
      - retries with backoff (1 min, doubling, capped at 6 h) and drops a row after 7 days;
      - a 401 unlinks the service.
    - Now-playing updates are deferred.
17. **Shared playlists can be read by every account, and edited only by their owner.**
    - **Migration 48:** adds `playlists.is_shared` (default 0).
    - **Contract:** `isPlaylistSummary` gains `isShared` and `isOwn`.
    - **Listing:** `GET /api/playlists` lists your own playlists and everyone's shared ones.
    - **Sharing:** `PUT /api/playlists/:id/sharing` takes `{ isShared }` and works only on your own.
    - **Copying:** `POST /api/playlists/:id/copy` copies one you can see into a new playlist of your own.
    - **Writes:** any other write to a playlist you don't own answers 404, as if it were missing.
    - **Locked tracks:** a locked library's tracks stay hidden as today.
18. **The `/music` mode is a second shell over the same audio host.**
    - **Mounting:** `AudioHost`/`DesktopAudioHost` and the now-playing bar move out of `AppShell` into a `PlayerLayer` route element that wraps both `AppShell` and `MusicShell`, so switching modes keeps playing.
    - **Paths:** `MUSIC_PATHS` in `apps/raven/web/src/lib/music.ts` lists them: `root '/music'`, `albums`, `artists`, `songs`, `playlists`, `album '/music/albums/:id'`, `artist`, `playlist`, `mix '/music/mixes/:id'`, `nowPlaying`, `search`, `downloads` (desktop).
    - **Pages:** the album, artist, playlist and Now Playing pages are reused, and their links come from `useMusicLinks()`, which picks the paths for the current mode.
    - **Entry:** AppShell's nav gains "Music" when a music library exists. MusicShell has "Back to raven".

## Review Focus

- **A dropped connection mid-download, on Wren and Raven:** the partial file is never played, and the next try resumes or restarts. Task 13 tests a `.part` file that is never adopted. Task 15 tests a failed download that leaves no entry.
- **A cold first transcode while a listener waits:** `/transcode` for an uncached FLAC answers with the whole file, and two requests at once run one ffmpeg. Task 10 tests both with `once`.
- **A track whose loudness scan fails** (a corrupt or zero-length file): it is marked `failed`, never retried in a loop, and plays at factor 1. Tasks 17 and 18 test this.
- **A Last.fm callback with a stale or replayed `state`, or a `returnTo` not on the list:** the answer is 400 and nothing is stored. Task 20 tests it.
- **Shuffle and repeat over a radio or mix queue,** and a queue holding a locked library's track: shuffle and repeat behave as for an album, and a locked track never appears. Task 19 tests the server side and Task 23 the store.

## PR stack

| PR | Branch | Base | Tasks |
| -- | ------ | ---- | ----- |
| 8 | `raven-music-app` | `main` | 1 to 8 |
| 9 | `raven-music-offline` | `raven-music-app` | 9 to 16 |
| 10a | `raven-music-discovery-server` | `raven-music-offline` | 17 to 21 |
| 10b | `raven-music-discovery-web` | `raven-music-discovery-server` | 22 to 25 |
| 10c | `raven-music-discovery-app` | `raven-music-discovery-web` | 26 to 28 |

Each PR ends with three steps: `bun run verify`, the thermo review commit, and push plus `gh pr create --base <base>`. They are not repeated per PR below.

---

## PR 8: Wren

### Task 1: the spec amendment, and `@raven/native`

**Files:**
- Modify: `docs/superpowers/specs/2026-10-27-raven-audio-design.md`:
  - section 9's "upstream React Native" bullet, which becomes the fork, with ruling 1's reason;
  - a PR 8 tip, noting Wren, `app.netlify.wren` and the sharing, transcode and CI decisions.
- Create: `libs/raven/native/` with `package.json` (`@raven/native`, `nx.includedScripts` as `@raven/audio`'s), `tsconfig.json` (extends `tooling/tsconfig/react-native.json`), `.oxlintrc.json`, `.oxfmtrc.json` and `src/index.ts`.
- Move, with `git mv`, from `apps/raven/app/src/` to `libs/raven/native/src/`, together with their tests:
  - from `account/`: `accountSession.ts`, `supabaseAuth.ts`, `refreshingFetch.ts`;
  - from `servers/`: `serverClient.ts`, `serverFetch.ts`, `cookieJar.ts`, `allowlist.ts`, `activeServerStore.ts`, `secretStore.ts`, `deviceSecretStore.ts`, `tickets.ts`, `mediaAccess.ts`;
  - `music/nativePlayer.ts`.
- Move: `apps/raven/app/src/layouts/musicRows.ts`, `music/musicCards.ts` and `music/playlistOrder.ts` to `libs/raven/ui/src/music/`, exported from `headless.ts`.
- Modify: every importer in `apps/raven/app`, the `knip.ts` workspace entry, and the root `dead-code` target's `dependsOn`, which gains `@raven/native:build`.

**Interfaces:**
- Produces:
  - `createAccountSession({ storageKey: string }): UseBoundStore<AccountSessionStore>`, a factory replacing the module singleton. The app passes `'raven.account'`, and Wren `'wren.account'`.
  - `apiFor({ server, session }): ApiClient`.
  - `mediaAccessFor(...)`, unchanged.
  - `nativePlayerOf({ audio, itemOf })`, unchanged.
  - Every moved name is re-exported only from `@raven/native`'s `src/index.ts`.

- [ ] **Step 1:** Move the files and turn the session singleton into `createAccountSession`. `@raven/app` creates its instance in `src/account/session.ts`.
- [ ] **Step 2:** Run `bunx nx run-many -t typecheck test test:screens -p @raven/native @raven/app @raven/ui`. Expect PASS with the same test counts as before the move.
- [ ] **Step 3:** Run `bunx nx run dead-code` (from the root: `bun run dead-code`). Expect no unused export and no unlisted dependency.
- [ ] **Step 4:** Commit: `MAE: move the device app's sign-in and media access into @raven/native`.

### Task 2: core's audio play table

**Files:**
- Create: `libs/raven/core/src/canPlayAudio.ts`, `canPlayAudio.test.ts`.

**Interfaces:**
- Produces: `AUDIO_PLATFORMS = { apple, android, browser }` and `canPlayAudio({ platform, codec, container }): boolean`. It follows the spec's codec table: Apple refuses Opus in WebM, and Android refuses ALAC.

- [ ] **Step 1:** Write the tests: `canPlayAudio({platform:'android', codec:'alac', container:'m4a'})` is false; Apple with `opus` in `webm` is false and in `ogg` is true; FLAC, MP3 and AAC are true on both.
- [ ] **Step 2:** Run `bunx nx run @raven/core:test`. Expect FAIL.
- [ ] **Step 3:** Implement it, with each platform's refusals as an `as const` object.
- [ ] **Step 4:** Run the tests again. Expect PASS. Commit: `MAE: core says which audio a phone's player decodes`.

### Task 3: the Wren project

**Files:**
- Create in `apps/raven/music/`:
  - `package.json`: `@raven/music`, the pins of `@raven/app`, no `react-native-video` or `config-tv`, deps `@raven/audio`, `@raven/native`, `@raven/core` and `@raven/ui`.
  - `app.config.ts`: name `Wren`, slug `wren`, scheme `wren`, `APP_ID = 'app.netlify.wren'` for both platforms, `supportsTablet: true`, `UIBackgroundModes: ['audio']`, and the Android `FOREGROUND_SERVICE_MEDIA_PLAYBACK` permission.
  - `metro.config.ts`, `babel.config.ts`, `index.ts`, `tsconfig.json`, `tsconfig.node.json`, `.oxlintrc.json`, `.oxfmtrc.json`, `CLAUDE.md`.
  - `src/polyfills.ts`: the app's polyfills, imported from `@raven/native`, which moves them there.
  - `src/test/jestSetup.ts`.
- Modify: `knip.ts`, which gets an `apps/raven/music` entry like the app's, and the root `CLAUDE.md` table, with an `@raven/music` row.

**Interfaces:**
- Produces: Nx targets `prebuild:ios`, `prebuild:android`, `build:ios`, `build:android`, `dev:ios`, `dev:android`, `start`, `typecheck`, `lint:ts`, `format:check`, `test`, `test:screens`, `e2e`.

- [ ] **Step 1:** Write `src/config/appConfig.test.ts`, asserting that `app.config.ts` exports `ios.bundleIdentifier === 'app.netlify.wren'`, `android.package === 'app.netlify.wren'` and `scheme === 'wren'`.
- [ ] **Step 2:** Scaffold the project, and run `bun install` from the root. Expect `bun.lock` to change with no new `react-native` entry.
- [ ] **Step 3:** Run `bunx nx run-many -t typecheck lint:ts format:check test -p @raven/music`. Expect PASS.
- [ ] **Step 4:** Run `bunx nx run @raven/music:prebuild:ios`, then `build:ios`. Expect `** BUILD SUCCEEDED **`.
- [ ] **Step 5:** Commit: `MAE: add Wren, raven's music app, as @raven/music`.

### Task 4: `@raven/audio` on Android

**Files:**
- Create in `libs/raven/audio/android/`:
  - `build.gradle`, which declares Media3 `exoplayer`, `session` and `datasource-okhttp` at the pinned version;
  - `src/main/AndroidManifest.xml`, which declares `RavenAudioService` (a `MediaLibraryService`, `foregroundServiceType="mediaPlayback"`);
  - `src/main/java/expo/modules/ravenaudio/RavenAudioModule.kt` and `RavenAudioService.kt`.
- Modify: `libs/raven/audio/expo-module.config.json` (`platforms: ["apple", "android"]`, `android.modules`) and `README.md`.

**Interfaces:**
- Consumes: the unchanged JS contract in `src/index.ts`.
- Produces:
  - The module is named `RavenAudio`. It has the same functions as Swift (`setWindow(items, shouldPlay, start)`, `setNext`, `play`, `pause`, `seekTo`, `setVolume`, `setRate`, `stop`) and the same `onAudioEvent` payloads.
  - Headers go through `DefaultHttpDataSource.Factory().setDefaultRequestProperties` per item. Media3 gets the title, artist, album, artwork and duration through `MediaMetadata`.
  - Media buttons and the notification come from the session. Their commands reach JS as `{ type: 'remote', command }`.

- [ ] **Step 1:** Write the window logic as a pure Kotlin class, `AudioWindow` (items in, a list of `MediaItem` ids and the events to send out). Write the JVM unit tests `AudioWindowTest.kt` for:
  - `setNext` replacing only the item after the current one;
  - a transition sending `advanced`;
  - the last item ending, which sends `ended` and pauses.
- [ ] **Step 2:** Run `./gradlew :raven-audio:testDebugUnitTest` inside a prebuilt Wren `android/`. Expect FAIL.
- [ ] **Step 3:** Implement `AudioWindow`, then the module and the service over it. The service's `onGetLibraryRoot` returns `BROWSE_ROOTS.home` with no children until Task 14.
- [ ] **Step 4:** Run the unit tests (expect PASS), then `bunx nx run @raven/music:build:android`. Expect `BUILD SUCCESSFUL`.
- [ ] **Step 5:** Commit: `MAE: @raven/audio plays on Android through Media3`.

### Task 5: sign-in and the shell

**Files:**
- Create in `apps/raven/music/`:
  - `app/_layout.tsx` (`WrenRoot`) and `app/sign-in.tsx`;
  - `app/(tabs)/_layout.tsx`, `index.tsx`, `library.tsx`, `search.tsx`, `settings.tsx`;
  - `src/WrenRoot.tsx`, `src/routes.ts` (`WREN_ROUTES`), `src/session.ts` (`createAccountSession({storageKey: 'wren.account'})`);
  - `src/screens/SignIn.tsx` and `src/screens/Settings.tsx` (account, server, sign out, version), each with a `.render.test.tsx`.

**Interfaces:**
- Consumes: `@raven/native`'s session, `apiFor`, `useAppQueries`-style wiring (moved in Task 1 if it is in the list), `RAVEN_SERVER`, and the PIN step through `getLock`/`unlock`.
- Produces: `useWren(): WrenSession | null`, where `WrenSession = { server, api, queries }`.

- [ ] **Step 1:** Write the render tests. Each one uses a fake `api`. The sign-in tests check that wrong credentials show the auth outcome's copy, and that a locked server asks for the PIN. The Settings test checks that "Sign out" clears the session and lands on `/sign-in`.
- [ ] **Step 2:** Run `bunx nx run @raven/music:test:screens`. Expect FAIL.
- [ ] **Step 3:** Implement the screens, the token refresh timer (60 s before expiry, as in `AppRoot`) and the protected tab group.
- [ ] **Step 4:** Run the tests again. Expect PASS. Commit: `MAE: Wren signs in to raven`.

### Task 6: library, album, artist, playlist and search

**Files:**
- Create in `apps/raven/music/`:
  - routes: `app/album/[id].tsx`, `app/artist/[id].tsx`, `app/playlist/[id].tsx`;
  - screens: `src/screens/Home.tsx` (Recently added, from `listAlbums` `sort=added`, `limit=20`, per music library), `Library.tsx` (Albums, Artists, Songs and Playlists segments, paged at `MUSIC_PAGE.most`), `Album.tsx`, `Artist.tsx`, `Playlist.tsx`, `Search.tsx`;
  - `src/components/` with `AlbumTile`, `TrackRow` (with a long-press menu: Play next, Add to queue, Add to playlist) and `Segments`.
- Test: a `.render.test.tsx` beside each screen.

**Interfaces:**
- Consumes: `ravenQueriesFor(api)` (`albumQuery`, `albumsQuery`, `artistQuery`, `artistsQuery`, `playlistQuery`, `playlistsQuery`), `useSearch`, `useServerPlaylistMutations`, `useServerAlbumFavourite`, `useServerArtistFavourite`, the headless `albumDiscsOf` and `playlistTracksOf`, and `useAudioQueue().playTracks`.

- [ ] **Step 1:** Write the render tests:
  - Album lists the discs in order, and "Play" calls `playTracks` with `source: {kind:'album', id}`.
  - A row's "Play next" calls `playNext`.
  - Library's Songs segment asks for the next page on scroll end.
  - Search shows the albums, artists and tracks it was answered with.
- [ ] **Step 2:** Run them. Expect FAIL.
- [ ] **Step 3:** Implement the screens.
- [ ] **Step 4:** Run them again. Expect PASS. Commit: `MAE: Wren browses albums, artists, playlists and songs`.

### Task 7: playing, the bar, Now Playing, the queue and lyrics

**Files:**
- Create in `apps/raven/music/`:
  - `src/music/WrenAudioHost.tsx`, the counterpart of `MusicHost.tsx` with no TV branch;
  - `src/music/itemOf.ts`;
  - `src/components/NowPlayingBar.tsx`;
  - `app/now-playing.tsx` (a `presentation: 'modal'` sheet);
  - `src/screens/NowPlaying.tsx`, with cover, scrubber, previous, next, shuffle, repeat, volume, a lyrics pane with tap-to-seek, a queue pane with move up and remove, and an audiobook speed for audiobooks.

**Interfaces:**
- Consumes: `nativePlayerOf`, `useWindowedAudioHost({api, player, watchHide})`, `useTrackRate`, `runRemoteCommand`, `lyricsQuery`, `activeLineAt`, `queueRowsOf`, `canPlayAudio`.
- Produces: `itemOf({ server, track, platform }): Promise<AudioItem | null>`. It returns null when `canPlayAudio` refuses the track, and the host then calls `engine.failed(COULD_NOT_PLAY)` and moves to the next track.

- [ ] **Step 1:** Write `itemOf.test.ts` (bun): ALAC on Android gives null; FLAC on Apple gives the `/file` uri with the ticket. Write `NowPlaying.render.test.tsx`: a tapped lyric line calls `seekTo` with its time, and "Move up" calls `move`.
- [ ] **Step 2:** Run them. Expect FAIL.
- [ ] **Step 3:** Implement the host, the bar (hidden while the sheet is open) and the sheet.
- [ ] **Step 4:** Run them again. Expect PASS.
- [ ] **Step 5:** Check by hand: `dev:ios` on the iPhone simulator plays an album from the fixture server, and the Now Playing info shows in `xcrun simctl` logs.
- [ ] **Step 6:** Commit: `MAE: Wren plays albums, with Now Playing, the queue and lyrics`.

### Task 8: CI and end to end

**Files:**
- Create:
  - `apps/raven/music/e2e/signIn.yaml` and `playAlbum.yaml` (Maestro, `appId: app.netlify.wren`, fixture server `127.0.0.1:8490`, PIN `1357`);
  - `scripts/ci_wren.sh`, a local runner like `ci_app_ios.sh`.
- Modify:
  - `.github/workflows/pull-request-checks.yml`:
    - the `app-affected` job gains a `music` output (`@raven/music`, `@raven/native`, `@raven/audio` or `@raven/server` affected, or the workflow changed);
    - a new `music` job, `🎵 Wren`: on macOS it runs `build:ios`, boots an iPhone simulator `wren-phone` and runs Maestro; on Linux it runs `build:android`;
    - `🖥️ Desktop` accepts `success` or `skipped` for it.
  - `.github/actions/raven-app-setup`: it builds `@raven/native` too.
  - The root `CLAUDE.md` paragraph on the native targets, which names Wren's.

- [ ] **Step 1:** Run `bash scripts/ci_wren.sh` locally. Expect both flows to pass: `signIn.yaml` sees the Home tab, and `playAlbum.yaml` sees the bar's title change after "Play".
- [ ] **Step 2:** Run `actionlint .github/workflows/pull-request-checks.yml`. Expect no findings.
- [ ] **Step 3:** Commit: `MAE: run Wren's end to end checks on iOS and build it for Android`.

---

## PR 9: offline, CarPlay and Android Auto

### Task 9: bitrates and the transcode contract in core

**Files:**
- Modify: `libs/raven/core/src/contract/streaming.ts` (`AUDIO_BITRATES`, `isAudioBitrate`), `apiClient/playback.ts` (`transcodeUrl`), `appClientCalls.ts`.
- Test: `streaming.test.ts`, `apiClient/playback.test.ts`.

**Interfaces:**
- Produces: `AUDIO_BITRATES = { low: 128, standard: 256, high: 320 } as const`, `type AudioBitrate`, and `api.transcodeUrl({ mediaId, kbps, ticket }): string`, which gives `/api/media/:id/transcode?kbps=&t=`.

- [ ] **Step 1:** Write the tests: `isAudioBitrate(192)` is false and `isAudioBitrate(256)` true; `transcodeUrl` encodes `kbps` and `t`.
- [ ] **Step 2:** Run them (FAIL), implement, run again (PASS). Commit: `MAE: core names the audio bitrates and the transcode URL`.

### Task 10: the server's transcode cache and route

**Files:**
- Create: `apps/raven/server/src/music/transcodeCache.ts`, `transcodeCache.test.ts`.
- Modify:
  - `server/media/mediaController.ts` (`transcode`);
  - `server/config.ts` (`transcodeCacheBytes`, from `TRANSCODE_CACHE_GB`, through a new `MUSIC_ENV` constant);
  - `appModule.ts`;
  - `server/test/enforced.ts`, `appLock.test.ts`, `appClients.test.ts`;
  - `apps/raven/.env.example`.

**Interfaces:**
- Produces:
  - `TranscodeCache.fileFor({ mediaId, path, mtimeMs, kbps }): Promise<string>`, which returns the cached path and makes it once.
  - `TranscodeCache.sweep(): Promise<void>`, which evicts to the cap and removes orphans.
  - On `onApplicationBootstrap`, a sweep runs every 6 h.

- [ ] **Step 1:** Write the tests, with `encodeTrack` FLAC fixtures:
  - The first call makes `<mtimeMs>-256.m4a`, and ffprobe reads `aac` at about 256k.
  - Two calls at once run ffmpeg once (count it through a spy on `FfmpegService.exec`).
  - A changed mtime makes a new file and removes the old one.
  - With the cap at 1 byte, `sweep` keeps only the most recently served file.
  - `GET /api/media/:id/transcode?kbps=256&t=<ticket>` answers 200, `audio/mp4`, and serves `Range: bytes=0-99` with a 206.
  - `kbps=192` answers 400. A video media answers 409. A locked library answers 423.
- [ ] **Step 2:** Run `bunx nx run @raven/server:test -- transcodeCache appLock appClients`. Expect FAIL.
- [ ] **Step 3:** Implement ruling 7.
- [ ] **Step 4:** Run the tests again. Expect PASS. Commit: `MAE: the server caches AAC transcodes of tracks for offline and cellular`.

### Task 11: album and playlist targets in core

**Files:**
- Modify:
  - `libs/raven/core/src/playLink.ts` (`DOWNLOAD_TARGET_KINDS` gains `album` and `playlist`; `isDownloadTarget`);
  - `desktop/protocol.ts` (`DOWNLOAD_KINDS` gains `album` and `playlist`; `isDownloadGroup` accepts `album:<id>` and `playlist:<id>`);
  - `protocol.test.ts` (the three assertions that rejected `'album'` now accept it, and `'track'` is rejected instead).

- [ ] **Step 1:** Update the tests (FAIL), implement, then run them (PASS). Commit: `MAE: downloads can name an album or a playlist`.

### Task 12: Raven downloads albums and playlists

**Files:**
- Modify:
  - `apps/raven/desktop/src/main/downloads/space.ts` (`videoPathFor` becomes `mediaPathFor`);
  - `expand.ts` (`draftOfAlbum` and `draftOfPlaylist`, through `getAlbum` and `getPlaylist`);
  - `servers/allowlist.ts` (`getAlbum` and `getPlaylist` calls);
  - every caller of `videoPathFor`.
- Modify (web):
  - `AlbumPage` and `PlaylistPage` (a `DownloadButton` with `target: {kind:'album', id}` or `{kind:'playlist', id}`);
  - `DownloadsPage` (the album and playlist groups, with the album cover and track count).

**Interfaces:**
- Produces: `mediaPathFor({ dir, container }): string`, which gives `media.<container>` for `isAudioContainer(container)`, and `video.<container>` otherwise.

- [ ] **Step 1:** Write the tests:
  - `space.test.ts`: `mediaPathFor` gives `media.flac` and `video.mkv`.
  - `expand.test.ts`: an album target expands to one entry per track in disc order, grouped under `album:<id>`; a playlist skips a locked track.
  - `DownloadsPage.test.tsx`: an album group shows its title and "12 tracks".
- [ ] **Step 2:** Run `bunx nx run-many -t test -p @raven/desktop @raven/web`. Expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests again. Expect PASS. Commit: `MAE: Raven downloads albums and playlists`.

### Task 13: Raven plays downloaded music offline

**Files:**
- Modify: `apps/raven/desktop/src/main/player/audioPlayer.ts` (`resolve` tries `downloads.openTitle` first), `main.ts` (passes `downloads`).
- Test: `audioPlayer.test.ts`.

- [ ] **Step 1:** Write the tests:
  - With a download for media 7, `resolve(7)` gives `{kind: PLAYER_SOURCE_KINDS.file}` and asks for no ticket.
  - With none, it asks the server.
  - A `.part` file is never chosen.
- [ ] **Step 2:** Run them (FAIL), implement, run again (PASS). Commit: `MAE: Raven plays downloaded tracks with no server`.

### Task 14: the browse bridge in `@raven/audio` and `@raven/native`

**Files:**
- Modify: `libs/raven/audio/src/contract.ts` (the `browse` and `playFromBrowse` events; `BrowseNode`, `isBrowseNode`, `BROWSE_ROOTS`), `src/index.ts` (`answerBrowse`).
- Create: `libs/raven/native/src/browseTree.ts`, `browseTree.test.ts`.

**Interfaces:**
- Produces:
  - `audioPlayer.answerBrowse({ requestId, nodes }): Promise<void>`.
  - `browseChildrenOf({ api, downloads, parentId }): Promise<BrowseNode[]>`.
  - `browseIdOf` and `parseBrowseId(id): BrowseTarget | null`, where `BrowseTarget` is a union on `kind` (`album`, `playlist` or `track`).
  - `tracksForBrowse({ api, downloads, id }): Promise<Track[]>`.

- [ ] **Step 1:** Write the tests:
  - The root gives Albums, Playlists and Downloads.
  - `albums` gives the most recently added 100 albums as playable nodes with their cover URLs.
  - `parseBrowseId('album:x')` is null.
  - Offline, `albums` gives the downloaded albums only.
- [ ] **Step 2:** Run them (FAIL), implement, run again (PASS). Commit: `MAE: one browse tree for CarPlay and Android Auto`.

### Task 15: Wren downloads and plays offline

**Files:**
- Create in `apps/raven/music/`:
  - `src/downloads/downloadStore.ts` (zustand, persisted to AsyncStorage under `wren.downloads`, guarded on read);
  - `src/downloads/downloader.ts` (`expo-file-system`'s `createDownloadResumable` to a `.part` file, then a move);
  - `src/screens/Downloads.tsx`;
  - a Download button on Album and Playlist;
  - the Settings rows: Download quality, Cellular quality, Storage limit, storage used, Remove all downloads.
- Modify: `src/music/itemOf.ts` (ruling 9's order).

**Interfaces:**
- Produces:
  - `useDownloads`, with `entries: Record<number, DownloadEntry>` and the actions `downloadTracks({ tracks, album })`, `remove({ mediaIds })` and `removeAll()`.
  - `DownloadEntry = { mediaId, serverId, kbps, bytes, path, track, album, status }`, where the status comes from `DOWNLOAD_STATUSES = { queued, downloading, done, failed }`.

- [ ] **Step 1:** Write the tests:
  - `downloadStore.test.ts`: past the storage limit, `downloadTracks` refuses with the limit message; a failed download leaves `failed` and no file; `removeAll` deletes the folder.
  - `itemOf.test.ts`: a downloaded track gives `file://…/media.m4a` with `{}` headers; on cellular, `transcodeUrl` at 256; ALAC on Android now gives the transcode, not null.
- [ ] **Step 2:** Run them (FAIL), implement, run again (PASS).
- [ ] **Step 3:** Commit: `MAE: Wren downloads albums and playlists and plays them offline`.

### Task 16: CarPlay and Android Auto

**Files:**
- Create:
  - `libs/raven/audio/ios/RavenCarPlay.swift` (a `CPTemplateApplicationSceneDelegate`: a `CPTabBarTemplate` of `CPListTemplate`s for Albums, Playlists and Downloads, filled through the browse bridge, with the cache and the 3 s fallback of ruling 10);
  - `apps/raven/music/plugins/withCarPlay.ts` (the entitlement, the `UIApplicationSceneManifest` CarPlay scene and the `audio` background mode);
  - `plugins/withAndroidAuto.ts` (the `automotive_app_desc.xml` and its `com.google.android.gms.car.application` meta-data).
- Modify:
  - `RavenAudioService.kt`: `onGetChildren` and `onGetItem` go through the bridge, with the cache in `SharedPreferences` and the same fallback.
  - `src/music/WrenAudioHost.tsx`: it answers `browse`, and plays `playFromBrowse` through `tracksForBrowse` and `playTracks`.
  - `apps/raven/music/CLAUDE.md`: the entitlement, and how to run the CarPlay simulator and the Android Auto desktop head unit.
  - The spec's PR 9 tip.

- [ ] **Step 1:** Write `BrowseCacheTest.kt` (JVM) and `WrenAudioHost` bun tests:
  - A `browse` event gets an `answerBrowse` with the same `requestId`.
  - `playFromBrowse('album:3')` calls `playTracks` with album 3's tracks.
  - Native with no answer in 3 s serves the cache, and with no cache the one "Open Wren on your phone" node.
- [ ] **Step 2:** Run them (FAIL), implement, run again (PASS).
- [ ] **Step 3:** Check by hand: in the CarPlay simulator (Xcode's I/O > External Displays > CarPlay), the tabs show and an album plays. On the Android Auto desktop head unit, the browse tree lists albums. Note in the PR any check that could not be run.
- [ ] **Step 4:** Commit: `MAE: Wren in CarPlay and Android Auto`.

---

## PR 10a: discovery on the server

### Task 17: loudness scan

**Files:**
- Create: `apps/raven/server/src/music/loudnessScan.ts`, `loudnessJobs.ts`, `loudness.ts` (pure parsing and maths), with tests beside each.
- Modify: `db/database.ts` (migration 45), `ffmpeg/ffmpegService.ts` (`analyseErr`), `musicRepository.ts`, `config.ts` (`LOUDNESS_SCAN` in `MUSIC_ENV`), `appModule.ts`, `metadataService.ts` (the scan is kicked after matching).

**Interfaces:**
- Produces:
  - `parseEbur128(stderr): { integrated: number, truePeak: number } | null`.
  - `trackGainOf({ integrated, truePeak }): { gain, peak }`.
  - `albumGainOf(tracks: { integrated, duration }[]): number`.
  - `LoudnessScan.kick()` and `whenIdle()`.
  - `LOUDNESS_VERSION = 1`.

- [ ] **Step 1:** Write the tests:
  - `loudness.test.ts`:
    - `parseEbur128` reads `I: -14.2 LUFS` and `Peak: -0.8 dBFS` from a captured summary.
    - `trackGainOf({integrated:-14.2, truePeak:-0.8})` gives a gain of `-3.8` and a peak of `≈0.912`.
    - `albumGainOf` of `-10` for 60 s and `-20` for 60 s gives `≈ -18 - (-12.6)`.
  - Scan tests:
    - A tagless fixture gets `replaygain_source='scan'`.
    - A tagged one is untouched.
    - A zero-byte file ends `failed` and is not retried.
    - The database test's `user_version` is 45.
- [ ] **Step 2:** Run them (FAIL), implement ruling 11, run again (PASS). Commit: `MAE: the server measures loudness where the tags have none`.

### Task 18: gains in the API, and `levelOf`

**Files:**
- Modify: `libs/raven/core/src/contract/music.ts` (`isTrack` gains `gain`), the server's track mapping, `libs/raven/core/src/levelling.ts` (new, with `LEVELLING_MODES` and `levelOf`).

- [ ] **Step 1:** Write the tests:
  - `levelOf` with mode `off` gives 1.
  - With `album`, a gain of `-6` and a peak of `0.5` give `≈0.501`.
  - A `+6` gain gives at most 1.
  - A `null` album gain falls back to the track gain, and a failed scan (all null) gives 1.
  - `appMusic.test.ts` sees `gain` on an album's tracks.
- [ ] **Step 2:** Run them (FAIL), implement, run again (PASS). Commit: `MAE: tracks carry their loudness gain`.

### Task 19: mixes, radio and recent albums

**Files:**
- Create:
  - `apps/raven/server/src/music/mixes.ts`, `radio.ts`, `listenBrainzClient.ts`, `similarArtists.ts`, `mixesController.ts` (`api/music`), with tests;
  - `server/test/fakeListenBrainz.ts`;
  - `libs/raven/core/src/contract/mixes.ts` (`MIX_KINDS`, `isMixSummary`, `isMixDetails`, `RADIO_SEED_KINDS`, `isRadioSeed`, `isRecentAlbums`);
  - `apiClient/mixes.ts`.
- Modify:
  - `db/database.ts` (migration 46: `similar_artists`);
  - `core/queue.ts` (`mix` and `radio`);
  - `tmdbClient.ts`'s `MetadataFetch`, whose `init` gains an optional `method` and `body`;
  - `enforced.ts`, `appLock.test.ts`, `appClientCalls.ts`, `musicViewingPlans.test.ts`.

**Interfaces:**
- Produces: `listMixes()`, `getMix({ id })`, `getRadio({ seed })` and `getRecentAlbums()` on the API client. Mix ids are `<kind>` (one mix per kind).

- [ ] **Step 1:** Write the tests, with plays seeded through `ViewingRepository.recordPlay` and a mocked clock:
  - `heavyRotation` holds the three most played tracks.
  - A mix of 9 tracks is not listed.
  - The same day gives the same order, and the next day another.
  - Radio from `artist:<id>` puts that artist's tracks first, then a fake-ListenBrainz similar artist held in the library, and never one played in the last 24 h.
  - No two adjacent tracks share an artist when three artists are available.
  - A locked library's tracks never appear, and the routes answer 423 for a locked seed.
  - The plan assertions show indexes on `plays_account`.
- [ ] **Step 2:** Run them (FAIL), implement ruling 15, run again (PASS). Commit: `MAE: mixes and radio from play history and ListenBrainz`.

### Task 20: scrobbling

**Files:**
- Create in `apps/raven/server/src/scrobbling/`:
  - `scrobbleLinks.ts`, `scrobbleQueue.ts`, `scrobbleSender.ts`, `scrobbleCipher.ts`;
  - `listenBrainzScrobbler.ts` and `lastFmScrobbler.ts` (each `{ validate, send }`);
  - `scrobblingController.ts`;
  - tests for each, plus `server/test/fakeLastFm.ts`.
- Create: `libs/raven/core/src/contract/scrobbling.ts` (`SCROBBLE_SERVICES`, `isScrobbleStatus`, `isListenBrainzLink`, `isLastFmStart`, `SCROBBLE_RETURNS`) and `apiClient/scrobbling.ts`.
- Modify:
  - `db/database.ts` (migration 47: `scrobble_links` and `scrobble_queue`);
  - `config.ts` (`LASTFM_API_KEY` and `LASTFM_API_SECRET` in `MUSIC_ENV`);
  - `mediaController.recordPlay` (it queues);
  - `appAccountData.test.ts`, `enforced.ts`, `appLock.test.ts`, `appClientCalls.ts`, `.env.example`.

**Interfaces:**
- Produces:
  - `getScrobbling()`, `linkListenBrainz({ token })`, `startLastFm({ returnTo })` and `unlinkScrobbling({ service })` on the API client.
  - `ScrobbleSender.whenIdle()`.

- [ ] **Step 1:** Write the tests:
  - With no Last.fm keys, the status lists Last.fm with `isAvailable: false`, and `start` answers 409.
  - A bad ListenBrainz token answers 400 and stores nothing.
  - A linked account's `recordPlay` on a music track queues one row per service, and an audiobook queues none.
  - The sender posts ListenBrainz's `listens` JSON with `listened_at` per ruling 16.
  - A 503 retries after 1 min, a 401 unlinks, and a row past 7 days is dropped.
  - The Last.fm callback with a replayed `state` answers 400, and with a `returnTo` not in `SCROBBLE_RETURNS` answers 400.
  - The stored secret column never contains the token's plain text.
  - A logging spy over the whole suite never sees the token.
  - Another account sees nothing of the first's links.
- [ ] **Step 2:** Run them (FAIL), implement ruling 16, run again (PASS). Commit: `MAE: scrobble listens to ListenBrainz and Last.fm`.

### Task 21: shared playlists

**Files:**
- Modify:
  - `db/database.ts` (migration 48: `playlists.is_shared`);
  - `music/playlists.ts` (`share`, `copy`, `list` with shared);
  - `playlistsController.ts`;
  - `contract/playlists.ts` (`isShared` and `isOwn`; `isPlaylistSharing`);
  - `apiClient/playlists.ts` (`setPlaylistSharing` and `copyPlaylist`);
  - `appAccountData.test.ts`, `enforced.ts`, `appClientCalls.ts`.

- [ ] **Step 1:** Write the tests:
  - B lists A's shared playlist with `isOwn: false`.
  - B's rename, delete or track change of it answers 404.
  - B's copy makes B's own playlist, with the same tracks.
  - Unsharing hides it from B.
  - A locked library's track stays hidden in B's view.
- [ ] **Step 2:** Run them (FAIL), implement ruling 17, run again (PASS). Commit: `MAE: playlists can be shared with every account`.

---

## PR 10b: the `/music` mode, and sound settings, on the web and Raven

### Task 22: sound prefs and the web engine

**Files:**
- Modify: `libs/raven/ui/src/stores/playerPrefs.ts` (`musicQuality`: `original` or an `AudioBitrate`, default `original`; `levelling`; `crossfade`; `equalizer: { preset, gains }`; each in `partialize`).
- Create:
  - `libs/raven/core/src/equalizer.ts` (`EQ_BANDS`, `EQ_PRESETS`, `CROSSFADE_SECONDS`, `isEqualizer`);
  - `libs/raven/ui/src/components/AudioHost/soundGraph.ts` (the Web Audio graph);
  - `useCrossfade.ts`.
- Modify: `AudioHost.tsx` (`crossOrigin="anonymous"`, the source from `transcodeUrl` when `musicQuality` is a bitrate, the levelling factor, crossfade).

**Interfaces:**
- Produces:
  - `EQ_PRESETS`, in dB per band from 32 Hz up:
    - `flat`: all 0
    - `bassBoost`: `[6,5,4,2,0,0,0,0,0,0]`
    - `trebleBoost`: `[0,0,0,0,0,0,2,4,5,6]`
    - `vocal`: `[-2,-2,-1,0,2,4,4,2,0,-1]`
    - `loudness`: `[5,4,2,0,-1,-1,0,2,4,5]`
  - `soundGraph({ context, elements }): { setEq(gains), setLevel(factor), crossfade({ from, to, seconds }) }`.

- [ ] **Step 1:** Write the tests, with a fake `AudioContext` in happy-dom:
  - The `flat` preset makes ten filters at the band frequencies with gain 0.
  - `musicQuality: 256` loads a `/transcode?kbps=256` URL.
  - Crossfade at 6 s starts the next element at `duration - 6` and ramps the gains.
  - Crossfade at 0 keeps the current swap.
  - A track with levelling `album` multiplies the volume by `levelOf`.
- [ ] **Step 2:** Run `bunx nx run-many -t test -p @raven/ui @raven/core`. Expect FAIL. Implement rulings 12 to 14 for the web, then run again. Expect PASS.
- [ ] **Step 3:** Commit: `MAE: levelling, crossfade, EQ and bitrate steps on the web`.

### Task 23: the sound on Raven

**Files:**
- Modify:
  - `libs/raven/core/src/audioPlayer.ts` (`AUDIO_COMMANDS.sound`: `{ level, eq }`);
  - `apps/raven/desktop/src/main/player/audioService.ts` (`soundFilterOf({ level, eq }): string`, applied by `af` and `replaygain=no`; the music `load` carries `kbps` to `transcodeUrl` when set);
  - `apps/raven/web/src/desktop/audio/DesktopAudioHost.tsx` (it sends `sound` on change).

- [ ] **Step 1:** Write the tests:
  - `soundFilterOf({level:0.5, eq: flat})` gives `lavfi=[volume=-6.02dB]`.
  - A non-flat EQ appends ten `equalizer=f=…:t=o:w=1:g=…` filters.
  - A `sound` command sets `af` once, and `ao-reload` is not called.
  - The audio queue store's shuffle and repeat over a `radio` source behave as for an album.
- [ ] **Step 2:** Run them (FAIL), implement, run again (PASS). Commit: `MAE: Raven levels and equalises music through mpv`.

### Task 24: the `/music` mode

**Files:**
- Create in `apps/raven/web/src/`:
  - `components/PlayerLayer/PlayerLayer.tsx`;
  - `components/MusicShell/MusicShell.tsx` and `.module.scss`;
  - `pages/MusicHomePage/` (Recently played, Recently added, Mixes);
  - `pages/MixPage/` (play a mix);
  - `pages/MusicLibraryPage/` (Albums, Artists, Songs and Playlists across every music library);
  - `lib/useMusicLinks.ts`.
- Modify: `lib/music.ts` (`MUSIC_PATHS`), `AppRoutes.tsx`, `AppShell.tsx` (the host and bar move out; the "Music" nav item), the album, artist and playlist pages and the bar (links through `useMusicLinks`), and "Start radio" on a track row, an album and an artist.

- [ ] **Step 1:** Write the tests:
  - Going from `/albums/3` to `/music` keeps the same `<audio>` element playing; assert the element's identity.
  - On `/music/albums/3`, the artist link goes to `/music/artists/<id>`.
  - "Start radio" calls `playTracks` with `source: {kind:'radio'}`.
  - The Mixes shelf lists `listMixes`' answer.
  - At 320px wide the shell has no horizontal scroll (the viewport helper).
  - Every interactive control has a label.
- [ ] **Step 2:** Run `bunx nx run @raven/web:test`. Expect FAIL. Implement ruling 18, with grid layouts and the tokens. Run again. Expect PASS, coverage above its floors.
- [ ] **Step 3:** Run `bunx nx run-many -t lint:css dead-css -p @raven/web`. Expect PASS.
- [ ] **Step 4:** Commit: `MAE: a music mode at /music on the web and Raven`.

### Task 25: sound, scrobbling and sharing settings on the web

**Files:**
- Modify:
  - `apps/raven/web/src/pages/SettingsPage/SettingsPage.tsx`: `BrowserPlayback` gains Music quality, Volume levelling, Crossfade (with ruling 13's copy on Raven) and Equalizer (preset choices and ten sliders).
  - A new `ScrobblingSection.tsx` beside `AccountSection`: ListenBrainz token field and Unlink; Last.fm "Connect", which calls `startLastFm({returnTo: '/settings'})` and navigates.
  - `PlaylistPage`: a "Shared" switch on your own, and "Copy to my playlists" on another's.
  - The Playlists tab: a "Shared with you" group.

- [ ] **Step 1:** Write the tests:
  - With Last.fm unavailable, it shows "Last.fm isn't set up on this server".
  - A linked ListenBrainz shows the username and Unlink.
  - The "Shared" switch calls `setPlaylistSharing`.
  - Another's playlist shows no rename or delete.
  - The EQ sliders have labels such as "32 Hz".
- [ ] **Step 2:** Run them (FAIL), implement, run again (PASS).
- [ ] **Step 3:** Run `bun run verify`. Commit: `MAE: sound, scrobbling and shared playlists in the web's settings`.

---

## PR 10c: discovery in Wren

### Task 26: sound in `@raven/audio`

**Files:**
- Modify:
  - `libs/raven/audio/src/index.ts` and `contract.ts` (`setSound({ level, eq, crossfade })`);
  - `ios/RavenAudioModule.swift`, plus a new `ios/SoundTap.swift` (an `MTAudioProcessingTap` with `vDSP_biquad` coefficients) and `ios/Crossfader.swift`;
  - `android/.../SoundProcessor.kt` (a Media3 `AudioProcessor`) and `Crossfader.kt`;
  - `libs/raven/audio/README.md`.
- Create: `libs/raven/core/src/biquad.ts` (`peakingCoefficients({ frequency, gainDb, q, sampleRate })`), which is shared as test vectors by the native unit tests.

- [ ] **Step 1:** Write the tests:
  - `biquad.test.ts`: the coefficients for 1 kHz, +6 dB, Q 1.41 at 44.1 kHz match the RBJ cookbook values to 1e-6.
  - `SoundProcessorTest.kt` and a Swift `SoundTapTests` (an XCTest target in the module's podspec `test_spec`): a 1 kHz sine through a +6 dB band rises about 6 dB.
  - `CrossfaderTest.kt`: the lead's volume ramps from 1 to 0 over the set seconds while the next's rises.
- [ ] **Step 2:** Run them (FAIL), implement rulings 12 to 14 natively, run again (PASS).
- [ ] **Step 3:** Commit: `MAE: @raven/audio levels, equalises and crossfades`.

### Task 27: mixes, radio and recently played in Wren

**Files:**
- Modify in `apps/raven/music/`:
  - `src/screens/Home.tsx` (Mixes, Recently played and Recently added shelves);
  - new `src/screens/Mix.tsx` and `app/mix/[id].tsx`;
  - "Start radio" on a track's menu, an album and an artist.
- Modify: `libs/raven/native/src/browseTree.ts` (`BROWSE_ROOTS.mixes`, shown in CarPlay and Android Auto).

- [ ] **Step 1:** Write the render tests:
  - Home shows each mix's title.
  - "Start radio" from an artist calls `playTracks` with `source: {kind:'radio'}`.
  - The browse root now lists Mixes.
- [ ] **Step 2:** Run them (FAIL), implement, run again (PASS). Commit: `MAE: mixes and radio in Wren, CarPlay and Android Auto`.

### Task 28: sound, scrobbling and sharing in Wren's Settings

**Files:**
- Modify in `apps/raven/music/`:
  - `src/screens/Settings.tsx`: Streaming quality (Original, 320, 256, 128, with cellular separate), Volume levelling, Crossfade, Equalizer, and Scrobbling. Last.fm connects through `expo-web-browser`'s `openAuthSessionAsync` with `returnTo: 'wren://scrobbling'`.
  - `src/music/WrenAudioHost.tsx`: it sends `setSound` on change.
  - `Playlist.tsx`: Shared and Copy, as on the web.
  - `package.json`: `expo-web-browser` 58.0.6.
- Modify: the spec's tip for PR 10, recording what was built and what was deferred (now-playing scrobbles, smart auto-downloads, crossfade on Raven's mpv).

- [ ] **Step 1:** Write the render tests:
  - Choosing "Bass boost" sends `setSound` with that preset's gains.
  - Last.fm "Connect" opens the URL `startLastFm` answered.
  - Another account's playlist shows Copy and no Shared switch.
- [ ] **Step 2:** Run them (FAIL), implement, run again (PASS).
- [ ] **Step 3:** Run `bash scripts/ci_wren.sh` and `bun run verify`. Commit: `MAE: Wren's sound, scrobbling and sharing settings`.
