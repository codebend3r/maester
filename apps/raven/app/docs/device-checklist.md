# raven's device app on real devices

What only a real device can answer, and what is known not to work yet. Part of [raven's device app](../README.md).

## The checklist

Ruling 21 of the [plan](../../../../docs/superpowers/plans/2026-10-18-raven-device-apps.md) leaves the real-device pass to the person with the devices. CI has only an iPhone simulator, an Apple TV simulator and an Android TV emulator: none shows HDR or Dolby Vision, decodes in a real TV's hardware, passes sound to a receiver, or does Picture in Picture and AirPlay as a device does, and the emulator decodes no AC-3, E-AC-3, DTS, TrueHD or ALAC. So nothing in CI can fill this table. Play each file on the iPhone or iPad, the Apple TV 4K and the Android TV, installed as the [raven README](../../README.md#raven-app-iphone-ipad-apple-tv-android-tv) says, from a server that has them, and write in Result, for each device, whether it played, and what was wrong if not: no picture, no sound, the wrong colours, missing subtitles, a step down that never came.

The files are the desktop spec's test media (`docs/superpowers/specs/2026-10-12-raven-desktop-design.md`, "Shared test media"), one per row, kept outside the repo.

|     | File                                                                       | What it checks                                         | Result |
| --- | -------------------------------------------------------------------------- | ------------------------------------------------------ | ------ |
| M1  | MP4, H.264 1080p24, AAC 2.0, mov_text                                      | the baseline                                           |        |
| M2  | MKV, HEVC 10-bit 2160p HDR10, TrueHD 7.1 Atmos and AC3, PGS, 60 to 80 Mb/s | HDR, passthrough, picture subtitles                    |        |
| M3  | HEVC Dolby Vision profile 8.1, E-AC3 Atmos, SRT                            | Dolby Vision with an HDR10 base                        |        |
| M4  | HEVC Dolby Vision profile 5, E-AC3                                         | reshaping: no green or purple cast                     |        |
| M5  | Dolby Vision profile 7 FEL, from a UHD Blu-ray                             | the base layer plays                                   |        |
| M6  | HLG 2160p50                                                                | HLG                                                    |        |
| M7  | HDR10+                                                                     | dynamic metadata                                       |        |
| M8  | AV1 10-bit HDR, Opus 5.1                                                   | AV1 in hardware where the device has it                |        |
| M9  | WebM, VP9 profile 2 HDR                                                    | VP9 HDR                                                |        |
| M10 | H.264 High 10, FLAC, ASS with attached fonts                               | the transcode for 10-bit H.264, FLAC, styled subtitles |        |
| M11 | TS, MPEG-2 1080i, DVB subtitles                                            | deinterlacing                                          |        |
| M12 | M2TS, VC-1, DTS-HD MA, PGS                                                 | an older Blu-ray                                       |        |
| M13 | DVD MPEG-2 480i, VobSub                                                    | VobSub                                                 |        |
| M14 | HEVC 2160p60, peaks of 100 Mb/s                                            | frame pacing under load                                |        |
| M15 | DTS core, LPCM 7.1, SRT sidecars in UTF-8 and cp1252, WebVTT               | audio variety, sidecars                                |        |

Check these on the devices too, since only a device can answer them:

- **The cookie on Apple devices.** On a server with no `RAVEN_MEDIA_SECRET`, a title in a locked library plays, direct and through the remux. The app sends the cookie as a header beside the system's own cookie store (`AVURLAssetHTTPCookiesKey`); the simulator's end to end plays the remux that way, and a device is still to confirm it.
- **Subtitles on Android TV.** ExoPlayer draws them. Check a text track inside the file, a sidecar beside a file played as it is, and a remux's rendition: each in the account's size and colour, changing with the dialogue, and clear of the controls while they show.
- **Subtitles under the thumb.** raven draws them (Ruling 25), since on the simulator AVPlayer drew neither a sidecar nor an HLS rendition. Check whether a device's AVPlayer draws its own tracks; Picture in Picture and AirPlay show none either way.
- **Subtitles on Apple TV.** raven draws them, as under the thumb, so a file with a text subtitle still plays as it is; a picture track is burned in by the server.
- **Sound on Android TV.** A file whose sound the TV can neither decode nor pass on steps down to the remux, where it plays as E-AC-3.
- **Away from home.** With Settings' cap at 1080p, a transcode played from a `public` origin asks for the server's lowest 1080p size.

## Known gaps

- **Apple TV's controls are unconfirmed on a device.** The Siri Remote drives the same chrome as Android TV's d-pad, through the same key handling, and only the simulator has run it.
- **ALAC over HLS may be silent on Android TV.** The remux copies ALAC, which ExoPlayer leaves out on a TV with no ALAC decoder, and `canStream` cannot see it. The fix is the server's: make ALAC FLAC or E-AC-3 over HLS, or say what the stream carries.
- **See all may open a library with its first bucket shut on Android TV.** On the emulator, Home's See all pressed with `adb shell input keyevent DPAD_CENTER` opened the library with the remote on its first bucket heading and that bucket shut, as if the key reached the heading too. It is still to be checked with a real remote.
- **One account's streams can end everyone's.** The server keeps eight HLS sessions in all and drops the longest idle to open a ninth, so an account that opens eight ends every other device's stream, which then opens the master again.
- **A direct play the server lets go of on Apple pauses for a dozen seconds first.** When a file's pass ends mid-play (its twelve hours, a restart, or too many at once), AVPlayer retries the refused ranges for a dozen seconds and then stalls without a word, so the app opens the file again from the spot once it has waited ten seconds. ExoPlayer on Android TV reports a refused range as an error with its status, which the app reads, so the reopen should come sooner there; that is still to be seen on the emulator.
- **No covers view.** The web's bare covers view has no layout in the app yet: a library left on covers opens on the grid, and the app's view picker does not offer it.
