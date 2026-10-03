# raven

A light, self-hosted video library and player. Point it at folders of videos; it indexes them, makes a thumbnail for each, and plays them in the browser straight from disk, with no transcoding.

raven is the `apps/raven/` folder of an Nx workspace; the [root README](../../README.md) covers the workspace.

## Run it with Docker

1. Edit the volumes in `apps/raven/docker-compose.yml` so each media folder is mounted read-only under `/media`.
2. From `apps/raven/`, `docker compose up -d --build`. The image builds from the repo root, where the workspace's `bun.lock` lives.
3. Open `http://<host>:8484`, choose **Add library**, and pick folders under `/media` with the folder browser.

Deleting a video from the app removes the file, so leave `:ro` off any mount where that should work. On a read-only mount the app keeps the video and says why.

The index and thumbnails live in `./data` (mounted at `/config`). The image runs as the unprivileged `node` user (1000:1000); on a Synology, set `user:` in the compose file to the owner of `./data`.

### Coming from weirwood

raven was called weirwood. Its database is now `raven.db`, and the server renames a `weirwood.db` it finds in the data folder, with its `-wal` and `-shm` files, the first time it starts. To move a running weirwood container over:

1. `docker compose down` in `apps/weirwood/`.
2. Move `apps/weirwood/data` to `apps/raven/data`, and copy your media volume lines from `apps/weirwood/docker-compose.yml` into `apps/raven/docker-compose.yml`.
3. `docker compose up -d --build` in `apps/raven/`.

The player forgets its volume and mute setting once, since the browser now keeps it under raven's name.

## How playback works

Direct play only. The browser is handed the original file over HTTP range requests, so playback starts as soon as the first bytes arrive (about half a second for a 1080p file on the NAS over SMB) and seeking is just another range request. Nothing is converted on the server.

Before loading a file, the player asks the browser whether it can decode that exact container, video codec, and audio codec (`canPlayType`), using codec strings built from the ffprobe data in the index. When the answer is no, it says why ("Dolby Digital Plus audio isn't supported here") and offers the file link for VLC or IINA, rather than showing a spinner. Cards in the grid carry the same check, so you know before you click.

What that means in practice. Chrome and Firefox 156 were measured on a Mac with `canPlayType`; Safari is Apple's documented support. The player asks the browser itself, so treat this as a guide rather than a rule:

|                        | Chrome                  | Firefox      | Safari                  |
| ---------------------- | ----------------------- | ------------ | ----------------------- |
| MP4 / MOV              | yes                     | yes          | yes                     |
| MKV                    | yes                     | yes          | no                      |
| H.264                  | yes, 10-bit too         | 8-bit only   | yes                     |
| HEVC, including 10-bit | with a hardware decoder | yes on macOS | yes                     |
| VP9, AV1               | yes                     | yes          | depends on the hardware |
| AAC, MP3, Opus, FLAC   | yes                     | yes          | yes                     |
| AC3 / EAC3 (Dolby)     | no                      | no           | yes                     |
| DTS, TrueHD            | no                      | no           | no                      |

Audio is the usual blocker: most remuxes and many WEB-DLs carry EAC3, DTS or TrueHD.

Keyboard: `space` or `k` play/pause, `j`/`l` or arrows skip 10s, `f` fullscreen, `m` mute, `Esc` back to the library. Playback resumes where you stopped; the last 5% counts as finished.

## Favourites and deleting

Every card has a menu, from the button in its corner or a right click, with two actions. **Favourite** marks the video and lists it under **Favourites** in the side menu, most recently marked first, across every library. **Delete** asks first, then removes the file from disk and the video from the index, along with its thumbnail, progress and favourite. There is no undo.

## Thumbnails

One JPEG per video, 480px wide, generated in the background after indexing and cached as `<data>/thumbnails/<id>.jpg`. The grid shows immediately and cards fill in as thumbnails land.

- ffmpeg seeks 10% into the file with `-ss` before `-i`, which jumps to the nearest keyframe through the container index instead of decoding up to the timestamp. Measured over SMB: 0.3s for a 1080p HEVC file, against 7.5s with the slow seek.
- The `thumbnail` filter picks the most representative of the next 24 frames, which avoids fades to black.
- HDR (PQ, HLG, Dolby Vision) is tone mapped to SDR with `zscale` + `tonemap`, so thumbnails are not grey and washed out. The Docker image's Debian ffmpeg has `zscale`; Homebrew's does not, so HDR thumbnails made on a Mac in development stay washed out (`/api/health` reports `tonemap`).
- Cost: roughly 0.3 to 1.7s per file (4K HEVC is the slow end) and 20 to 30 KB per image. A library of 3,600 files takes 15 to 50 minutes the first time with the default two workers, then only new or changed files are redone.
- A run that times out (a slow or sleeping NAS) stays pending and is retried on the next scan instead of being marked failed.

## Develop

From the repo root:

```bash
bun install
bun run dev:raven   # server on :8484 (watch mode) and Vite on :5173, proxying /api
bun run verify         # lint, stylelint, format check, typecheck, tests and build for every project
```

Run a single target through Nx: `bunx nx run @raven/server:test`, `bunx nx run @raven/web:typecheck`, `bunx nx show project @raven/server`.

The server and core tests need `ffmpeg` and `ffprobe` on the PATH: the end-to-end suite encodes real clips and drives the API against them.

## Layout

```
apps/raven/
  server/        @raven/server: NestJS on Fastify: SQLite index, scanner, ffprobe, thumbnails,
                 range-request file serving
  web/           @raven/web: React 19 + Vite: libraries, the grid, the player
  Dockerfile, docker-compose.yml
libs/raven/
  core/          @raven/core: API types and guards, the typed API client, the direct-play check,
                 formatting. No DOM or Node APIs, so a React Native app can use it unchanged.
```

A native iOS or Android app would be another `apps/raven/` entry that imports `@raven/core` and answers the direct-play check from its own player (AVPlayer takes MKV-free HEVC and Dolby audio; ExoPlayer takes almost everything).

## Configuration

| Variable                      | Default                        |                                              |
| ----------------------------- | ------------------------------ | -------------------------------------------- |
| `PORT`                        | `8484`                         |                                              |
| `DATA_DIR`                    | `./data` (`/config` in Docker) | SQLite index and thumbnail cache             |
| `WEB_DIR`                     | unset (`/app/web` in Docker)   | Built web app to serve; unset in development |
| `BROWSE_ROOT`                 | `/` (`/media` in Docker)       | The folder picker never goes above this      |
| `SCAN_ON_START`               | `true`                         | Rescan every library on boot                 |
| `RESCAN_INTERVAL_MINUTES`     | `0`                            | Periodic rescans; `0` turns them off         |
| `PROBE_CONCURRENCY`           | `4`                            | Parallel ffprobe runs during a scan          |
| `THUMBNAIL_CONCURRENCY`       | `2`                            | Parallel thumbnail runs                      |
| `THUMBNAIL_WIDTH`             | `480`                          |                                              |
| `FFMPEG_TIMEOUT_SECONDS`      | `90`                           | Per ffprobe or thumbnail run                 |
| `FFMPEG_PATH`, `FFPROBE_PATH` | `ffmpeg`, `ffprobe`            |                                              |

## Not there yet

- No accounts or auth: keep it on the LAN or behind Tailscale.
- No subtitles: embedded tracks would need extracting to WebVTT.
- Files a browser cannot decode are reported, not converted. An on-the-fly audio-only remux (video copied, audio to AAC) would unlock most of those at almost no CPU cost, if direct play alone turns out too strict.
