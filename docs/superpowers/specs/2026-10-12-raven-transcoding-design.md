# raven transcoding: fast, HDR-aware, and shaped by the client

Status: proposed, not yet reviewed. Companion to `2026-10-12-raven-desktop-design.md`, whose remote mode uses the mkv container below.

## Context

The desktop app plays almost everything directly through mpv, so a transcode becomes the exception there. It is still the rule for the web app whenever a browser cannot play a file, and for the desktop's remote mode over a link too slow for the original. Both should get a transcode that is fast, keeps HDR when the client can show it, tone maps correctly when it cannot, and leaves audio alone when the client can play it.

Hardware encoding shipped in #96 (ef417b5): `HW_ACCEL` picks VideoToolbox or VAAPI after a test encode. That supersedes the "Hardware encoders (VAAPI, QSV, VideoToolbox)" line in the out-of-scope list of `2026-10-08-raven-player-design.md`.

### What exploration found

- **Every transcode is 8-bit H.264 SDR** (`apps/raven/server/src/ffmpeg/args.ts`, `transcodeVideo`), from libx264, `h264_videotoolbox` or `h264_vaapi`.
- **Frames leave the GPU on VideoToolbox.** Decoding uses `-hwaccel videotoolbox` with no `-hwaccel_output_format`, so every frame comes back to the CPU for scaling and tone mapping before the GPU encodes it.
- **Tone mapping is CPU only.** `TONEMAP_FILTER` is a zscale and `tonemap=hable` chain. A NAS-class CPU manages about 1.6 fps at 1080p (the comment in `args.ts`). On VAAPI, HDR is converted to BT.709 instead, so HDR10 comes out flat (`apps/raven/README.md`, "Not there yet").
- **Dolby Vision is invisible.** `isHdr` in `apps/raven/server/src/ffmpeg/probe.ts` folds PQ, HLG and any DOVI record into one boolean. Profile 5 has no HDR10 base, so zscale cannot read its colours and a browser plays it green and purple.
- **The probe keeps too little.** No profile, level, transfer, primaries, Dolby Vision profile or audio layout is stored, so clients ask the browser about representative codec strings, not the file's real ones (`libs/raven/core/src/playback.ts`, `videoCodecString`).
- **Audio is always re-encoded to stereo AAC** at 192k, even in a remux and even when the source is AAC already (`streamArgs`).
- **The GOP is 48 frames** whatever the frame rate, and there is no cap on concurrent transcodes (`ffmpegService.ts` tracks streams only to kill them on shutdown).
- **Docker uses Debian's ffmpeg 7.1** plus `intel-media-va-driver-non-free` (`apps/raven/Dockerfile`). Vhagar passes `/dev/dri/renderD128` into the container (`apps/raven/docker-compose.vhagar.yml`).

## Goals

- Vhagar's Celeron J4125 tone maps a 4K HDR10 or Dolby Vision file to 1080p SDR faster than real time, with correct colours.
- A Mac transcodes on the GPU end to end.
- A client that can show HDR gets HDR; one that cannot gets a proper tone map.
- Audio a client can play is copied; audio it cannot play is converted with its channels kept.
- The desktop's mpv gets a stream that copies lossless audio and picture subtitles.

## Non-goals

- HLS and adaptive bitrate: one stream per play, as `2026-10-08-raven-player-design.md` decided.
- NVENC, AMF, QSV and libplacebo backends until there is hardware to test them on. The capability probe and the backend union below make each one an added entry. QSV would not help Vhagar anyway: the J4125 has no VPP tone mapping.
- Burning picture subtitles into a browser's transcode. The desktop shows them through mpv.

## 1. ffmpeg: jellyfin-ffmpeg

- **Docker** installs the pinned `jellyfin-ffmpeg8` deb for trixie in place of Debian's `ffmpeg`, and sets `FFMPEG_PATH` and `FFPROBE_PATH` to `/usr/lib/jellyfin-ffmpeg/`. It adds the filters this spec needs:
  - `tonemapx`, a SIMD CPU tone mapper that replaces the zscale chain;
  - `tonemap_opencl`, with Jellyfin's BT.2390 curve and Dolby Vision reshaping;
  - `tonemap_videotoolbox` (Metal) and `scale_vt`;
  - `tonemap_vaapi`, `tonemap_cuda` and `vpp_qsv` for later backends.
- **OpenCL for the J4125.** trixie does not ship `intel-opencl-icd`, and Intel's current compute runtime dropped Gen8 to Gen11 from 24.39. The image installs Intel's `intel-opencl-icd-legacy1` and its IGC packages, the versions Jellyfin's own trixie image pins (24.35.30872.36 and IGC 1.0.17537.24 at the time of writing). amd64 only, like the VAAPI driver.
- **The desktop** uses jellyfin-ffmpeg's portable builds (`fetch:ffmpeg` in the desktop spec).
- **Licence:** jellyfin-ffmpeg is GPL, as Debian's ffmpeg with libx264 already is.

## 2. Capabilities, probed once

`FfmpegService` grows from `canTonemap` and one cached encoder into a `Capabilities` record, probed at startup and again when the playback settings change:

- the filters present (`ffmpeg -filters`);
- the encoders that pass a test encode, per codec and bit depth: `h264`, `hevc` 8-bit, `hevc` 10-bit, `av1`. `encoderTestArgs` already does one; it runs once per candidate;
- the OpenCL device, by initialising `opencl=ocl@va` from the VAAPI device;
- the tone mapper that will be used: `opencl`, `videotoolbox`, `software` or none.

`encoderCandidates` in `encoder.ts` stays the place that lists backends per platform. `/api/health` and the playback settings' `effective` block report the capabilities, so Settings can say "Tone mapping on the GPU (OpenCL)" and a client knows which targets it may ask for.

## 3. The probe keeps what clients need

- **Video:** `hdrFormat` (`sdr`, `hdr10`, `hdr10plus`, `hlg`, `dolbyVision`) replaces the `hdr` boolean, and a core helper `isHdr` serves the badges. Also stored: `dvProfile` and `dvFallback` (the base layer's compatibility: `hdr10`, `hlg`, `sdr` or none, from the DOVI record's compatibility id), `videoProfile`, `videoLevel`, `frameRate`, `colorTransfer` and `colorPrimaries`.
- **HDR10+** needs a frame's side data, so the probe reads one frame (`-read_intervals %+#1`) only when the transfer is PQ.
- **Audio tracks** gain the codec `profile` (TrueHD Atmos, DTS-HD MA, DTS:X, E-AC3 Atmos), the channel `layout` and the bitrate.
- **Where:** `probe.ts`, `MediaItem` and `AudioTrack` in `libs/raven/core/src/contract.ts` with their guards, and `saveProbe` in `mediaIndex.ts`. The new columns come in through a `user_version` migration in `openSqlite` (`libs/shared/server/src/sqlite.ts`). Existing rows are re-probed lazily: on the next scan, or on first play.

## 4. Pipelines that stay on the GPU

A pipeline builder replaces the branches in `transcodeVideo`. It takes `{ source, target, backend, capabilities }` and returns ffmpeg's arguments:
- the source is the probed video;
- the target is the codec, bit depth, HDR handling, height and bitrate;
- the backend is a `VideoEncoder`.

Each backend's arguments are unit tested, as `args.ts` is today.

- **Software:** CPU decode, `scale`, `tonemapx` to BT.709 when tone mapping, libx264. `tonemapx` replaces `TONEMAP_FILTER`.
- **VAAPI with OpenCL (Vhagar):**
  - `-init_hw_device vaapi=va:<device>` and `-init_hw_device opencl=ocl@va`;
  - VAAPI decode of H.264 and HEVC, kept on the GPU (`-hwaccel_output_format vaapi`);
  - for an SDR target from an HDR source: `scale_vaapi` to P010, `hwmap` to OpenCL, `tonemap_opencl` (BT.2390, which also reshapes Dolby Vision profile 5), and `hwmap` back to VAAPI;
  - `h264_vaapi`, or `hevc_vaapi` where the capability probe passes it.
  - This fixes today's flat HDR10. Codecs the J4125 cannot decode (AV1, VP9 profile 2) decode on the CPU and upload, as now.
- **VideoToolbox (Mac):**
  - `-hwaccel videotoolbox -hwaccel_output_format videotoolbox_vld`, so frames stay on the GPU;
  - `scale_vt`, then `tonemap_videotoolbox` for an SDR target from an HDR source;
  - `h264_videotoolbox`, or `hevc_videotoolbox` at 10-bit for an HDR target.
- **HDR-keeping targets:** HEVC 10-bit with the HDR10 metadata copied, or AV1, when the client asks for HDR and the capability probe found the encoder. Intel's driver tables say the J4125 encodes HEVC at 8-bit only, while Jellyfin's docs say 10-bit works. S4 checks `vainfo` on Vhagar for `VAProfileHEVCMain10` with `VAEntrypointEncSlice`. Without it, Vhagar keeps tone mapping to H.264.

## 5. Streams

- **The stream URL gains the target.** `streamUrl` in `libs/raven/core/src/apiClient.ts` and `PlaybackController.stream` accept:

  | Parameter | Values | Default |
  | --- | --- | --- |
  | `video` | `h264`, `hevc`, `av1` | `h264` |
  | `hdr` | `keep`, `tonemap` | `tonemap` |
  | `height` | a whole number of pixels | the Settings ceiling |
  | `bitrate` | kilobits per second | from the Settings quality |
  | `audioCodec` | `copy`, `aac`, `opus` | `aac` |
  | `channels` | 2, 6, 8 | 2 |
  | `container` | `mp4`, `mkv` | `mp4` |

  `audio` keeps meaning the track index. Settings stay the ceiling: a request may ask for less than `maxHeight` and `quality` allow, never more, and a target the capabilities lack is a 400 that names it.
- **`container=mkv`** is for mpv. It copies the chosen audio as it is (TrueHD, DTS-HD) and maps the subtitle tracks, picture ones included, so a remote transcode loses nothing but video bitrate. `mp4` stays fragmented for MSE.
- **Audio** is copied when the client said it can play it. Otherwise it is converted to AAC or Opus with its channels kept up to the requested count; stereo is a downmix only when asked for. A remux with AAC audio no longer re-encodes it.
- **A 2 s GOP:** `-g` and the keyframe interval come from the probed frame rate, not a fixed 48, so 60 fps sources do not get 0.8 s fragments.
- **A concurrency cap:** `TRANSCODE_LIMIT` (default 2) counts transcodes, not remuxes. One more gets a 503 with a message the player shows.

## 6. The client picks the target

- **`planPlayback` stays synchronous.** The web app takes a capability snapshot when it starts and passes it in through a new pluggable `ClientCapabilities` in `libs/raven/core/src/playback.ts`, so core stays free of the DOM. The snapshot holds:
  - `matchMedia('(dynamic-range: high)')`;
  - `MediaCapabilities.decodingInfo` answers for HEVC 10-bit PQ, AV1 10-bit PQ and Dolby Vision, with their HDR metadata;
  - the audio codecs and channel counts MSE accepts.
- **Real codec strings.** With profile and level probed, `videoCodecString` builds the file's own string (`hvc1.2.4.L153.B0`, `dvh1.05.06`, `av01.0.13M.10`) instead of a representative one.
- **Dolby Vision in a browser:**
  - profile 8.1 and 8.4 direct-play as their HDR10 or HLG base where the browser takes it;
  - profile 5 never direct-plays; it transcodes, tone mapped on the GPU, or HDR kept as HEVC 10-bit HDR10 where the server can encode it.
- **The transcode's target** follows from the snapshot and the server's capabilities: HEVC with `hdr=keep` for an HDR display that decodes it, H.264 with `hdr=tonemap` otherwise, and the source audio copied when MSE accepts it.
- **The desktop's native engine** asks for `container=mkv`, `audioCodec=copy`, `hdr=keep`, and HEVC or AV1, whichever the server has, at a bitrate below the measured link speed.

## Order of work (one PR each, alongside the desktop work)

1. **S1:** probe expansion, the migration, and the contract fields with their guards.
2. **S2:** jellyfin-ffmpeg and the OpenCL packages in Docker, `FFMPEG_PATH` and `FFPROBE_PATH` pointed at it, with no behaviour change. Record the baselines below on Vhagar.
3. **S3:** the capabilities record, the pipeline builder with the software backend and `tonemapx`, the 2 s GOP and the cap.
4. **S4:** VAAPI with OpenCL on Vhagar, and the `vainfo` check for 10-bit HEVC encoding.
5. **S5:** the VideoToolbox pipeline kept on the GPU.
6. **S6:** the client-driven stream parameters, audio copy, `container=mkv`, the capability snapshot and the real codec strings.
7. **S7, when test hardware exists:** NVENC, AMF and QSV.

## Verification

- **Checks:** `bun run verify` passes; `bunx nx run @raven/server:test` covers each backend's arguments, the parameter bounds and the cap; `bunx nx run @raven/core:test` covers the codec strings and the target choice.
- **Docker smoke test:** `/api/health` reports the capabilities, and Vhagar reports `opencl` as the tone mapper.
- **Speed,** read from ffmpeg's `speed=`. These are targets; S2 records the baselines first. The M numbers are the test files in the desktop spec.
  - On Vhagar:
    - M2 to 1080p H.264 SDR through VAAPI and OpenCL: at least 1.25x real time, where today's CPU tone map manages 1.6 fps;
    - M4 to SDR: correct colours, at least 1x;
    - 1080p HEVC to H.264: at least 3x;
    - a remux: at least 10x;
    - `tonemapx` against the zscale chain on the CPU: at least 3x faster.
  - On a Mac: 4K HDR10 to 1080p SDR through VideoToolbox: at least 4x.
- **Behaviour:**
  - the first fragment arrives, and a seek outside the buffer restarts, within 2 s;
  - one transcode over the cap gets the 503 and its message;
  - no ffmpeg process remains 2 s after the client disconnects;
  - a remux of an AAC file copies its audio, and a Safari remux of an E-AC3 file copies it;
  - M2 through `container=mkv` plays in mpv with TrueHD and PGS intact.
- **Eyes:** M2, M4 and M6 transcoded to SDR, side by side with mpv's own tone map of the same frames. None may look flat, grey or tinted.

## Sources

- jellyfin-ffmpeg releases and its patches (`tonemapx`, `tonemap_opencl`, `tonemap_videotoolbox`): <https://github.com/jellyfin/jellyfin-ffmpeg/releases>, <https://github.com/jellyfin/jellyfin-ffmpeg/tree/jellyfin/debian/patches>
- Intel's media driver, per-generation codec support: <https://github.com/intel/media-driver/blob/master/README.md>
- Jellyfin on Intel and Apple hardware: <https://jellyfin.org/docs/general/post-install/transcoding/hardware-acceleration/intel>, <https://jellyfin.org/docs/general/post-install/transcoding/hardware-acceleration/apple>
- `intel-opencl-icd` missing from trixie: <https://packages.debian.org/search?keywords=intel-opencl-icd>
- Intel's compute runtime dropping Gen8 to Gen11: <https://www.fedoraproject.org/wiki/Changes/IntelCompute2025>
- Jellyfin's trixie image and its legacy OpenCL packages: <https://github.com/jellyfin/jellyfin-packaging/blob/master/docker/Dockerfile>
