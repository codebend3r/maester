# Which app plays which video

Which video codecs each raven app plays as they are, with no transcode. Part of [raven](../README.md).

✅ plays as it is. ❌ does not: the server transcodes it to H.264. ⚠️ depends, as the notes under the table say.

| App | MPEG-2 (H.262) | VC-1 (WMV9) | H.264 (AVC) | H.265 (HEVC) | VP9 | AV1 | H.266 (VVC) |
| ---------------------- | -------------- | ----------- | ----------- | ------------ | ---- | ---- | ----------- |
| Web (browser) | ❌ | ❌ | ✅ | ⚠️ | ⚠️ | ⚠️ | ❌ |
| Raven on macOS | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ |
| Raven on Windows | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ |
| iPhone | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ |
| iPad | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Apple TV | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Android TV | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Android phones | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ |

- **Web, H.265, VP9 and AV1:** the web app asks the browser, so it depends on the browser: Safari plays HEVC, Chrome and Edge play it with hardware decoding, and Chrome, Edge and Firefox play VP9 and AV1.
- **Raven, H.266:** Raven's libmpv has a VVC decoder, but nobody has tried a VVC file in it.

H.264 means 8-bit. 10-bit H.264 plays only in Raven on macOS and Windows.

## HDR formats

✅ shows the format as what it is. ❌ does not: the picture is tone mapped to SDR or shown as a lesser format.

| App | HDR10 | HDR10+ | Dolby Vision 5 | Dolby Vision 7 | HLG | PQ10 |
| ---------------- | ----- | ------ | -------------- | -------------- | ---- | ---- |
| Web (browser) | ⚠️ | ❌ | ❌ | ❌ | ⚠️ | ⚠️ |
| Raven on macOS | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Raven on Windows | ✅ | ✅ | ⚠️ | ⚠️ | ✅ | ✅ |
| iPhone | ✅ | ⚠️ | ✅ | ❌ | ✅ | ✅ |
| iPad | ✅ | ⚠️ | ✅ | ❌ | ✅ | ✅ |
| Apple TV | ✅ | ⚠️ | ❌ | ❌ | ✅ | ✅ |
| Android TV | ✅ | ⚠️ | ✅ | ❌ | ✅ | ✅ |
| Android phones | ✅ | ⚠️ | ⚠️ | ❌ | ✅ | ✅ |

- **Web, HDR10, HLG and PQ10:** only where the browser plays the file itself, and then the browser and the screen decide. A transcode is tone mapped to SDR.
- **Raven on Windows, Dolby Vision:** the macOS libmpv is built with Dolby Vision reshaping. Windows ships a prebuilt libmpv that should do the same; unconfirmed.
- **HDR10+ on iPhone, iPad, Apple TV and Android:** raven does not read HDR10+ metadata but leaves it in the stream, so the device decides. Unconfirmed on any device.
- **Apple TV, Dolby Vision 5:** the Apple TV is sent the same Dolby Vision stream as the iPhone and iPad, but does not show it yet (reported 2026-11-20).
- **Android phones, Dolby Vision 5:** only on a phone with a Dolby Vision decoder.
- **Dolby Vision 7:** profile 7, a UHD Blu-ray's, plays as its HDR10 base layer: no decoder on these devices takes it.

Profile 8 plays where profile 5 does.

## Plex

The same two tables for Plex's web, desktop and Apple apps. These are not read from code or checked against a Plex install: they come from general knowledge of Plex's players, so confirm a cell before relying on it.

### Plex: codecs

| App | MPEG-2 (H.262) | VC-1 (WMV9) | H.264 (AVC) | H.265 (HEVC) | VP9 | AV1 | H.266 (VVC) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Plex Web (browser) | ❌ | ❌ | ✅ | ⚠️ | ⚠️ | ⚠️ | ❌ |
| Plex desktop (Mac and Windows) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Plex on iPhone | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | ❌ |
| Plex on iPad | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | ❌ |
| Plex on Apple TV | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ | ❌ |

- **Plex Web, H.265, VP9 and AV1:** it depends on the browser, as for raven's web app.
- **iPhone, iPad and Apple TV, MPEG-2, VC-1 and VP9:** decoded in software by Plex's own player, which takes over where AVPlayer refuses a file. raven's app has only AVPlayer.
- **iPhone, iPad and Apple TV, AV1:** only on a device with an AV1 decoder in hardware.
- **H.266:** Plex names no VVC support, and its server cannot transcode it.

### Plex: HDR formats

| App | HDR10 | HDR10+ | Dolby Vision 5 | Dolby Vision 7 | HLG | PQ10 |
| --- | --- | --- | --- | --- | --- | --- |
| Plex Web (browser) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Plex desktop (Mac and Windows) | ⚠️ | ❌ | ❌ | ❌ | ⚠️ | ⚠️ |
| Plex on iPhone | ✅ | ⚠️ | ⚠️ | ❌ | ✅ | ✅ |
| Plex on iPad | ✅ | ⚠️ | ⚠️ | ❌ | ✅ | ✅ |
| Plex on Apple TV | ✅ | ⚠️ | ⚠️ | ❌ | ✅ | ✅ |

- **Plex Web:** shows no HDR. The server transcodes and tone maps to SDR.
- **Plex desktop, HDR10, HLG and PQ10:** Plex HTPC passes HDR through to an HDR display; Plex for Mac and Windows tone maps it to SDR.
- **Plex desktop, Dolby Vision:** none. Profile 7 plays as its HDR10 base; profile 5 is transcoded.
- **HDR10+ on iPhone, iPad and Apple TV:** played as HDR10 with the metadata left in, so the device decides.
- **Dolby Vision 5 on iPhone, iPad and Apple TV:** only from an MP4 file. From MKV, which is how most such files arrive, it is transcoded.
- **Dolby Vision 7:** plays as its HDR10 base layer, as in raven.

The raven answers come from `apps/raven/app/src/platform/canPlay.ts` (iPhone, iPad, Apple TV, Android), `libs/raven/ui/src/lib/canPlay.ts` (web) and the libmpv build in `libs/raven/mpv` (Raven). Change this table in the same PR that changes them.
