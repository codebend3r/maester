/** One frame of a picture pass: when it shows, its mean saturation, and the share of its pixels that are dark (0 to 100). */
export type PictureStat = { at: number; saturation: number; dark: number }

/** The lines ffmpeg's `metadata=mode=print` writes for the two statistics the score reads. */
const STAT_KEYS = {
  saturation: 'lavfi.signalstats.SATAVG',
  dark: 'lavfi.blackframe.pblack',
} as const

const FRAME_LINE = /^frame:\d+\s+pts:\S+\s+pts_time:(-?[\d.]+)/u

const STAT_LINE = /^([\w.]+)=(-?[\d.]+)$/u

type Draft = { at: number; saturation: number | null; dark: number | null }

type ParsePictureStatsProps = {
  text: string
  /** Where the pass started in the file, in seconds; ffmpeg counts each frame's time from there. */
  start: number
}

/**
 * Each frame `metadata=mode=print` reported, in seconds of the file, with
 * its saturation and darkness. A frame missing either statistic is left
 * out.
 */
export const parsePictureStats = ({ text, start }: ParsePictureStatsProps): PictureStat[] =>
  text
    .split('\n')
    .reduce<Draft[]>((frames, line) => {
      const frame = FRAME_LINE.exec(line.trim())
      if (frame) return [...frames, { at: start + Number(frame[1]), saturation: null, dark: null }]
      const stat = STAT_LINE.exec(line.trim())
      const last = frames.at(-1)
      if (stat == null || last === undefined) return frames
      const value = Number(stat[2])
      if (stat[1] === STAT_KEYS.saturation) {
        return frames.with(frames.length - 1, { ...last, saturation: value })
      }
      if (stat[1] === STAT_KEYS.dark)
        return frames.with(frames.length - 1, { ...last, dark: value })
      return frames
    }, [])
    .flatMap(({ at, saturation, dark }) =>
      saturation === null || dark === null ? [] : [{ at, saturation, dark }],
    )
