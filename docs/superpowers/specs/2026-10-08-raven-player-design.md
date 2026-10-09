# raven's own player: tracks, subtitles and server conversion

Date: 2026-10-08. Status: decided autonomously from the request; open to
review in the PR.

## Goal

Replace the browser's built-in `<video controls>` with a player raven draws
itself, in the godswood palette, that:

1. lets the viewer pick the audio track,
2. shows subtitles, embedded in the file or sitting beside it, and lets the
   viewer pick one,
3. plays files the browser cannot decode by converting them on the server,
4. answers the keyboard the way YouTube's player does.

Success: an MKV remux with TrueHD audio, three audio tracks and SRT, ASS and
PGS subtitles plays in Chrome, Firefox and Safari; the viewer can switch to
the commentary track and to English subtitles without leaving the page;
every YouTube shortcut that applies to a single video works.

## What the request said, and what was assumed

| Said                                                                | Assumed                                                                                                                       |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Custom styled player matching the site                              | Same tokens (night, canopy, moss, bark, lichen, leaf), Young Serif for the title, red kept for "where you are" and the one primary action |
| Subtitle selection                                                  | Embedded text tracks (SRT, ASS, WebVTT, mov_text) and sidecar files beside the video. Image tracks (PGS, VobSub, DVB) are listed but cannot be shown: that needs OCR or burning in, which is out of scope |
| Audio track selection                                               | Any track; picking one that is not the file's default goes through the server, since only Safari exposes `audioTracks`      |
| YouTube keyboard navigation                                         | YouTube's documented single-video shortcuts; playlist, miniplayer and theatre keys have nothing to act on and are left out   |
| Address "no transcoding to fall back on"                            | Remux on the fly with the video copied and audio converted to AAC; convert the video too only when the browser cannot decode it |

## Playback modes

Three ways to play, picked per file and per audio choice by `planPlayback`
in `@raven/core`:

| Mode        | When                                                                                       | What the server does                                                 | Cost                      |
| ----------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- | ------------------------- |
| `direct`    | `checkDirectPlay` passes and the default audio track is chosen                              | Serves the file with byte ranges, as today                           | Nothing                   |
| `remux`     | The container or audio is the problem, or another audio track is chosen, and the browser can decode the video inside fragmented MP4 | ffmpeg copies the video, converts the chosen audio to stereo AAC, writes fragmented MP4 to the response | One core, mostly audio decode |
| `transcode` | The browser cannot decode the video at all                                                  | As remux, but the video is re-encoded to H.264 (`veryfast`, CRF 23), at most 1080p, HDR tone mapped when ffmpeg has `zscale` | Heavy; real time for 1080p on a modern x86 core, not for 4K |

If a mode fails while playing (the browser said "maybe" and then could not
decode), the player steps down to the next one: direct, then remux, then
transcode, then the existing "can't play" panel with the file link.

### Streaming without byte ranges: Media Source Extensions

A converted stream has no length and no byte ranges, so it is not handed to
`<video src>` directly. Safari will not play a progressive response without
ranges at all, and no browser can seek one. Instead the player feeds it to
the video element through Media Source Extensions (`ManagedMediaSource` on
iOS, `MediaSource` elsewhere), which every target browser supports.

The trick that keeps this small: the stream keeps the file's own clock.
ffmpeg runs with `-ss <start> -copyts -start_at_zero`, and the MP4 muxer
with `frag_discont`, `-avoid_negative_ts disabled` and `-use_editlist 0`,
so a stream started at 41:12 carries fragments stamped 41:12 onward. MSE
places each fragment at its own time. Measured on a test MKV: a stream
started at 12.001s (keyframe at 10s) begins with video at pts 10.000 and
audio at 11.978, exactly where they sit in the file.

The output is shifted by a constant `STREAM_TIME_SHIFT` of one second
(`-output_ts_offset 1`) because the first frames of a file can carry
negative timestamps (B-frame reordering, AAC priming), and MSE rejects
those. The player subtracts the shift wherever it reads `currentTime`. One
constant in `@raven/core`, shared by the server and the web app.

So in every mode the player works in file time:

- Seeking sets `currentTime`. Inside what is buffered, the browser just
  seeks. Outside it, the stream source aborts the running request and
  starts a new one at the target. The server kills the old ffmpeg when its
  request closes.
- Subtitles are timed against the file, so they need no offset.
- Resume, progress saving and the "last 5% counts as finished" rule are
  unchanged.

The stream source applies back pressure: it stops reading the response
while more than 60 seconds are buffered ahead, which in turn stops ffmpeg
through the pipe, and it evicts what is more than 30 seconds behind. On a
`QuotaExceededError` it evicts and waits for playback to move.

## Tracks

`GET /api/media/:id/tracks` runs ffprobe on demand and answers:

```ts
type MediaTracks = {
  audio: AudioTrack[]      // index (0:a:N), codec, channels, language, title, default
  subtitles: SubtitleTrack[] // id, source, codec, language, title, default, forced, hearingImpaired, supported
  defaultAudio: number | null
  frameRate: number | null // for frame stepping with , and .
}
```

Not stored in the index: existing libraries would need a full re-probe, and
one ffprobe per play (tens of milliseconds locally, a few hundred over SMB)
is cheap. Results are cached in memory per file version, up to 200 files.

The default audio track is the one flagged default, else the first: the
same rule the scanner uses for `audioCodec`, so direct play and the index
agree.

### Sidecar subtitles

Files beside the video whose name starts with the video's base name and end
in `.srt`, `.vtt`, `.ass` or `.ssa`. The dot-separated words in between give
the language (`en`, `eng`, `English`), `forced`, and `sdh`, `cc` or `hi`;
anything else becomes the title. `Movie (2020).en.forced.srt` is English,
forced.

## Subtitles

Subtitles are rendered by the player, not with `<track>`: that keeps them
in the theme, lets `+` and `-` resize them as YouTube does, and keeps one
renderer for direct and streamed playback.

`GET /api/media/:id/subtitles/:trackId?window=N` answers WebVTT.

- Embedded tracks are extracted in five-minute windows. Subtitles are
  interleaved through the whole file, so extracting a full track reads the
  whole file: ten minutes for a 60 GB remux over SMB. A window reads only
  its own stretch (`-ss`, `-t`, `-copyts -start_at_zero`, so cue times stay
  file times), starting ten seconds early so a cue straddling the boundary
  is not lost. The player fetches the window it is in, and the next one a
  minute before it needs it.
- Sidecar files are converted whole, ignoring `window`; a CP-1252 retry
  catches the common non-UTF-8 SRT.
- Results are cached on disk under `<data>/subtitles/<id>/`, keyed by the
  file's mtime, and dropped with the media (delete, scan, library removal),
  like thumbnails.

`@raven/core` parses WebVTT into `{ start, end, text }` cues and splits cue
text into italic, bold and underlined runs; every other tag is dropped.

## The player

### Layout

```
+----------------------------------------------------------+
| [<]  Title in Young Serif                                 |  top bar, fades when idle
|      Resumed at 41:12  [Start over]                       |
|                                                          |
|                    (centre bezel: icon + "+10s")          |
|                                                          |
|            Subtitle text on a dark night plate            |  rises above the controls
| ======================o---------------------------------- |  scrubber, leaf-shaped head
| [>] [<<] [>>] [vol]--  1:02:03 / 2:01:00        [CC][=][[]] |
+----------------------------------------------------------+
```

- Scrubber: moss track, lichen for buffered, leaf-bright for played, a
  head shaped like a weirwood leaf. Hover shows the time under the
  pointer. Dragging previews and seeks on release, so a converted stream
  is not restarted on every pixel. `role="slider"` with a spoken value.
- Settings (the sliders icon): a popover with Audio, Subtitles and Speed
  as native radio groups, plus a line saying how this file is playing
  ("Playing the original file" or "Converting the audio on the server").
- CC button: toggles subtitles, on to the last language used.
- Below 30rem the skip buttons and the volume slider drop out; mute,
  time, CC, settings and fullscreen stay.
- Everything hides after 2.5s idle while playing, as today; any key or
  pointer movement brings it back; focus inside the controls keeps it.

### Keyboard (YouTube's)

| Key                         | Action                                      |
| --------------------------- | ------------------------------------------- |
| `k`, space                  | Play or pause                               |
| `j` / `l`                   | Back / forward 10 seconds                   |
| left / right                | Back / forward 5 seconds                    |
| up / down                   | Volume up / down 5%                         |
| `m`                         | Mute                                        |
| `f`                         | Fullscreen                                  |
| `c`                         | Subtitles on or off                         |
| `0` to `9`                  | Jump to 0% to 90%                           |
| Home / End                  | Start / end                                 |
| `,` / `.`                   | Pause, then one frame back / forward        |
| `<` / `>`                   | Slower / faster (0.25 to 2)                 |
| `+` / `-`                   | Bigger / smaller subtitles                  |
| `?`                         | Shortcut list                               |
| Esc                         | Close the menu or list; else leave fullscreen; else back to the library |

Click toggles play, double click toggles fullscreen. Keys are ignored with
a modifier held and while a form control (the radios, the volume slider)
has focus, so their own arrow keys keep working. Each action flashes a
bezel in the middle of the picture and is announced through a polite live
region.

### Remembered between videos

Volume and mute (as today), subtitle size, the last subtitle language (or
off), and the last audio language chosen by hand. When a remembered audio
language differs from the file's default, the player waits for the track
list before loading anything, so it does not start one stream only to
replace it.

## Code layout

| Where                                     | What                                                                                      |
| ----------------------------------------- | ----------------------------------------------------------------------------------------- |
| `libs/raven/core/src/types.ts`            | `AudioTrack`, `SubtitleTrack`, `MediaTracks`, `SubtitleCue`, `PlaybackMode`               |
| `libs/raven/core/src/playback.ts`         | `planPlayback`, `describeMode`, `STREAM_TIME_SHIFT`, `streamMimeType`                     |
| `libs/raven/core/src/subtitles.ts`        | `parseWebVtt`, `cueRuns`, `mergeCues`, `activeCues`, `subtitleWindows`, `subtitleWindowRange`                   |
| `libs/raven/core/src/tracks.ts`           | `languageTag`, `isKnownLanguage`                                                           |
| `libs/raven/core/src/apiClient.ts`        | `getTracks`, `getSubtitles`, `streamUrl`                                                  |
| `apps/raven/server/src/ffmpeg/tracks.ts`  | `parseTracks` from ffprobe JSON                                                           |
| `apps/raven/server/src/ffmpeg/args.ts`    | `streamArgs`, `subtitleWindowArgs`, `subtitleFileArgs`                                    |
| `apps/raven/server/src/playback/`         | `sidecars.ts`, `TracksService`, `SubtitlesService`, `PlaybackController` (tracks, subtitles, stream) |
| `apps/raven/web/src/components/Player/`   | `Player` (track choices, mode and fallback), `Stage`, `Controls`, `Scrubber`, `SettingsMenu`, `SubtitleOverlay`, `ShortcutsDialog`, `Bezel`, `Unplayable`, `selection.ts`, `useSubtitleCues` |
| `apps/raven/web/src/lib/`                 | `streamSource.ts` (the MSE pump), `shortcuts.ts` (key to action, pure), `trackLabels.ts`, `canPlay.ts` (`browserCanStream`) |

## Errors

- ffprobe fails for tracks: the player plays the default track with no
  subtitle choice and says "Tracks unavailable" in the settings menu.
- A subtitle window fails: that window is retried once on the next
  minute boundary; the menu shows "Subtitles unavailable" if the first
  window fails.
- ffmpeg exits before writing anything: the stream response ends empty,
  the stream source reports an error, the player steps down a mode.
- The client goes away: the request's `close` kills ffmpeg with SIGKILL.
  Every running stream is killed on shutdown.

## Testing

- Core (vitest): `planPlayback` for every mode and step down, WebVTT
  parsing (hours, no hours, identifiers, settings, NOTE and STYLE blocks,
  entities), cue runs, window maths, language tags, the API client's new
  calls and guards.
- Server (vitest): `parseTracks` and sidecar names as units; end to end
  against a real MKV with two audio tracks and an SRT track, plus a
  sidecar: the track list, a subtitle window and a sidecar as WebVTT, and a
  stream whose first fragment is stamped at the file time plus the shift.
- Web (bun test, happy-dom): every shortcut through `shortcutFor`; the
  stream source against a fake `MediaSource` (starts at the resume point,
  appends, restarts on an unbuffered seek, not on a buffered one, ends the
  stream); the player renders custom controls, opens the settings menu,
  switches subtitles, steps down on an error.
- A manual pass in a real browser on the test MKV.

## Out of scope

- Burning in image subtitles, and OCR.
- Hardware encoders (VAAPI, QSV, VideoToolbox) for transcoding.
- HLS, multiple bitrates, bandwidth adaptation.
- Picture in picture, playlists, autoplaying the next episode.
- Thumbnails on scrubber hover.
