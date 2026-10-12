# raven probe expansion (S1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The probe tells HDR formats apart and keeps what a client needs to name a file's codec exactly: HDR format, Dolby Vision profile, level and fallback, video profile and level, colour transfer and primaries, and each audio track's profile, layout and bitrate.

**Architecture:** `@raven/core` gains `HdrFormat`, `DvFallback`, the new `MediaItem` and `AudioTrack` fields with their guards, and `isHdr`, which replaces the `hdr` boolean everywhere it is read. The server's `parseProbe` reads the new fields, and `FfmpegService.probeFile` reads one frame of a PQ video to find HDR10+. One `user_version` migration adds the columns and a `probe_version`, so the next scan probes every file once more; tracks stored before the new audio fields fail their guard, so a first play re-probes too.

**Tech Stack:** NestJS 12 + vitest + better-sqlite3 (server), `@raven/core` schema combinators + vitest, React 19 + bun test (web), ffprobe.

**Spec:** `docs/superpowers/specs/2026-10-12-raven-transcoding-design.md`, section 3 and "Order of work" S1.

## Global Constraints

- Every rule in the root `CLAUDE.md` holds: no `any`, no casts, no non-null assertions outside tests, `type` not `interface`, no enums, named exports, no `for` loops, one object parameter when there are two or more, `@/` imports with no extension, `??` over `||`, no em or en dashes anywhere.
- `libs/raven/core` stays free of DOM and Node APIs.
- Run tasks through Nx from the repo root: `bunx nx run @raven/core:test`, `bunx nx run @raven/server:test`, `bunx nx run @raven/web:test`, `bun run verify`.
- Commits follow the `commit-format` skill: `MAE:` subject, short bullet body, no agent attribution.
- Branch `raven-probe-expansion` from an up-to-date `main`. This PR lands before the `@raven/ui` extraction (desktop step 3), never alongside it: both touch the web files below.
- No behaviour change beyond the probe. Thumbnails and transcodes still tone map exactly the files they did (`isHdr` is true for the same files the old `hdr` flag was).

## Deviations from the spec, on purpose

- **`dvLevel` is added.** The spec's own codec string example `dvh1.05.06` ends in the Dolby Vision level, which S6 needs.
- **`frameRate` is not added to `MediaItem`.** It is already probed into `MediaTracks.frameRate` (`apps/raven/server/src/ffmpeg/tracks.ts`), which S3's GOP reads; a second copy would be a second source of truth.
- **The frame read skips Dolby Vision files.** Dolby Vision outranks HDR10+ in `hdrFormat`, so its frame would change nothing.
- **Re-probing is marked by a `probe_version` column,** not by the new columns being NULL, so the next probe expansion bumps one constant.
- **The `hdr` column stays and is still written,** so an older image can still read the table after a rollback. Nothing reads it any more.

## Review Focus

1. **A library scanned before this PR:** the next scan probes every file exactly once more, then never again, and leaves its thumbnail alone. Pinned in Task 4 (`probe_version` rule, thumbnail state kept).
2. **HDR badges between the upgrade and that scan:** a probed HDR file keeps its badge; the migration maps the old flag to `hdr10` until the re-probe says better. Pinned in Task 4 (migration test).
3. **A PQ file whose first frame will not read** (a timeout on a slow share, a broken frame): it is still probed, as HDR10, never recorded as a probe error. Pinned in Task 3.
4. **Cover art before the video:** the frame read targets the real video stream by its absolute index, not `v:0`. Pinned in Tasks 2 and 3.
5. **Tracks stored before this PR:** a first play re-probes the file and refreshes its row instead of failing. Pinned in Task 5.

## Files

| File | Change |
| --- | --- |
| `libs/raven/core/src/contract.ts` | `isHdrFormat`, `isDvFallback`; `isMediaItem` drops `hdr`, gains 8 fields; `isAudioTrack` gains 3 |
| `libs/raven/core/src/media.ts` | `isHdr` |
| `libs/raven/core/src/test/fixtures.ts`, `libs/raven/core/src/apiClient.test.ts` | fixtures follow the contract |
| `apps/raven/server/src/ffmpeg/probe.ts` | `PROBE_VERSION`, `hdrFrameStream`, `parseProbe({ output, firstFrame })`, exported `numeric` |
| `apps/raven/server/src/ffmpeg/tracks.ts` | audio `profile`, `layout`, `bitrate` |
| `apps/raven/server/src/ffmpeg/ffmpegService.ts` | `probeFile` reads a PQ video's first frame |
| `apps/raven/server/src/db/database.ts` | one migration |
| `apps/raven/server/src/media/mediaIndex.ts` | `MediaFile.hdrFormat`, `saveProbe`, `forLibrary` |
| `apps/raven/server/src/media/mediaRepository.ts` | `MediaRow` and `toItem` |
| `apps/raven/server/src/thumbnails/thumbnailService.ts`, `apps/raven/server/src/playback/playbackController.ts` | `isHdr(file)` |
| `apps/raven/server/src/playback/tracksService.ts` | a stale or missing store re-probes the whole file |
| `apps/raven/server/src/test/probes.ts` | NEW: `probeResult()` fixture |
| `apps/raven/web/src/components/MediaCard/MediaCard.tsx`, `MediaTiles/MediaTiles.tsx`, `lib/itemFacts.ts` | `isHdr(media)` |
| web fixtures and tests | follow the contract |

---

### Task 1: The contract in `@raven/core`

**Files:**
- Modify: `libs/raven/core/src/contract.ts` (`isMediaItem` near line 312, `isAudioTrack` near line 907)
- Modify: `libs/raven/core/src/media.ts`
- Modify: `libs/raven/core/src/test/fixtures.ts` (`mediaItem`)
- Modify: `libs/raven/core/src/apiClient.test.ts` (every audio track literal)
- Test: `libs/raven/core/src/media.test.ts`, `libs/raven/core/src/contract.test.ts`

**Interfaces:**
- Produces: `isHdrFormat`, `type HdrFormat = 'sdr' | 'hdr10' | 'hdr10plus' | 'hlg' | 'dolbyVision'`, `isDvFallback`, `type DvFallback = 'hdr10' | 'hlg' | 'sdr'`, `isHdr({ hdrFormat }: Pick<MediaItem, 'hdrFormat'>): boolean`. `MediaItem` loses `hdr` and gains `hdrFormat: HdrFormat | null`, `dvProfile: number | null`, `dvLevel: number | null`, `dvFallback: DvFallback | null`, `videoProfile: string | null`, `videoLevel: number | null`, `colorTransfer: string | null`, `colorPrimaries: string | null`. `AudioTrack` gains `profile: string | null`, `layout: string | null`, `bitrate: number | null`.

- [ ] **Step 1: Write the failing tests**

Append to `libs/raven/core/src/media.test.ts` (add `isHdr` to its import from `@/media`):

```ts
describe('isHdr', () => {
  it.each(['hdr10', 'hdr10plus', 'hlg', 'dolbyVision'] as const)('counts %s as HDR', (hdrFormat) => {
    expect(isHdr({ hdrFormat })).toBe(true)
  })

  it('counts SDR, and a file not probed yet, as not HDR', () => {
    expect(isHdr({ hdrFormat: 'sdr' })).toBe(false)
    expect(isHdr({ hdrFormat: null })).toBe(false)
  })
})
```

Append to `libs/raven/core/src/contract.test.ts` (add `isAudioTrack` and `isMediaItem` to its `@/contract` import, and `mediaItem` from `@/test/fixtures` if it is not imported yet):

```ts
describe('isMediaItem', () => {
  it('accepts a Dolby Vision profile 5 file, which has no fallback', () => {
    const media = mediaItem({ hdrFormat: 'dolbyVision', dvProfile: 5, dvLevel: 6, dvFallback: null })
    expect(isMediaItem(media)).toBe(true)
  })

  it('rejects an HDR format it does not know', () => {
    expect(isMediaItem({ ...mediaItem(), hdrFormat: 'hdr12' })).toBe(false)
  })

  it('rejects the old hdr flag in place of the format', () => {
    expect(isMediaItem({ ...mediaItem(), hdrFormat: undefined, hdr: true })).toBe(false)
  })
})

describe('isAudioTrack', () => {
  it('needs the profile, layout and bitrate, so tracks stored before them read as stale', () => {
    const stale = {
      index: 0,
      codec: 'truehd',
      channels: 8,
      language: 'en',
      title: null,
      default: true,
    }
    expect(isAudioTrack(stale)).toBe(false)
    expect(
      isAudioTrack({ ...stale, profile: 'Dolby TrueHD + Dolby Atmos', layout: '7.1', bitrate: null }),
    ).toBe(true)
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `bunx nx run @raven/core:test`
Expected: FAIL. `isHdr` is not exported, and `mediaItem({ hdrFormat: ... })` does not typecheck.

- [ ] **Step 3: Write the contract**

In `libs/raven/core/src/contract.ts`, above `export const isMediaItem`:

```ts
/** How a video carries HDR: by its transfer, its Dolby Vision record, or HDR10+ in its frames. */
export const isHdrFormat = oneOf(['sdr', 'hdr10', 'hdr10plus', 'hlg', 'dolbyVision'])

export type HdrFormat = Infer<typeof isHdrFormat>

/** What a Dolby Vision file's base layer shows as on a player without Dolby Vision. */
export const isDvFallback = oneOf(['hdr10', 'hlg', 'sdr'])

export type DvFallback = Infer<typeof isDvFallback>
```

In `isMediaItem`, replace `hdr: isBoolean,` with:

```ts
  /** Null until the file has been probed. `isHdr` reads it for the badges. */
  hdrFormat: nullable(isHdrFormat),
  /** Dolby Vision's profile (5, 7, 8) and level; null for anything else. */
  dvProfile: nullable(isNumber),
  dvLevel: nullable(isNumber),
  /** What the base layer plays as without Dolby Vision; null for profile 5, which has none. */
  dvFallback: nullable(isDvFallback),
  /** ffprobe's profile name ('Main 10', 'High') and level (153 for HEVC 5.1), for the file's own codec string. */
  videoProfile: nullable(isString),
  videoLevel: nullable(isNumber),
  /** ffprobe's names: 'smpte2084', 'arib-std-b67', 'bt709'; null when unknown. */
  colorTransfer: nullable(isString),
  colorPrimaries: nullable(isString),
```

In `isAudioTrack`, after `channels: nullable(isNumber),`:

```ts
  /** ffprobe's profile: 'Dolby TrueHD + Dolby Atmos', 'DTS-HD MA', 'LC'; null when it names none. */
  profile: nullable(isString),
  /** ffprobe's channel layout: '7.1', '5.1(side)', 'stereo'. */
  layout: nullable(isString),
  /** Bits per second, from the stream or Matroska's BPS tag. */
  bitrate: nullable(isNumber),
```

If `isBoolean` is now unused in `contract.ts`, the linter says so; it is still used by other guards there, so leave the import.

In `libs/raven/core/src/media.ts`, at the top:

```ts
import type { MediaItem } from '@/contract'
```

and at the end:

```ts
/** HDR of any kind; false for SDR and for a file not probed yet. */
export const isHdr = ({ hdrFormat }: Pick<MediaItem, 'hdrFormat'>): boolean =>
  hdrFormat != null && hdrFormat !== 'sdr'
```

- [ ] **Step 4: Bring the fixtures along**

In `libs/raven/core/src/test/fixtures.ts`, `mediaItem`, replace `hdr: false,` with:

```ts
  hdrFormat: 'sdr',
  dvProfile: null,
  dvLevel: null,
  dvFallback: null,
  videoProfile: 'High',
  videoLevel: 40,
  colorTransfer: 'bt709',
  colorPrimaries: 'bt709',
```

In `libs/raven/core/src/apiClient.test.ts`, add `profile: null, layout: null, bitrate: null` to every audio track literal (search for `channels:`).

- [ ] **Step 5: Run the tests to see them pass**

Run: `bunx nx run @raven/core:test` and `bunx nx run @raven/core:typecheck`
Expected: PASS. (The server and web do not typecheck until Tasks 2 to 6.)

- [ ] **Step 6: Commit**

```bash
git add libs/raven/core
git commit -m "MAE: raven's contract names a video's HDR format and its codec details" -m "- \`hdrFormat\`, Dolby Vision profile, level and fallback, video profile and level, colour transfer and primaries replace \`hdr\`
- audio tracks gain \`profile\`, \`layout\` and \`bitrate\`
- \`isHdr\` serves the badges"
```

---

### Task 2: Parse the new fields from ffprobe

**Files:**
- Modify: `apps/raven/server/src/ffmpeg/probe.ts`
- Modify: `apps/raven/server/src/ffmpeg/tracks.ts`
- Create: `apps/raven/server/src/test/probes.ts`
- Test: `apps/raven/server/src/ffmpeg/probe.test.ts`, `apps/raven/server/src/ffmpeg/tracks.test.ts`

**Interfaces:**
- Consumes: `HdrFormat`, `DvFallback`, `MediaItem` from `@raven/core` (Task 1).
- Produces: `PROBE_VERSION = 1`; `type ProbeResult` (the probed `MediaItem` fields, `hdrFormat` never null); `parseProbe({ output, firstFrame }: { output: unknown; firstFrame: unknown }): ProbeResult | null`; `hdrFrameStream(output: unknown): number | null`; `numeric(value: unknown): number | null` (now exported); `probeResult(overrides?: Partial<ProbeResult>): ProbeResult` in `@/test/probes`.

- [ ] **Step 1: Write the failing tests**

Create `apps/raven/server/src/test/probes.ts`:

```ts
import type { ProbeResult } from '@/ffmpeg/probe'

/** A probed 1080p SDR H.264 file with stereo AAC; override what a test cares about. */
export const probeResult = (overrides: Partial<ProbeResult> = {}): ProbeResult => ({
  duration: 60,
  width: 1920,
  height: 1080,
  videoCodec: 'h264',
  videoBitDepth: 8,
  hdrFormat: 'sdr',
  dvProfile: null,
  dvLevel: null,
  dvFallback: null,
  videoProfile: 'High',
  videoLevel: 40,
  colorTransfer: 'bt709',
  colorPrimaries: 'bt709',
  audioCodec: 'aac',
  audioChannels: 2,
  bitrate: 5_000_000,
  ...overrides,
})
```

In `apps/raven/server/src/ffmpeg/probe.test.ts`, change the import to `import { hdrFrameStream, parseProbe } from '@/ffmpeg/probe'`, give the `hdrEpisode` video stream `profile: 'Main 10', level: 153, color_primaries: 'bt2020'`, change every `parseProbe(x)` call to `parseProbe({ output: x, firstFrame: null })`, and change the first test's expectation to:

```ts
    expect(parseProbe({ output: hdrEpisode, firstFrame: null })).toEqual({
      duration: 2914.72,
      width: 3840,
      height: 2160,
      videoCodec: 'hevc',
      videoBitDepth: 10,
      hdrFormat: 'hdr10',
      dvProfile: null,
      dvLevel: null,
      dvFallback: null,
      videoProfile: 'Main 10',
      videoLevel: 153,
      colorTransfer: 'smpte2084',
      colorPrimaries: 'bt2020',
      audioCodec: 'eac3',
      audioChannels: 6,
      bitrate: 13515263,
    })
```

In the cover-art test, `hdr: false` becomes `hdrFormat: 'sdr'`. Replace the Dolby Vision test with these, and add the `hdrFrameStream` block:

```ts
  const video = (stream: Record<string, unknown>) => ({
    streams: [{ index: 0, codec_name: 'hevc', codec_type: 'video', pix_fmt: 'yuv420p10le', ...stream }],
    format: {},
  })
  const dovi = (profile: number, compatibility: number) => ({
    side_data_list: [
      {
        side_data_type: 'DOVI configuration record',
        dv_profile: profile,
        dv_level: 6,
        dv_bl_signal_compatibility_id: compatibility,
      },
    ],
  })

  it.each([
    { name: 'profile 8.1, over HDR10', profile: 8, compatibility: 1, fallback: 'hdr10' },
    { name: 'profile 8.4, over HLG', profile: 8, compatibility: 4, fallback: 'hlg' },
    { name: 'profile 7, from a UHD Blu-ray', profile: 7, compatibility: 6, fallback: 'hdr10' },
    { name: 'profile 5, with no fallback', profile: 5, compatibility: 0, fallback: null },
  ])('reads Dolby Vision $name', ({ profile, compatibility, fallback }) => {
    const result = parseProbe({
      output: video({ color_transfer: 'smpte2084', ...dovi(profile, compatibility) }),
      firstFrame: null,
    })
    expect(result).toMatchObject({ hdrFormat: 'dolbyVision', dvProfile: profile, dvLevel: 6, dvFallback: fallback })
  })

  it('reads HLG', () => {
    const result = parseProbe({ output: video({ color_transfer: 'arib-std-b67' }), firstFrame: null })
    expect(result?.hdrFormat).toBe('hlg')
  })

  it('calls PQ HDR10+ when its first frame carries SMPTE 2094-40, and HDR10 otherwise', () => {
    const output = video({ color_transfer: 'smpte2084' })
    const firstFrame = {
      frames: [{ side_data_list: [{ side_data_type: 'HDR Dynamic Metadata SMPTE2094-40 (HDR10+)' }] }],
    }
    expect(parseProbe({ output, firstFrame })?.hdrFormat).toBe('hdr10plus')
    expect(parseProbe({ output, firstFrame: { frames: [{}] } })?.hdrFormat).toBe('hdr10')
    expect(parseProbe({ output, firstFrame: null })?.hdrFormat).toBe('hdr10')
  })

  it('leaves colours ffprobe calls unknown as null', () => {
    const result = parseProbe({
      output: video({ color_transfer: 'unknown', color_primaries: 'unknown' }),
      firstFrame: null,
    })
    expect(result).toMatchObject({ hdrFormat: 'sdr', colorTransfer: null, colorPrimaries: null })
  })
})

describe('hdrFrameStream', () => {
  it("names a PQ video's absolute index, past its cover art", () => {
    const output = {
      streams: [
        { index: 0, codec_type: 'video', codec_name: 'mjpeg', disposition: { attached_pic: 1 } },
        { index: 1, codec_type: 'video', codec_name: 'hevc', color_transfer: 'smpte2084' },
      ],
    }
    expect(hdrFrameStream(output)).toBe(1)
  })

  it('needs no frame for SDR, HLG or Dolby Vision', () => {
    const stream = (extra: Record<string, unknown>) => ({
      streams: [{ index: 0, codec_type: 'video', codec_name: 'hevc', ...extra }],
    })
    expect(hdrFrameStream(stream({ color_transfer: 'bt709' }))).toBeNull()
    expect(hdrFrameStream(stream({ color_transfer: 'arib-std-b67' }))).toBeNull()
    expect(
      hdrFrameStream(
        stream({
          color_transfer: 'smpte2084',
          side_data_list: [{ side_data_type: 'DOVI configuration record' }],
        }),
      ),
    ).toBeNull()
  })
```

(The `describe('parseProbe', ...)` block's closing `})` moves to just before `describe('hdrFrameStream', ...)`; keep the existing "returns null" test inside `parseProbe`.)

In `apps/raven/server/src/ffmpeg/tracks.test.ts`, give the TrueHD stream `profile: 'Dolby TrueHD + Dolby Atmos', channel_layout: '7.1', tags: { language: 'eng', title: 'Surround 7.1', 'BPS-eng': '4521000' }` and the AC3 stream `channel_layout: 'stereo', bit_rate: '192000'`, add `profile`, `layout` and `bitrate` to the expected audio tracks, and add:

```ts
  it("keeps each audio track's profile, layout and bitrate, from the stream or Matroska's BPS tag", () => {
    const [truehd, ac3] = parseTracks(probe).audio
    expect(truehd).toMatchObject({ profile: 'Dolby TrueHD + Dolby Atmos', layout: '7.1', bitrate: 4_521_000 })
    expect(ac3).toMatchObject({ profile: null, layout: 'stereo', bitrate: 192_000 })
  })
```

- [ ] **Step 2: Run them to see them fail**

Run: `bunx nx run @raven/server:test -- src/ffmpeg/probe.test.ts src/ffmpeg/tracks.test.ts`
Expected: FAIL (`hdrFrameStream` not exported; `parseProbe` takes the old shape).

- [ ] **Step 3: Write the parser**

Replace `apps/raven/server/src/ffmpeg/probe.ts` from the imports through `parseProbe` with:

```ts
import {
  type DvFallback,
  type HdrFormat,
  type MediaItem,
  isNumber,
  isRecord,
  isString,
} from '@raven/core'

/** Bumped whenever the probe learns something new, so the next scan probes every file again. */
export const PROBE_VERSION = 1

/** What the index keeps from an ffprobe run: the `MediaItem` fields a probe fills in. */
export type ProbeResult = Pick<
  MediaItem,
  | 'duration'
  | 'width'
  | 'height'
  | 'videoCodec'
  | 'videoBitDepth'
  | 'dvProfile'
  | 'dvLevel'
  | 'dvFallback'
  | 'videoProfile'
  | 'videoLevel'
  | 'colorTransfer'
  | 'colorPrimaries'
  | 'audioCodec'
  | 'audioChannels'
  | 'bitrate'
> & {
  /** Never null here: a probe always settles it. */
  hdrFormat: HdrFormat
}

type Stream = Record<string, unknown>

/** ffprobe reports most numbers as strings ("5812.768000"); both shapes are accepted. */
export const numeric = (value: unknown): number | null => {
  const parsed = isString(value) ? Number(value) : value
  return isNumber(parsed) && parsed > 0 ? parsed : null
}

const disposition = ({ stream, flag }: { stream: Stream; flag: string }): boolean =>
  isRecord(stream.disposition) && stream.disposition[flag] === 1

/** 10 from "yuv420p10le", 12 from "yuv444p12be", 8 from "yuv420p". */
const bitDepthOf = (stream: Stream): number | null => {
  const pixelFormat = isString(stream.pix_fmt) ? stream.pix_fmt : ''
  const match = /p(\d{2})(?:le|be)$/.exec(pixelFormat)
  if (match?.[1]) return Number(match[1])
  const raw = numeric(stream.bits_per_raw_sample)
  if (raw != null) return raw
  return pixelFormat === '' ? null : 8
}

const streamsOf = (output: unknown): Stream[] =>
  (isRecord(output) && Array.isArray(output.streams) ? output.streams : []).filter(isRecord)

/** The first video stream that is not cover art. */
const videoOf = (streams: readonly Stream[]): Stream | undefined =>
  streams.find(
    (stream) => stream.codec_type === 'video' && !disposition({ stream, flag: 'attached_pic' }),
  )

const sideDataOf = (record: Record<string, unknown>): Record<string, unknown>[] =>
  (Array.isArray(record.side_data_list) ? record.side_data_list : []).filter(isRecord)

const sideDataNamed = ({ record, name }: { record: Record<string, unknown>; name: string }) =>
  sideDataOf(record).find(
    (entry) => isString(entry.side_data_type) && entry.side_data_type.includes(name),
  ) ?? null

/** ffprobe's name for a colour property, or null when it is missing or 'unknown'. */
const colorName = (value: unknown): string | null =>
  isString(value) && value !== '' && value !== 'unknown' ? value : null

/** Dolby's base-layer compatibility ids: 1 and 6 (UHD Blu-ray) are HDR10, 2 is SDR, 4 is HLG; 0 (profile 5) has none. */
const DV_FALLBACKS: ReadonlyMap<number, DvFallback> = new Map<number, DvFallback>([
  [1, 'hdr10'],
  [2, 'sdr'],
  [4, 'hlg'],
  [6, 'hdr10'],
])

const fallbackOf = (dovi: Record<string, unknown>): DvFallback | null =>
  isNumber(dovi.dv_bl_signal_compatibility_id)
    ? (DV_FALLBACKS.get(dovi.dv_bl_signal_compatibility_id) ?? null)
    : null

const hasHdr10Plus = (firstFrame: unknown): boolean => {
  const frames = isRecord(firstFrame) && Array.isArray(firstFrame.frames) ? firstFrame.frames : []
  return frames.filter(isRecord).some((frame) => sideDataNamed({ record: frame, name: 'SMPTE2094-40' }) != null)
}

/** Dolby Vision outranks HDR10+, which is PQ with dynamic metadata in its frames. */
const hdrFormatOf = ({ stream, firstFrame }: { stream: Stream; firstFrame: unknown }): HdrFormat => {
  if (sideDataNamed({ record: stream, name: 'DOVI' })) return 'dolbyVision'
  const transfer = colorName(stream.color_transfer)
  if (transfer === 'arib-std-b67') return 'hlg'
  if (transfer !== 'smpte2084') return 'sdr'
  return hasHdr10Plus(firstFrame) ? 'hdr10plus' : 'hdr10'
}

/**
 * The stream whose first frame `parseProbe` needs, or null when it needs
 * none: HDR10+ lives only in frames, so a PQ video without Dolby Vision is
 * read one frame deep. Its absolute index, since `v:0` can be cover art.
 */
export const hdrFrameStream = (output: unknown): number | null => {
  const video = videoOf(streamsOf(output))
  if (!video || sideDataNamed({ record: video, name: 'DOVI' })) return null
  if (colorName(video.color_transfer) !== 'smpte2084') return null
  return isNumber(video.index) ? video.index : null
}

/**
 * Reads `ffprobe -show_format -show_streams -of json` output, and the
 * `-show_frames` output of `hdrFrameStream`'s stream when there is one. The
 * video is the first stream that is not cover art; the audio is the track
 * flagged default, else the first one.
 */
export const parseProbe = ({
  output,
  firstFrame,
}: {
  output: unknown
  firstFrame: unknown
}): ProbeResult | null => {
  if (!isRecord(output)) return null
  const streams = streamsOf(output)
  const format = isRecord(output.format) ? output.format : {}

  const video = videoOf(streams)
  const audioTracks = streams.filter((stream) => stream.codec_type === 'audio')
  const audio =
    audioTracks.find((stream) => disposition({ stream, flag: 'default' })) ?? audioTracks[0]

  if (!video && !audio) return null
  const dovi = video ? sideDataNamed({ record: video, name: 'DOVI' }) : null

  return {
    duration: numeric(format.duration) ?? numeric(video?.duration),
    width: numeric(video?.width),
    height: numeric(video?.height),
    videoCodec: video && isString(video.codec_name) ? video.codec_name : null,
    videoBitDepth: video ? bitDepthOf(video) : null,
    hdrFormat: video ? hdrFormatOf({ stream: video, firstFrame }) : 'sdr',
    dvProfile: numeric(dovi?.dv_profile),
    dvLevel: numeric(dovi?.dv_level),
    dvFallback: dovi ? fallbackOf(dovi) : null,
    videoProfile: video && isString(video.profile) ? video.profile : null,
    videoLevel: numeric(video?.level),
    colorTransfer: colorName(video?.color_transfer),
    colorPrimaries: colorName(video?.color_primaries),
    audioCodec: audio && isString(audio.codec_name) ? audio.codec_name : null,
    audioChannels: numeric(audio?.channels),
    bitrate: numeric(format.bit_rate),
  }
}
```

The old `HDR_TRANSFERS` and `isHdr` in this file go: `hdrFormatOf` replaces them.

In `apps/raven/server/src/ffmpeg/tracks.ts`, add `import { numeric } from '@/ffmpeg/probe'`, then above `parseTracks`:

```ts
/** Matroska keeps a track's bitrate in a BPS tag (BPS-eng from some muxers) rather than on the stream. */
const bitrateOf = (stream: Stream): number | null => {
  const tags = isRecord(stream.tags) ? Object.entries(stream.tags) : []
  const tagged = tags.find(([key]) => key === 'BPS' || key.startsWith('BPS-'))?.[1] ?? null
  return numeric(stream.bit_rate) ?? numeric(tagged)
}
```

and in the audio map, after `channels: ...,`:

```ts
    profile: isString(stream.profile) ? stream.profile : null,
    layout: isString(stream.channel_layout) && stream.channel_layout !== '' ? stream.channel_layout : null,
    bitrate: bitrateOf(stream),
```

- [ ] **Step 4: Run them to see them pass**

Run: `bunx nx run @raven/server:test -- src/ffmpeg/probe.test.ts src/ffmpeg/tracks.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/raven/server/src/ffmpeg/probe.ts apps/raven/server/src/ffmpeg/tracks.ts apps/raven/server/src/ffmpeg/probe.test.ts apps/raven/server/src/ffmpeg/tracks.test.ts apps/raven/server/src/test/probes.ts
git commit -m "MAE: raven's probe tells Dolby Vision, HDR10+, HDR10 and HLG apart" -m "- reads Dolby Vision's profile, level and base-layer fallback, the video's profile, level and colours
- audio tracks keep their profile, layout and bitrate, from the stream or Matroska's BPS tag
- \`hdrFrameStream\` names the stream whose first frame shows HDR10+"
```

---

### Task 3: Read a PQ video's first frame

**Files:**
- Modify: `apps/raven/server/src/ffmpeg/ffmpegService.ts` (`probeFile`, near line 91)
- Test: `apps/raven/server/src/ffmpeg/ffmpegService.test.ts`

**Interfaces:**
- Consumes: `hdrFrameStream`, `parseProbe({ output, firstFrame })` (Task 2).
- Produces: `probeFile(path)` unchanged in shape; its `probe.hdrFormat` is `hdr10plus` when the first frame says so.

- [ ] **Step 1: Write the failing tests**

Inside `describe('FfmpegService', ...)` in `ffmpegService.test.ts`:

```ts
  describe('telling HDR10+ from HDR10', () => {
    const PQ_STREAMS = JSON.stringify({
      streams: [
        { index: 0, codec_type: 'video', codec_name: 'mjpeg', disposition: { attached_pic: 1 } },
        {
          index: 1,
          codec_type: 'video',
          codec_name: 'hevc',
          pix_fmt: 'yuv420p10le',
          color_transfer: 'smpte2084',
        },
      ],
      format: { duration: '60' },
    })
    const HDR10_PLUS_FRAME = JSON.stringify({
      frames: [{ side_data_list: [{ side_data_type: 'HDR Dynamic Metadata SMPTE2094-40 (HDR10+)' }] }],
    })

    // Answers the stream probe with PQ_STREAMS, and the one-frame read with
    // `frame`, but only when it asks for stream 1: the video past the cover art.
    const fakeProbe = async ({ name, frame }: { name: string; frame: string }): Promise<void> => {
      const script = [
        '#!/bin/sh',
        'case "$*" in',
        `  *"-select_streams 1 "*-show_frames*) ${frame} ;;`,
        '  *-show_frames*) exit 1 ;;',
        `  *) echo '${PQ_STREAMS}' ;;`,
        'esac',
      ].join('\n')
      await writeFile(join(state.dir, name), `${script}\n`)
      await chmod(join(state.dir, name), 0o755)
    }

    it('reads the first frame of the video, past its cover art, and finds HDR10+', async () => {
      await fakeProbe({ name: 'hdr10plus', frame: `echo '${HDR10_PLUS_FRAME}'` })
      const { probe } = await service('hdr10plus').probeFile('/media/a.mkv')
      expect(probe.hdrFormat).toBe('hdr10plus')
    })

    it('calls a PQ video HDR10 when its first frame will not read, rather than failing the probe', async () => {
      await fakeProbe({ name: 'frameless', frame: 'exit 1' })
      const { probe } = await service('frameless').probeFile('/media/a.mkv')
      expect(probe.hdrFormat).toBe('hdr10')
    })
  })
```

- [ ] **Step 2: Run them to see them fail**

Run: `bunx nx run @raven/server:test -- src/ffmpeg/ffmpegService.test.ts`
Expected: FAIL. The first test gets `hdr10`, because no frame is read yet.

- [ ] **Step 3: Read the frame**

In `ffmpegService.ts`, import `hdrFrameStream` beside `parseProbe`, add below `probeJson`:

```ts
  /** One frame of one stream, for what only frames carry: HDR10+'s dynamic metadata. */
  private async firstFrameJson({ path, stream }: { path: string; stream: number }): Promise<unknown> {
    const { stdout } = await run(
      this.config.ffprobePath,
      [
        '-v',
        'error',
        '-select_streams',
        String(stream),
        '-read_intervals',
        '%+#1',
        '-show_frames',
        '-of',
        'json',
        path,
      ],
      { maxBuffer: 16 * 1024 * 1024, timeout: this.config.ffmpegTimeoutSeconds * 1000 },
    )
    const parsed: unknown = JSON.parse(stdout)
    return parsed
  }
```

and replace `probeFile` with:

```ts
  /**
   * One ffprobe run, read twice: what the index keeps, and the file's
   * tracks. A PQ video is read one frame deeper, for HDR10+.
   */
  async probeFile(path: string): Promise<{ probe: ProbeResult; tracks: FileTracks }> {
    const output = await this.probeJson(path)
    const stream = hdrFrameStream(output)
    // A frame that will not read costs the file its HDR10+ name, not its probe: it is still HDR10.
    const firstFrame =
      stream == null ? null : await this.firstFrameJson({ path, stream }).catch(() => null)
    const probe = parseProbe({ output, firstFrame })
    if (!probe) throw new Error('No audio or video streams')
    return { probe, tracks: parseTracks(output) }
  }
```

- [ ] **Step 4: Run them to see them pass**

Run: `bunx nx run @raven/server:test -- src/ffmpeg/ffmpegService.test.ts`
Expected: PASS, including the existing timeout and broken-file tests.

- [ ] **Step 5: Commit**

```bash
git add apps/raven/server/src/ffmpeg/ffmpegService.ts apps/raven/server/src/ffmpeg/ffmpegService.test.ts
git commit -m "MAE: raven reads a PQ video's first frame to find HDR10+" -m "- one frame of the video stream past any cover art, only for PQ without Dolby Vision
- a frame that will not read leaves the file HDR10 instead of failing its probe"
```

---

### Task 4: Store it: the migration, the index and the listings

**Files:**
- Modify: `apps/raven/server/src/db/database.ts` (append to `MIGRATIONS`)
- Modify: `apps/raven/server/src/media/mediaIndex.ts` (`MediaFile`, `FileRow`, `fileOf`, `forLibrary`, `saveProbe`)
- Modify: `apps/raven/server/src/media/mediaRepository.ts` (`MediaRow`, `toItem`)
- Test: `apps/raven/server/src/db/database.test.ts`, `apps/raven/server/src/media/mediaIndex.test.ts`, `apps/raven/server/src/media/mediaRepository.test.ts`

**Interfaces:**
- Consumes: `PROBE_VERSION`, `ProbeResult` (Task 2), `isHdr`, `isHdrFormat`, `isDvFallback` (Task 1), `probeResult` (Task 2).
- Produces: `MediaFile.hdrFormat: HdrFormat | null` (replaces `hdr`); the media row columns `hdr_format`, `dv_profile`, `dv_level`, `dv_fallback`, `video_profile`, `video_level`, `color_transfer`, `color_primaries`, `probe_version`.

- [ ] **Step 1: Write the failing tests**

In `database.test.ts`:

```ts
  it('keeps a probed file HDR until the scan probes it again, and marks it for that', () => {
    const previous = MIGRATIONS.length - 1
    const before = new Sqlite(join(state.dir, 'raven.db'))
    MIGRATIONS.slice(0, previous).forEach((sql) => before.exec(sql))
    before.pragma(`user_version = ${previous}`)
    before.exec("INSERT INTO libraries (name, created_at) VALUES ('Films', '2026-01-01T00:00:00.000Z')")
    const insert = before.prepare(
      `INSERT INTO media (library_id, path, file_name, folder, title, container, size, mtime_ms,
                          probed, probe_error, hdr, added_at)
       VALUES (1, ?, ?, '', ?, 'mkv', 1, 1, ?, ?, ?, '2026-01-01T00:00:00.000Z')`,
    )
    insert.run('/m/hdr.mkv', 'hdr.mkv', 'hdr', 1, null, 1)
    insert.run('/m/sdr.mkv', 'sdr.mkv', 'sdr', 1, null, 0)
    insert.run('/m/new.mkv', 'new.mkv', 'new', 0, null, 0)
    insert.run('/m/broken.mkv', 'broken.mkv', 'broken', 1, 'No audio or video streams', 0)
    before.close()

    const database = new DatabaseService({ ...readServerConfig({}), dataDir: state.dir })
    expect(
      database.db.prepare('SELECT title, hdr_format, probe_version FROM media ORDER BY id').all(),
    ).toEqual([
      { title: 'hdr', hdr_format: 'hdr10', probe_version: 0 },
      { title: 'sdr', hdr_format: 'sdr', probe_version: 0 },
      { title: 'new', hdr_format: null, probe_version: 0 },
      { title: 'broken', hdr_format: null, probe_version: 0 },
    ])
    database.onModuleDestroy()
  })
```

In `mediaIndex.test.ts`, replace the `PROBE` constant with `const PROBE = probeResult({ hdrFormat: 'hdr10' })` (import `probeResult` from `@/test/probes`), give the `TRACKS` audio track `profile: 'LC', layout: 'stereo', bitrate: 192_000`, change `hdr: true` in the `fileOf` expectation to `hdrFormat: 'hdr10'`, and add:

```ts
  it('counts a file probed by an older probe as not probed, so the scan probes it once more', () => {
    const old = add('old')
    index().saveProbe({ id: old, probe: PROBE, tracks: TRACKS })
    database.get().db.prepare('UPDATE media SET probe_version = 0 WHERE id = ?').run(old)
    const current = add('current')
    index().saveProbe({ id: current, probe: PROBE, tracks: TRACKS })
    expect(['old', 'current'].map(probed)).toEqual([false, true])
  })

  it('leaves a ready thumbnail alone when it probes a file again', () => {
    const id = add('thumbnailed')
    index().saveProbe({ id, probe: PROBE, tracks: TRACKS })
    index().setThumbnail({ id, state: 'ready' })
    index().saveProbe({ id, probe: PROBE, tracks: TRACKS })
    expect(index().fileOf(id)?.thumbnail).toBe('ready')
  })
```

In `mediaRepository.test.ts`, import `probeResult` from `@/test/probes`, replace its `PROBE` constant with `const PROBE = probeResult()` (its values match the fixture's), and add a `describe` of its own, with its own database so the sort tests' listings stay as they are:

```ts
describe("a video's probe in its listing", () => {
  const database = testDatabase('raven-media-probe-')

  beforeAll(async () => {
    await database.open()
  })

  afterAll(database.close)

  it("hands a client the probe's HDR format and codec details", () => {
    const index = new MediaIndex(database.get())
    const libraryId = new LibrariesRepository(database.get()).create({
      name: 'Films',
      paths: ['/m'],
    }).id
    const id = index.insert({
      libraryId,
      kind: 'other',
      file: { path: '/m/dv.mkv', root: '/m', size: 1, mtimeMs: 1 },
    })
    index.saveProbe({
      id,
      probe: probeResult({
        videoCodec: 'hevc',
        hdrFormat: 'dolbyVision',
        dvProfile: 8,
        dvLevel: 6,
        dvFallback: 'hdr10',
        videoProfile: 'Main 10',
        videoLevel: 153,
        colorTransfer: 'smpte2084',
        colorPrimaries: 'bt2020',
      }),
      tracks: TRACKS,
    })
    expect(repositories(database.get()).media.get(id)).toMatchObject({
      hdrFormat: 'dolbyVision',
      dvProfile: 8,
      dvLevel: 6,
      dvFallback: 'hdr10',
      videoProfile: 'Main 10',
      videoLevel: 153,
      colorTransfer: 'smpte2084',
      colorPrimaries: 'bt2020',
    })
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `bunx nx run @raven/server:test -- src/db src/media`
Expected: FAIL (no `hdr_format` column; `hdrFormat` missing from `MediaFile` and `MediaItem` rows).

- [ ] **Step 3: The migration**

Append to `MIGRATIONS` in `database.ts`:

```ts
  // Probes tell HDR formats apart and keep what a client needs to name a
  // file's codec exactly. A file probed before keeps its old HDR flag as a
  // guess until the next scan probes it again, which probe_version 0 marks.
  // hdr stays, still written, so an older image can read the table.
  `
  ALTER TABLE media ADD COLUMN hdr_format TEXT;
  ALTER TABLE media ADD COLUMN dv_profile INTEGER;
  ALTER TABLE media ADD COLUMN dv_level INTEGER;
  ALTER TABLE media ADD COLUMN dv_fallback TEXT;
  ALTER TABLE media ADD COLUMN video_profile TEXT;
  ALTER TABLE media ADD COLUMN video_level INTEGER;
  ALTER TABLE media ADD COLUMN color_transfer TEXT;
  ALTER TABLE media ADD COLUMN color_primaries TEXT;
  ALTER TABLE media ADD COLUMN probe_version INTEGER NOT NULL DEFAULT 0;
  UPDATE media SET hdr_format = CASE hdr WHEN 1 THEN 'hdr10' ELSE 'sdr' END
   WHERE probed = 1 AND probe_error IS NULL;
  `,
```

- [ ] **Step 4: The index**

In `mediaIndex.ts`:

- Imports: `isDvFallback`, `isHdr`, `isHdrFormat`, `type HdrFormat` from `@raven/core`; `PROBE_VERSION` beside `ProbeResult` from `@/ffmpeg/probe`.
- `MediaFile`: `hdr: boolean` becomes `hdrFormat: HdrFormat | null`.
- `FileRow`: `hdr: number` becomes `hdr_format: string | null`.
- `fileOf`: select `hdr_format` instead of `hdr`, and map `hdrFormat: isHdrFormat(row.hdr_format) ? row.hdr_format : null`.
- `forLibrary`: the doc comment gains "or by an older probe", and the query becomes:

```ts
      .prepare<
        [number, number],
        { id: number; path: string; size: number; mtime_ms: number; probed: number }
      >(
        `SELECT id, path, size, mtime_ms,
                probed = 1 AND (probe_error IS NOT NULL
                                OR (tracks IS NOT NULL AND probe_version >= ?)) AS probed
           FROM media WHERE library_id = ?`,
      )
      .all(PROBE_VERSION, libraryId)
```

- `saveProbe`:

```ts
  /** What a probe found, and the tracks it found. */
  saveProbe({ id, probe, tracks }: { id: number; probe: ProbeResult; tracks: MediaTracks }): void {
    this.db
      .prepare(
        `UPDATE media SET probed = 1, probe_error = NULL, duration = ?, width = ?, height = ?,
                video_codec = ?, video_bit_depth = ?, hdr = ?, hdr_format = ?, dv_profile = ?,
                dv_level = ?, dv_fallback = ?, video_profile = ?, video_level = ?,
                color_transfer = ?, color_primaries = ?, audio_codec = ?, audio_channels = ?,
                bitrate = ?, tracks = ?, probe_version = ?
          WHERE id = ?`,
      )
      .run(
        probe.duration,
        probe.width,
        probe.height,
        probe.videoCodec,
        probe.videoBitDepth,
        isHdr(probe) ? 1 : 0,
        probe.hdrFormat,
        probe.dvProfile,
        probe.dvLevel,
        probe.dvFallback,
        probe.videoProfile,
        probe.videoLevel,
        probe.colorTransfer,
        probe.colorPrimaries,
        probe.audioCodec,
        probe.audioChannels,
        probe.bitrate,
        JSON.stringify(tracks),
        PROBE_VERSION,
        id,
      )
  }
```

- [ ] **Step 5: The listings**

In `mediaRepository.ts`, `MediaRow`: replace `hdr: number` with

```ts
  hdr_format: string | null
  dv_profile: number | null
  dv_level: number | null
  dv_fallback: string | null
  video_profile: string | null
  video_level: number | null
  color_transfer: string | null
  color_primaries: string | null
```

(`SELECT m.*` already reads them.) In `toItem`, replace `hdr: row.hdr === 1,` with

```ts
  hdrFormat: isHdrFormat(row.hdr_format) ? row.hdr_format : null,
  dvProfile: row.dv_profile,
  dvLevel: row.dv_level,
  dvFallback: isDvFallback(row.dv_fallback) ? row.dv_fallback : null,
  videoProfile: row.video_profile,
  videoLevel: row.video_level,
  colorTransfer: row.color_transfer,
  colorPrimaries: row.color_primaries,
```

importing `isDvFallback` and `isHdrFormat` from `@raven/core`.

- [ ] **Step 6: Run them to see them pass**

Run: `bunx nx run @raven/server:test -- src/db src/media`
Expected: PASS. Other server test files may still fail to compile on `hdr`; Task 5 finishes them.

- [ ] **Step 7: Commit**

```bash
git add apps/raven/server/src/db apps/raven/server/src/media
git commit -m "MAE: raven stores the HDR format and codec details, and re-probes older files once" -m "- one migration adds the columns and \`probe_version\`; a probed HDR file keeps its badge until then
- the scan counts a file probed by an older probe as unprobed
- listings hand clients the new fields"
```

---

### Task 5: The server reads `isHdr`, and a first play refreshes a stale probe

**Files:**
- Modify: `apps/raven/server/src/thumbnails/thumbnailService.ts:100`
- Modify: `apps/raven/server/src/playback/playbackController.ts:109`
- Modify: `apps/raven/server/src/playback/tracksService.ts` (`embedded`, near line 75)
- Modify: `apps/raven/server/src/media/mediaIndex.ts` (delete `saveTracks` once unused)
- Modify: the remaining server tests that set `hdr`: `playback/tracksService.test.ts`, `media/viewingRepository.test.ts`, `media/sagas.test.ts`, `media/movieSplits.test.ts`
- Test: `apps/raven/server/src/playback/tracksService.test.ts`

**Interfaces:**
- Consumes: `isHdr` (Task 1), `MediaFile.hdrFormat`, `saveProbe` (Task 4), `probeFile` (Task 3), `probeResult` (Task 2).
- Produces: `TracksService.tracksFor` unchanged in shape; when the stored tracks are missing or stale it now runs `probeFile` and `saveProbe`, so the row's probe fields refresh too.

- [ ] **Step 1: Write the failing test**

In `tracksService.test.ts`, replace `PROBE` with `const PROBE = probeResult({ duration: 6, width: 320, height: 240, bitrate: 500_000 })`, add `profile: null, layout: 'stereo', bitrate: null` to the stored audio track in the first test, and add:

```ts
  it('probes a video again on its first play when its stored tracks predate audio profiles, and refreshes its row', async () => {
    const id = add({ name: 'Fourth.mp4', mtimeMs: 4 })
    index().saveProbe({ id, probe: PROBE, tracks: { audio: [], subtitles: [], defaultAudio: null, frameRate: 24 } })
    const stale = { index: 0, codec: 'aac', channels: 2, language: null, title: null, default: true }
    database
      .get()
      .db.prepare('UPDATE media SET tracks = ?, hdr_format = NULL, probe_version = 0 WHERE id = ?')
      .run(JSON.stringify({ audio: [stale], subtitles: [], defaultAudio: 0, frameRate: 24 }), id)

    const resolved = await tracksWith(readServerConfig({}).ffprobePath).tracksFor(fileOf(id))

    expect(resolved.tracks.audio[0]).toMatchObject({ codec: 'aac', layout: expect.any(String) })
    expect(index().storedTracks(id)?.audio[0]?.layout).toEqual(expect.any(String))
    expect(fileOf(id).hdrFormat).toBe('sdr')
  })
```

In `beforeAll`, after the `Third.mp4` line, encode the clip this test owns:

```ts
    await encodeClip({ path: join(state.media, 'Fourth.mp4'), seconds: 2 })
```

- [ ] **Step 2: Run it to see it fail**

Run: `bunx nx run @raven/server:test -- src/playback/tracksService.test.ts`
Expected: FAIL. `hdrFormat` stays `null`, because the re-probe saves only tracks.

- [ ] **Step 3: Re-probe the whole file**

In `tracksService.ts`, replace `embedded` with:

```ts
  /**
   * The stored tracks, or a probe's. A file the scan has not reached, or
   * one probed before tracks had their current shape, is probed in full
   * here, so its row learns what the scan would have stored.
   */
  private async embedded(file: MediaFile): Promise<MediaTracks> {
    const stored = this.index.storedTracks(file.id)
    if (stored) return stored
    const { probe, tracks } = await this.ffmpeg.probeFile(file.path)
    this.index.saveProbe({ id: file.id, probe, tracks })
    return tracks
  }
```

If `parseTracks` and `saveTracks` are now unused in `tracksService.ts` and `mediaIndex.ts` (check with `grep -rn "saveTracks\|parseTracks" apps/raven/server/src`), delete `saveTracks` from `MediaIndex` and the unused import.

- [ ] **Step 4: Read `isHdr`**

`thumbnailService.ts:100`:

```ts
    const tonemap = isHdr(file) && (await this.ffmpeg.canTonemap())
```

`playbackController.ts:109`:

```ts
      mode === 'transcode' && isHdr(file) && playback.tonemap && (await this.ffmpeg.canTonemap())
```

Both import `isHdr` from `@raven/core`.

- [ ] **Step 5: The remaining fixtures**

In `viewingRepository.test.ts`, `sagas.test.ts` and `movieSplits.test.ts`, replace each hand-written probe constant with `probeResult({ ... })`, passing only the fields that differ from the fixture, and add `profile: null, layout: null, bitrate: null` to any audio track literal. Any `MediaFile` literal's `hdr: false` becomes `hdrFormat: 'sdr'`.

- [ ] **Step 6: Run the server's checks**

Run: `bunx nx run @raven/server:test` and `bunx nx run @raven/server:typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/raven/server
git commit -m "MAE: raven's first play probes a stale file in full, and tone mapping reads \`isHdr\`" -m "- tracks stored before audio profiles fail their guard, so the play probes again and refreshes the row
- thumbnails and transcodes tone map the same files as before
- server test probes come from one \`probeResult\` fixture"
```

---

### Task 6: The web app's badges

**Files:**
- Modify: `apps/raven/web/src/components/MediaCard/MediaCard.tsx:48`
- Modify: `apps/raven/web/src/components/MediaTiles/MediaTiles.tsx:55`
- Modify: `apps/raven/web/src/lib/itemFacts.ts:120` and `:152`
- Modify: `apps/raven/web/src/test/fixtures.ts`, `apps/raven/web/src/pages/DesignPage/samples.ts`
- Modify: audio track literals in `components/Player/selection.test.ts`, `components/Player/Player.test.tsx`, `pages/MoviePage/MoviePage.test.tsx`
- Test: `apps/raven/web/src/lib/itemFacts.test.ts`

**Interfaces:**
- Consumes: `isHdr`, the new `MediaItem` and `AudioTrack` fields (Task 1).

- [ ] **Step 1: Write the failing test**

In `itemFacts.test.ts`, the "names a file's resolution, HDR, codec and size" test's `hdr: true` becomes `hdrFormat: 'dolbyVision', dvProfile: 5, dvFallback: null`; its expectation still includes `'HDR'`. Add:

```ts
  it('calls HLG and HDR10+ HDR too, and an unprobed file nothing', () => {
    expect(versionFacts(mediaItem({ hdrFormat: 'hlg' }))).toContain('HDR')
    expect(versionFacts(mediaItem({ hdrFormat: 'hdr10plus' }))).toContain('HDR')
    expect(versionFacts(mediaItem({ hdrFormat: null }))).not.toContain('HDR')
  })
```

- [ ] **Step 2: Run it to see it fail**

Run: `bunx nx run @raven/web:test -- src/lib/itemFacts.test.ts`
Expected: FAIL (`media.hdr` is undefined now, so no `'HDR'`).

- [ ] **Step 3: Read `isHdr`**

In all four places, `media.hdr ? 'HDR' : null` becomes `isHdr(media) ? 'HDR' : null`, importing `isHdr` from `@raven/core`.

- [ ] **Step 4: The fixtures**

`test/fixtures.ts`, `mediaItem` (an HEVC 10-bit SDR file): replace `hdr: false,` with

```ts
  hdrFormat: 'sdr',
  dvProfile: null,
  dvLevel: null,
  dvFallback: null,
  videoProfile: 'Main 10',
  videoLevel: 120,
  colorTransfer: 'bt709',
  colorPrimaries: 'bt709',
```

`pages/DesignPage/samples.ts`: in `sample`, the same eight fields in place of `hdr: false` (with `videoProfile: 'Main 10'`, `videoLevel: 120`); in `FEATURED_SAMPLE`, `hdr: true` becomes `hdrFormat: 'hdr10', colorTransfer: 'smpte2084', colorPrimaries: 'bt2020', videoLevel: 153`. Every audio track literal in `selection.test.ts`, `Player.test.tsx` and `MoviePage.test.tsx` gains `profile: null, layout: null, bitrate: null`.

- [ ] **Step 5: Run the web app's checks**

Run: `bunx nx run @raven/web:test` and `bunx nx run @raven/web:typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/raven/web
git commit -m "MAE: raven web's HDR badges read the probed HDR format" -m "- cards, tiles and item facts call \`isHdr\`
- fixtures and samples carry the new fields"
```

---

### Task 7: Verify

- [ ] **Step 1: The whole repo**

Run: `bun run verify`
Expected: every target passes, including `spellcheck` (add any new word such as `dovi` or `tonemap` to the spellcheck dictionary the target names if it complains).

- [ ] **Step 2: A real library**

With `bun run dev:raven`, add a library holding at least an HDR10 file, a Dolby Vision profile 5 file and an SDR file (the M2, M4 and M1 files from the desktop spec's test media table, if found). After the scan:

```bash
sqlite3 <DATA_DIR>/raven.db "SELECT file_name, hdr_format, dv_profile, dv_fallback, video_profile, video_level, color_transfer, probe_version FROM media"
```

Expected: `hdr10`, `dolbyVision` with profile 5 and a NULL fallback, `sdr`; `probe_version` 1 on all. The cards show `HDR` on the first two only.

- [ ] **Step 3: An upgraded database**

Copy a pre-S1 `raven.db` (from a `main` checkout's data folder, never Vhagar's live one) into a scratch `DATA_DIR`, start the server on it, and check that the HDR badges show before any scan, and that one scan sets `probe_version` to 1 on every row without changing any `thumbnail` that was `ready`.

- [ ] **Step 4: Open the PR**

Follow the `pr-format` skill: `MAE:` title, What / Why / Testing by Nx project. Mention the deviations above under Why.
