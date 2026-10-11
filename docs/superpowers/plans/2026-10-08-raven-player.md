# raven player Implementation Plan

**Goal:** raven's own themed player with audio track and subtitle selection, YouTube's keyboard shortcuts, and server-side remux and transcode for files the browser cannot play.

**Spec:** `docs/superpowers/specs/2026-10-08-raven-player-design.md`

**Tech Stack:** NestJS 12 on Fastify + vitest, React 19 + bun test + happy-dom, ffmpeg/ffprobe, Media Source Extensions.

## Global Constraints

- raven's conventions from `apps/raven/CLAUDE.md`: type aliases, no `any`, no `as`, no non-null assertions, named exports, no `for` loops, one object parameter, grid layouts with `gap` and padding, no margins, works at 320px, no em or en dashes.
- `libs/raven/core` stays free of DOM and Node APIs.
- Run everything through Nx from the repo root.

## Tasks

1. **Core contract.** Types (`AudioTrack`, `SubtitleTrack`, `MediaTracks`, `SubtitleCue`, `PlaybackMode`), `isMediaTracks`, `planPlayback`, `describeMode`, `STREAM_TIME_SHIFT`, `streamMimeType`, `parseWebVtt`, `cueRuns`, `subtitleWindows`, `languageTag`, and the API client's `getTracks`, `getSubtitles`, `streamUrl`. Tests first for each.
2. **Server tracks.** `parseTracks` from ffprobe JSON, sidecar name parsing, `TracksService` with an in-memory cache keyed by id and mtime. Unit tests plus an end-to-end test against an MKV with two audio tracks and an SRT track.
3. **Server subtitles.** `subtitleWindowArgs`, `subtitleFileArgs`, `SubtitlesService` with a per-media disk cache, in-flight de-duplication and `discard`, wired into media delete, scan removal and library delete. End-to-end: a window of an embedded track and a sidecar, both as WebVTT.
4. **Server stream.** `streamArgs` (remux and transcode), `FfmpegService.stream`, `GET /api/media/:id/stream` killing ffmpeg on close and on shutdown. End-to-end: the response is fragmented MP4 whose first `tfdt` is the file time plus the shift.
5. **Web stream source.** `lib/streamSource.ts`: MSE pump with back pressure, eviction, restart on unbuffered seek, end of stream. Tests against a fake `MediaSource`.
6. **Web shortcuts.** `lib/shortcuts.ts`: a pure `shortcutFor(event)` covering every key in the spec. Table-driven tests.
7. **Web player.** Split `Player.tsx` into `Player`, `Stage`, `Controls`, `Scrubber`, `SettingsMenu`, `SubtitleOverlay`, `ShortcutsDialog`, `Bezel`; new icons; prefs for subtitle size and languages; mode fallback. Component tests.
8. **Docs.** README playback section, keyboard list, "Not there yet"; the card's "won't play" badge becomes a "converts on the server" note.
9. **Verify.** `bun run verify`, then a manual pass in a real browser on the test MKV.
