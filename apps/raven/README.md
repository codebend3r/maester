# raven

A light, self-hosted video library and player. Point it at folders of videos; it indexes them, makes a thumbnail for each, and plays them in the browser straight from disk, converting on the fly only what the browser cannot play.

raven is the `apps/raven/` folder of an Nx workspace; the [root README](../../README.md) covers the workspace.

## Run it with Docker

1. Edit the volumes in `apps/raven/docker-compose.yml` so each media folder is mounted read-only under `/media`.
2. From `apps/raven/`, `docker compose up -d --build`. The image builds from the repo root, where the workspace's `bun.lock` lives.
3. Open `http://<host>:8484`, choose **Add library**, and pick folders under `/media` with the folder browser.

Deleting a video from the app removes the file, so leave `:ro` off any mount where that should work. On a read-only mount the app keeps the video and says why.

The index and thumbnails live in `./data` (mounted at `/config`). The image runs as the unprivileged `node` user (1000:1000); on a Synology, set `user:` in the compose file to the owner of `./data`.

### Running on Vhagar

raven runs on Vhagar, the NAS with an Intel GPU, from `docker-compose.vhagar.yml`, which lives there as `/volume1/docker/raven/docker-compose.yml`. Every NAS's share is mounted read-write under `/media/<nas>`: Vhagar's own share directly, the other four through the cifs mounts Vhagar already has of them in `/volume1/Vhagar/`. Each share also holds folders for the others, so pick a library's folders inside one share rather than a whole share.

Merges to `main` deploy themselves:

1. The main smoke test builds the image, checks `/api/health`, and, when the merge changed anything that goes into the image, pushes it to `ghcr.io/codebend3r/raven` as `latest` and as the commit.
2. On Vhagar, DSM's Task Scheduler runs `vhagar-update.sh` (there as `update.sh`) as root every five minutes. It pulls `latest`, and when that is not the image raven runs, stops raven, copies `data/raven.db*` to `backups/<time>/` (the last five are kept), and starts the new image. It writes what it did to `update.log`.

Nothing on Vhagar takes instructions from GitHub, and GitHub holds no NAS credentials: Vhagar only pulls a public image.

To set the task up, in DSM: **Control Panel → Task Scheduler → Create → Scheduled Task → User-defined script**. Name it `raven update` and run it as `root`; on **Schedule**, run daily, every 5 minutes, from 00:00 to 23:55; on **Task Settings**, the script is `bash /volume1/docker/raven/update.sh`. DSM asks for your password, as it does for every task that runs as root.

To go back to an earlier build, set `image:` to `ghcr.io/codebend3r/raven:<commit>` and run `update.sh`; put `latest` back to follow `main` again. A backup's files go back into `data/` with raven stopped.

Without GitHub, the image can still be built on a Mac and loaded on Vhagar. Vhagar's docker has no buildx, which the Dockerfile needs. From the repo root:

```bash
docker buildx build --builder desktop-linux --platform linux/amd64 -f apps/raven/Dockerfile -t ghcr.io/codebend3r/raven:latest --load .
docker save ghcr.io/codebend3r/raven:latest | gzip -1 | ssh vhagar 'cat > /volume1/docker/raven/raven-image.tar.gz'
```

Then, on Vhagar, `sudo docker load -i /volume1/docker/raven/raven-image.tar.gz` and `sudo docker compose up -d` in `/volume1/docker/raven/`. Pause the task first, or its next run puts `latest` from GHCR back.

### Coming from weirwood

raven was called weirwood. Its database is now `raven.db`, and the server renames a `weirwood.db` it finds in the data folder, with its `-wal` and `-shm` files, the first time it starts. To move a running weirwood container over:

1. `docker compose down` in `apps/weirwood/`.
2. Move `apps/weirwood/data` to `apps/raven/data`, and copy your media volume lines from `apps/weirwood/docker-compose.yml` into `apps/raven/docker-compose.yml`.
3. `docker compose up -d --build` in `apps/raven/`.

The player forgets its volume and mute setting once, since the browser now keeps it under raven's name.

## How playback works

Three ways, cheapest first:

| Mode      | When                                                                                     | What the server does                                                       |
| --------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Direct    | The browser plays the file as it is, and the default audio track is wanted               | Serves the original file over HTTP range requests                          |
| Remux     | The container or audio is the problem, or another audio track is picked                  | ffmpeg copies the video untouched and converts the chosen audio to AAC     |
| Transcode | The browser cannot decode the video either                                                | ffmpeg re-encodes the video to H.264 (at most 1080p, HDR tone mapped) too   |

Direct play starts as soon as the first bytes arrive (about half a second for a 1080p file on the NAS over SMB), and seeking is just another range request. A remux costs little more than reading the file. A transcode is CPU heavy: fine for 1080p on a modern x86 core, not for 4K.

Before loading a file, the player asks the browser whether it can decode that exact container, video codec, and audio codec (`canPlayType`), using codec strings built from the ffprobe data in the index, and whether it could play a converted stream (`MediaSource.isTypeSupported`). Cards in the grid carry the same check: "Converted on the server" or, when nothing will work, "Won't play in this browser". If a mode fails once playing (the browser said "maybe" and could not decode after all), the player steps down to the next one from the same spot; only when every mode has failed does it say why and offer the file link for VLC or IINA.

Converted streams are fragmented MP4 fed to the browser through Media Source Extensions (`ManagedMediaSource` on iOS). ffmpeg keeps the file's own timestamps (`-copyts -start_at_zero`, `frag_discont`, no edit list), shifted by one second so nothing goes negative, so a stream started anywhere lands at the right place on one timeline. Seeking inside what is buffered is instant; seeking outside it starts a new stream there, and the server kills the old ffmpeg as soon as its request closes. The player reads at most a minute ahead, which holds ffmpeg back through the pipe.

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

Playback resumes where you stopped; the last 5% counts as finished.

## Audio tracks and subtitles

The settings button (or `c` for subtitles) lists every audio and subtitle track in the file, read with ffprobe when the player opens it. Picking an audio track other than the file's default plays through a remux. The player remembers the last audio language picked, whether subtitles were on, in which language, and how big.

Subtitles come from the file itself (SRT, ASS, WebVTT, MP4 text) or from files beside it named after the video: `Movie (2020).en.srt`, `Movie (2020).en.forced.srt`, `Movie (2020).English.sdh.ass`. They are drawn by the player rather than the browser, so they look the same everywhere and follow `+` and `-`. Embedded tracks are extracted five minutes at a time, so the first cues arrive after reading minutes of the file rather than all of it, and cached under `<data>/subtitles/`. Picture subtitles (PGS, VobSub) are listed but cannot be shown.

## Keyboard

YouTube's shortcuts, and `?` shows them in the player.

| Key                    | Action                                                 |
| ---------------------- | ------------------------------------------------------ |
| `k`, space             | Play or pause                                          |
| `j` / `l`              | Back / forward 10 seconds                              |
| left / right           | Back / forward 5 seconds                               |
| up / down              | Volume                                                 |
| `m`                    | Mute                                                   |
| `f`                    | Full screen (double click too)                         |
| `c`                    | Subtitles on or off                                    |
| `+` / `-`              | Bigger / smaller subtitles                             |
| `0` to `9`             | Jump to 0% to 90%                                      |
| Home / End             | Start / end                                            |
| `,` / `.`              | Pause, then one frame back / forward                   |
| `<` / `>`              | Slower / faster                                        |
| `Esc`                  | Close a menu, leave full screen, or back to the library |

## Library settings and views

Each library keeps its own settings on the server, so every browser opens it the same way.

- **Type**: Movies, TV shows or Other. New libraries, and those made before types, are Other. It shows beside the video count and can be changed in **Edit** at any time; it does not change how a library behaves yet.
- **Save where each video stopped**, on by default: leave a video and come back to pick up where it stopped. Turned off, nothing new is saved and nothing resumes, but saved spots are kept for when it is turned back on.
- **Pin to the side menu**, on by default: the library gets its own link under Favourites. Pin or unpin from the Libraries page, or in **Edit**.
- **Watched at**, 90% by default: how far into a video playback must get for it to count as watched in the library's history, as a whole percentage from 1 to 100.
- **Sort**: title, recently or oldest added, largest or smallest file, highest or lowest bitrate, highest or lowest resolution (by pixel count), or random. Videos not yet probed go last. Random holds its order while the page is open, and each visit starts a fresh deal.
- **View**: a grid of cards, a list, tiles (rows with a small thumbnail), or grouped by resolution, video codec or month added.

Sort, view and grouping are picked on the library page and saved as they change; the others are in **Edit**. Changing a setting or the name never rescans; only a change of folders does.

Beside the sort, **Play** starts the first video as the page shows it (the top of the first group in the grouped view) and **Shuffle** starts a random one, whatever the sort. Both keep to the search.

## History

Each library's **History**, linked from its page, lists the videos played in it, last played first and split into days. **Watched** shows the ones that count as watched by the library's **Watched at** setting; **All played** adds the ones that stopped short, with how far they got.

- A play is recorded when a video starts, and its furthest point as the player saves its position (every 10 seconds, on pause, and on leaving). Starting the same video again within half an hour of its last report is the same play.
- A video counts as watched once any play gets past the library's percentage. One whose length is not known yet never does.
- History is kept whatever **Save where each video stopped** says; that setting is only about resuming. A video's plays go when the video leaves the library.

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
bun run dev:raven   # server on :8484 (watch mode, no scan on start) and Vite on :5173, proxying /api
bun run verify         # spellcheck, TypeScript only, one command per script, lint, stylelint, format check, typecheck, tests and build for every project
```

`/design` shows the palette, every token, how each HTML element is drawn and every shared component. It is not in the side menu. Element styles live in `apps/raven/web/src/styles/elements.scss`, written in `:where()` so a component's own class always wins.

Run a single target through Nx: `bunx nx run @raven/server:test`, `bunx nx run @raven/web:typecheck`, `bunx nx show project @raven/server`.

The server and core tests need `ffmpeg` and `ffprobe` on the PATH: the end-to-end suite encodes real clips and drives the API against them.

## Layout

```
apps/raven/
  server/        @raven/server: NestJS on Fastify: SQLite index, scanner, ffprobe, thumbnails,
                 range-request file serving, tracks, subtitles and converted streams
  web/           @raven/web: React 19 + Vite: libraries, the grid, list, tiles and groups, history,
                 the player and its stream source, the /design page
  Dockerfile, docker-compose.yml, docker-compose.vhagar.yml, vhagar-update.sh
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
| `HW_ACCEL`                    | `auto`                         | `auto`, `vaapi`, `videotoolbox` or `none`: how transcodes encode. `auto` tries VideoToolbox on a Mac and VAAPI when the render node exists, after a test encode; else libx264 |
| `VAAPI_DEVICE`                | `/dev/dri/renderD128`          | The GPU's render node for VAAPI              |
| `UV_THREADPOOL_SIZE`          | `16`                           | Node's file I/O threads; scans may hold four of them, so playback never waits behind a scan |
| `THUMBNAIL_CONCURRENCY`       | `2`                            | Parallel thumbnail runs                      |
| `THUMBNAIL_WIDTH`             | `480`                          |                                              |
| `FFMPEG_TIMEOUT_SECONDS`      | `90`                           | Per ffprobe or thumbnail run                 |
| `FFMPEG_PATH`, `FFPROBE_PATH` | `ffmpeg`, `ffprobe`            |                                              |

## Not there yet

- No accounts or auth: keep it on the LAN or behind Tailscale.
- Picture subtitles (PGS, VobSub) would need burning in or OCR.
- On VAAPI, HDR is converted to BT.709 on the GPU rather than tone mapped. That suits HLG; HDR10 (PQ) comes out flat.
- No QSV; Intel GPUs go through VAAPI.
