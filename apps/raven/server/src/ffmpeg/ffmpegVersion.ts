/** The release in a tool's `-version` line: `6.1.1-3ubuntu5` from `ffmpeg version 6.1.1-3ubuntu5 Copyright ...`. */
const releaseOf = (line: string | null): string | null =>
  /^\S+ version (\S+)/.exec(line ?? '')?.[1] ?? null

type ToolMismatchProps = {
  ffmpeg: string | null
  ffprobe: string | null
}

/** What to warn of when ffmpeg and ffprobe are different builds, or null when they match or one is missing. */
export const toolMismatch = ({ ffmpeg, ffprobe }: ToolMismatchProps): string | null => {
  const [ffmpegRelease, ffprobeRelease] = [releaseOf(ffmpeg), releaseOf(ffprobe)]
  if (ffmpegRelease == null || ffprobeRelease == null || ffmpegRelease === ffprobeRelease) {
    return null
  }
  return `ffmpeg is ${ffmpegRelease} and ffprobe is ${ffprobeRelease}; HLS transcodes seek by ffprobe's reading of a file's start, so use the same build of both`
}

/**
 * How the segment muxer reads `-segment_times`. From FFmpeg 6.0 it adds the
 * run's first video pts to each, so they are offsets from the run's start;
 * before, as in Debian 12's 5.1 that the server image ships, they are output
 * timestamps.
 */
export const SEGMENT_CLOCKS = { run: 'run', output: 'output' } as const

type SegmentClock = (typeof SEGMENT_CLOCKS)[keyof typeof SEGMENT_CLOCKS]

/**
 * How `-enc_time_base` names the demuxer's time base: `demux` from FFmpeg
 * 6.1, `-1` before it. 6.0 refuses `demux`, and 9.0 refuses `-1`.
 */
export const DEMUX_TIME_BASES = { named: 'demux', numbered: '-1' } as const

type DemuxTimeBase = (typeof DEMUX_TIME_BASES)[keyof typeof DEMUX_TIME_BASES]

/** How this ffmpeg build takes the HLS run's version-dependent flags. */
export type HlsDialect = { segmentClock: SegmentClock; timeBase: DemuxTimeBase }

type Release = { major: number; minor: number }

const RUN_RELATIVE_SINCE: Release = { major: 6, minor: 0 }
const NAMED_TIME_BASE_SINCE: Release = { major: 6, minor: 1 }

type IsBeforeProps = { release: Release; since: Release }

const isBefore = ({ release, since }: IsBeforeProps): boolean =>
  release.major < since.major || (release.major === since.major && release.minor < since.minor)

/** The dialect of the ffmpeg whose `-version` line this is; a build without a release number is new. */
export const hlsDialectOf = (version: string | null): HlsDialect => {
  const match = /^ffmpeg version n?(\d+)\.(\d+)/.exec(version ?? '')
  if (!match) return { segmentClock: SEGMENT_CLOCKS.run, timeBase: DEMUX_TIME_BASES.named }
  const release = { major: Number(match[1]), minor: Number(match[2]) }
  return {
    segmentClock: isBefore({ release, since: RUN_RELATIVE_SINCE })
      ? SEGMENT_CLOCKS.output
      : SEGMENT_CLOCKS.run,
    timeBase: isBefore({ release, since: NAMED_TIME_BASE_SINCE })
      ? DEMUX_TIME_BASES.numbered
      : DEMUX_TIME_BASES.named,
  }
}
