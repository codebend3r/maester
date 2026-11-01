/**
 * The scan's version. Raising it measures every track the tags left without
 * a gain again; a track measured by an older scan keeps its gain until then.
 */
export const LOUDNESS_VERSION = 1

/** Where a track stands in the loudness scan: waiting, measured, or failed. */
export const LOUDNESS_STATES = {
  pending: 'pending',
  done: 'done',
  failed: 'failed',
} as const

/** Where a track's or an album's ReplayGain came from: its tags, or raven's own scan. */
export const REPLAYGAIN_SOURCES = { tags: 'tags', scan: 'scan' } as const

/** ReplayGain 2.0's reference loudness, in LUFS. */
const REFERENCE_LUFS = -18

/** What ffmpeg's ebur128 summary says of a file: its integrated loudness in LUFS and its true peak in dBTP. */
type Measured = { integrated: number; truePeak: number }

/** A track's gain in dB and its true peak as a ratio of full scale, as ReplayGain tags carry them. */
export type TrackGain = { gain: number; peak: number }

/** One of an album's tracks, as the album's loudness reads it. */
type AlbumPart = { integrated: number; duration: number }

/** The ffmpeg run that measures a file's first audio track, printing ebur128's summary to stderr. */
export const ebur128Args = (path: string): string[] => [
  '-hide_banner',
  '-nostdin',
  '-nostats',
  '-i',
  path,
  '-map',
  '0:a:0',
  '-filter:a',
  'ebur128=peak=true:framelog=verbose',
  '-f',
  'null',
  '-',
]

const INTEGRATED = /^\s*I:\s+(\S+) LUFS\s*$/mu

const TRUE_PEAK = /^\s*Peak:\s+(\S+) dBFS\s*$/mu

/**
 * The summary ebur128 prints when its input ends; null when there is none,
 * or when it reads no finite number (a silent file's peak is `-inf`). Every
 * frame line has an `I:` too, so only what follows the last `Summary:` counts.
 */
export const parseEbur128 = (stderr: string): Measured | null => {
  const at = stderr.lastIndexOf('Summary:')
  if (at < 0) return null
  const summary = stderr.slice(at)
  const integrated = Number(INTEGRATED.exec(summary)?.[1] ?? Number.NaN)
  const truePeak = Number(TRUE_PEAK.exec(summary)?.[1] ?? Number.NaN)
  if (!Number.isFinite(integrated) || !Number.isFinite(truePeak)) return null
  return { integrated, truePeak }
}

type TrackGainOfProps = Measured

export const trackGainOf = ({ integrated, truePeak }: TrackGainOfProps): TrackGain => ({
  gain: REFERENCE_LUFS - integrated,
  peak: 10 ** (truePeak / 20),
})

/**
 * A track's integrated loudness from its gain, as `trackGainOf` made it or a
 * ReplayGain 2.0 tag says. A ReplayGain 1 tag (89 dB reference) is read as
 * RG2 too, so an album mixing the two is about 4 dB off.
 */
export const integratedOf = (gain: number): number => REFERENCE_LUFS - gain

/** The album's gain: its tracks' energy averaged by duration, brought to the reference. */
export const albumGainOf = (parts: readonly AlbumPart[]): number => {
  const { energy, seconds } = parts.reduce(
    (sum, { integrated, duration }) => ({
      energy: sum.energy + duration * 10 ** (integrated / 10),
      seconds: sum.seconds + duration,
    }),
    { energy: 0, seconds: 0 },
  )
  return REFERENCE_LUFS - 10 * Math.log10(energy / seconds)
}
