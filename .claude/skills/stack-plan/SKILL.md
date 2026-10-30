---
name: stack-plan
description: Use when asked where the stacked PRs stand, "show the plan", "stack status", "what's next in the stack", "/stack-plan", or before starting the next PR of the Windows port. Holds the plan the stack was built from (scope, order, model, effort, estimates, constraints) and reports it as one table with each PR's live state from GitHub.
---

# Stack plan

The plan behind the open stack on `main`, kept here so a new session can pick the work
up without the thread that made it. Run it to print the table below with each row's
live state. Update the rows here when the plan changes, never only in chat.

## The stack

Bottom to top. Each branch is cut from the one below it and its PR's base is that
branch. After a bottom PR merges, the rest restack with `rebase-stack`.

| #   | PR           | Branch                    | Base                      | Scope                                                                                                                                                                                                                           | Model      | Effort | Work estimate |
| --- | ------------ | ------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------ | ------------- |
| T   | #298 to #304 | `thermo-*`                | `main`                    | The second whole-repo thermo-nuclear review, seven PRs                                                                                                                                                                          | Opus 5.5   | medium | done          |
| 1   | #306         | `raven-splash`            | `thermo-rookery-luwin`    | raven's front door at `maester.netlify.app`: download menu from the GitHub releases API, link to the web app, `/releases/` versions page                                                                                        | Opus 5.5   | medium | 2.5 h (spent) |
| 2   | #307         | `raven-windows-libmpv`    | `raven-splash`            | Windows port 1 of 6: pinned prebuilt `libmpv-2.dll` under `resources/win32-x64`, a PE audit in TypeScript, the `🪟 Windows native` CI job                                                                                       | Opus 5.5   | medium | 1.5 h (spent) |
| 3   | #308         | `raven-windows-addon`     | `raven-windows-libmpv`    | Windows port 2 of 6: `addon.cpp` shared, `surface_mac.mm` and `surface_win.cpp`, CMake for MSVC with an import library from the DLL's export list, `nativeTargetOf`, headless native tests on Windows                           | Opus 5.5   | high   | 5 to 7 h      |
| 4   | #309         | `raven-windows-window`    | `raven-windows-addon`     | Windows port 3 of 6: transparent frameless window on Windows, page transparent only while mpv plays, Raven's own title bar (minimize, maximize, close) over the bridge                                                          | Opus 5.5   | medium | 3 to 4 h      |
| 5   | #312         | `raven-windows-main`      | `raven-windows-window`    | Windows port 4 of 6: `wasapi` audio, engine path by platform, Windows menus, `second-instance` opens, `raven://` registration, logs in `%APPDATA%`, update asset per platform, platform copy ("On this Mac" reads "On this PC") | Opus 5.5   | medium | 2 to 3 h      |
| 6   | #314         | `raven-windows-packaging` | `raven-windows-main`      | Windows port 5 of 6: `stage:mpv` by platform, a Windows installer maker, `bundleAudit` for PE files, `releaseAssets` adds the setup `.exe` (unsigned)                                                                           | Opus 5.5   | high   | 4 to 5 h      |
| 7   | #315         | `raven-windows-ci`        | `raven-windows-packaging` | Windows port 6 of 6: the Windows jobs run `make`, the audit and the smoke on top of the native tests (e2e stays macOS-only), a Windows build in `desktop-release.yml`, Windows notes in `CLAUDE.md` and the desktop spec        | Sonnet 5.5 | medium | 2 to 3 h      |
| 8   | #320         | `raven-windows-splash`    | `raven-windows-ci`        | The splash offers the Windows download: files read by a table of release name suffixes, the button names the visitor's platform and lists its files first                                                                       | Opus 5.5   | medium | 1 h (spent)   |
| 9   | #322         | `raven-windows-resize`    | `raven-windows-splash`    | Resize handles for the frameless window: eight page-drawn edge and corner handles capture the pointer and send screen points; main resizes from the bounds the drag started at, down to the minimum size                        | Opus 5.5   | medium | 2 to 3 h      |

Each PR also costs one review (RTime). Stack total: about 27 h of work plus 9 × RTime.

## The audio stack

The music library and the standalone player, from `docs/superpowers/specs/2026-10-27-raven-audio-design.md`
(its Plan section is the source of each row's scope). PR 1 merged as #310. PR 2 sits on `raven-audio`
(the branch the owner opened for it), and each next branch is cut from the one below. Estimates
are build time plus the thermo review and its fixes; the owner's review and the restack after each merge
are on top.

| #   | Branch                        | Base                        | Scope                                                                                                                                | Model     | Effort | Work estimate                                                           |
| --- | ----------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------- | ------ | ----------------------------------------------------------------------- |
| 1   | `audio-library-support`       | `main`                      | Audio playback foundations: audio kinds, extensions, `0:V:0`, an audio file's `/stream` (#310)                                       | Opus 5.5  | medium | done                                                                    |
| 2   | `raven-audio` (#336)          | `main`                      | Music library on the server: `music-metadata` tags, artists, albums, tracks, covers as capability pictures, routes                   | Fable 5.1 | medium | 3 h spent: 65 min build, 35 min review and fixes, 80 min hook pushes    |
| 3   | `raven-music-matching` (#337) | `raven-audio`               | MusicBrainz matching behind a one-a-second gate, Cover Art Archive, Fix match for albums                                             | Fable 5.1 | medium | 55 min spent: 30 min build, 15 min review and fixes, 10 min hook pushes |
| 4   | `raven-music-web` (#339)      | `main` (3 merged)           | `queue.ts`, the `audioQueue` store, the persistent audio host, Media Session, music pages on the web                                 | Fable 5.1 | medium | 3.5 h spent: 2 h build, 40 min review and fixes, 50 min hook pushes     |
| 5   | `raven-music-desktop` (#340)  | `raven-music-web`           | mpv's audio surface, playlist, gapless, ReplayGain, Now Playing and media keys in the addon (album downloads to PR 9)                | Fable 5.1 | medium | 4 h spent: 2 h build, 50 min review and fixes, 70 min hook pushes       |
| 6   | `raven-music-device`          | `raven-music-desktop`       | `@raven/audio` (AVQueuePlayer, Apple only; Media3 to row 8), music screens in touch layouts, lock screen (TV focus layouts to row 7) | Fable 5.1 | medium | built, #345 against `debug-android-tv-app` (#335), stack #341           |
| 7   | `raven-music-playlists`       | `raven-music-device`        | Playlists, lyrics (tags, sidecars, LRCLIB), listens at 50% or four minutes, audiobook chapters, resume and speed                     | Fable 5.1 | medium | built 2026-10-30 with its review; split into 7a to 7c below             |
| 7a  | `raven-music-playlists`       | `raven-music-device`        | Server and core: playlists, album and artist favourites, lyrics with LRCLIB, audiobook chapters, the contract and allowlist          | Opus 5.5  | medium | built                                                                   |
| 7b  | `raven-music-web-playlists`   | `raven-music-playlists`     | Shared player, web and Raven: headless hooks, audiobook resume and speed, playlist, lyrics and chapters pages                        | Opus 5.5  | medium | built                                                                   |
| 7c  | `raven-music-app-playlists`   | `raven-music-web-playlists` | Device app: TV music layouts and bar, Artists and Playlists pages, lyrics, chapters, speed and resume in `@raven/audio`              | Opus 5.5  | medium | built                                                                   |
| 8   | `raven-music-app`             | `raven-music-app-playlists` | `@raven/music`: the standalone app on `@raven/audio`: sign-in, library, Now Playing, queue, lock screen                              | Fable 5.1 | medium | 9 to 11.5 h                                                             |
| 9   | `raven-music-offline`         | `raven-music-app`           | Offline downloads with a server transcode cache, CarPlay templates, Android Auto browse tree                                         | Fable 5.1 | medium | 8 to 10 h                                                               |
| 10  | `raven-music-discovery`       | `raven-music-offline`       | EBU R128 loudness, crossfade, EQ, mixes, radio, scrobbling, the `/music` mode in `@raven/web`                                        | Fable 5.1 | medium | 10 to 13.5 h                                                            |

Caveats: rows 6, 8 and 9 need a real iPhone and Android phone for the lock screen and the seams, and
CarPlay needs Apple's `com.apple.developer.carplay-audio` entitlement (ask when row 8 starts). The
pre-push hook re-tests the whole stack below each branch, so pushes higher up may need retries.

## Gates and caveats

- **The real-GPU check gates rows 4 to 7.** The spike (`raven-windows-spike`, never merged) proved on `windows-2025`, which renders with WARP, that mpv in the BrowserWindow's own HWND draws under a transparent Electron page and the page keeps the mouse. It has not run on a physical Windows GPU. If a real GPU reorders the stacking, the fallback is mpv's render API into a shared texture Chromium composites: a new row of 2 to 3 days.
- The Windows packaged app (installer, zip, audit and smoke) passed on `windows-2025` on #314; that runner has no physical GPU, so the check above still stands.
- **A transparent frameless window on Windows has no native resize edges or Snap layouts** (row 4's window): row 9 draws the page's own resize handles; Snap layouts stay out of reach without a native frame.
- **Row 3 carries the variance**: up to 10 h if MSVC fights the MinGW-built DLL's import library or the N-API headers.
- Intel Macs are out of scope (last shipped 2020; macOS 26 is the last release for them).
- The Netlify site `maester` for row 1 has to be created by hand: base directory the repo root, package directory `apps/raven/splash`.

## Constraints on every PR

1. No direct `bunx` in anything new: a `package.json` script, run with `bun run <script>`.
2. One large commit per PR; the reviewer decides from the diff whether to split it.
3. Run `/thermo-nuclear-code-quality-review` on the PR once the work is done and apply its findings before handing it over.
4. Every new Nx target is cached, with its `inputs` and `outputs`, so Nx Cloud (back in November 2026) restores it.
5. The pre-push audit (`scripts/audit_claude_md.sh`) diffs since `origin/main`, so on a stacked branch it re-reads the whole stack below; to audit one PR's own diff, pass its stack parent: `bash scripts/audit_claude_md.sh $(git merge-base origin/<base> HEAD)`.

## Reporting

1. Read the live state: `gh pr list --state all --limit 40 --json number,title,headRefName,baseRefName,state,isDraft,mergeable,statusCheckRollup`.
2. Match each row's branch to a PR. A row with no PR is **not started**; an open PR is **open** with its checks summed up (passing, failing, pending), **merged** or **closed** otherwise. Note a base that differs from the table.
3. Print the table above with one more column, **State**, then the gates in one line each, and the next action: the first row that is not merged, and what it waits on.
4. If a row's scope, branch or base changed, update this file in the same turn.
