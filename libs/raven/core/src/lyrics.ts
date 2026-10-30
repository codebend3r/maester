import {
  LYRICS_KINDS,
  type LyricLine,
  type Lyrics,
  type LyricsSource,
  NO_LYRICS,
} from '@/contract/lyrics'

/** A line's time stamps, `[mm:ss]`, `[mm:ss.xx]` or `[mm:ss:xx]`, one or more at its start. */
const LEADING_STAMPS = /^(?:\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]\s*)+/u

const STAMP = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/gu

/** `[offset:+250]`: how many milliseconds sooner every line shows. */
const OFFSET = /^\[offset:\s*([+-]?\d+)\s*\]$/imu

/** An enhanced LRC's word timing inside a line, `<mm:ss.xx>`, which a line shows without. */
const WORD_STAMP = /<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/gu

type SecondsOfProps = { minutes: string; seconds: string; fraction: string | undefined }

const secondsOf = ({ minutes, seconds, fraction }: SecondsOfProps): number =>
  Number(minutes) * 60 + Number(seconds) + (fraction === undefined ? 0 : Number(`0.${fraction}`))

/** Seconds rounded to the millisecond, so a sum of offsets reads as the stamp did. */
const toMilliseconds = (seconds: number): number => Math.round(seconds * 1000) / 1000

type LinesOfProps = { line: string; shift: number }

/** The timed lines one line of the file holds: one per stamp it opens with, none for a tag or an untimed line. */
const linesOf = ({ line, shift }: LinesOfProps): LyricLine[] => {
  const stamps = LEADING_STAMPS.exec(line)?.[0] ?? null
  if (stamps === null) return []
  const text = line.slice(stamps.length).replace(WORD_STAMP, '').trim()
  return [...stamps.matchAll(STAMP)].map(([, minutes = '0', seconds = '0', fraction]) => ({
    at: toMilliseconds(Math.max(0, secondsOf({ minutes, seconds, fraction }) - shift)),
    text,
  }))
}

/**
 * The timed lines of an LRC file, in time order: each line's stamps, the
 * file's `[offset:]` applied, word timings dropped. Tags such as `[ar:]`
 * and lines with no stamp are left out, so text with no stamps at all
 * gives none.
 */
export const parseLrc = (text: string): LyricLine[] => {
  const offset = OFFSET.exec(text)?.[1] ?? null
  const shift = offset === null ? 0 : Number(offset) / 1000
  return text
    .split(/\r\n|\r|\n/u)
    .flatMap((line) => linesOf({ line: line.trim(), shift }))
    .toSorted((a, b) => a.at - b.at)
}

type LyricsOfTextProps = { text: string; source: LyricsSource }

/** Lyrics as a tag or a file holds them: synced when its lines carry LRC stamps, else plain, else none. */
export const lyricsOfText = ({ text, source }: LyricsOfTextProps): Lyrics => {
  const lines = parseLrc(text)
  if (lines.length > 0) return { kind: LYRICS_KINDS.synced, source, lines }
  const plain = text.trim()
  return plain === '' ? NO_LYRICS : { kind: LYRICS_KINDS.plain, source, text: plain }
}
