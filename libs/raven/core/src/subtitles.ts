import { SUBTITLE_SOURCES, type SubtitleCue, type SubtitleTrack } from '@/contract'

/**
 * A picture of text inside the file (Blu-ray PGS, VobSub, DVD): no text for a player to draw, so
 * a stream burns it into the picture, and only the file's own player draws it as it is.
 */
export const isPictureSubtitle = (track: SubtitleTrack | null): track is SubtitleTrack =>
  track !== null && !track.supported && track.source === SUBTITLE_SOURCES.embedded

/**
 * Embedded subtitles are extracted a window at a time. They are interleaved
 * through the whole file, so a full track means reading every byte of it;
 * a window reads only its own stretch. Five minutes keeps the first one
 * quick even on a remux over SMB.
 */
const SUBTITLE_WINDOW_SECONDS = 300

/** Each window starts this much early, so a cue straddling the boundary is not lost. */
const SUBTITLE_WINDOW_LEAD = 10

/** The next window is fetched this long before playback reaches it. */
const PREFETCH_SECONDS = 60

/** The stretch of the file window `window` covers, as the server reads it. */
export const subtitleWindowRange = (window: number): { start: number; duration: number } => {
  const from = window * SUBTITLE_WINDOW_SECONDS
  const start = Math.max(0, from - SUBTITLE_WINDOW_LEAD)
  return { start, duration: from + SUBTITLE_WINDOW_SECONDS - start }
}

export const subtitleWindowOf = (time: number): number =>
  Math.max(0, Math.floor(time / SUBTITLE_WINDOW_SECONDS))

type SubtitleWindowsProps = {
  time: number
  duration: number | null
}

/** The windows playback needs at `time`: its own, plus the next once it is close. */
export const subtitleWindows = ({ time, duration }: SubtitleWindowsProps): number[] => {
  const current = subtitleWindowOf(time)
  const nextStart = (current + 1) * SUBTITLE_WINDOW_SECONDS
  const close = time >= nextStart - PREFETCH_SECONDS
  const exists = duration == null || nextStart < duration
  return close && exists ? [current, current + 1] : [current]
}

/** "01:02:03.456", "02:03.456" or SRT's "01:02:03,456", in seconds. */
const parseTimestamp = (stamp: string): number => {
  const parts = stamp.replace(',', '.').split(':').map(Number)
  return parts.reduce((total, part) => total * 60 + part, 0)
}

const TIMING = /^\s*((?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3})\s+-->\s+((?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3})/

const toCue = (block: string): SubtitleCue | null => {
  const lines = block.split('\n')
  const timingAt = lines.findIndex((line) => line.includes('-->'))
  // A cue's timing is its first line, or its second after an identifier.
  if (timingAt < 0 || timingAt > 1) return null
  const match = TIMING.exec(lines[timingAt] ?? '')
  if (!match?.[1] || !match[2]) return null
  const start = parseTimestamp(match[1])
  const end = parseTimestamp(match[2])
  const text = lines
    .slice(timingAt + 1)
    .join('\n')
    .trim()
  return text !== '' && end > start ? { start, end, text } : null
}

/**
 * The cues of a WebVTT document, in start order. Header, NOTE, STYLE and
 * REGION blocks are skipped, as are cue settings after the timing.
 */
export const parseWebVtt = (text: string): SubtitleCue[] =>
  text
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n/)
    .filter((block) => !/^\s*(?:WEBVTT|NOTE|STYLE|REGION)\b/.test(block))
    .map(toCue)
    .filter((cue): cue is SubtitleCue => cue != null)
    .toSorted((a, b) => a.start - b.start || a.end - b.end)

/** Seconds as "HH:MM:SS.mmm", the way WebVTT writes a time; a time that is not a finite number is 0. */
const formatTimestamp = (seconds: number): string => {
  const total = Number.isFinite(seconds) ? Math.round(Math.max(0, seconds) * 1000) : 0
  const [hours, minutes, secs] = [
    Math.floor(total / 3_600_000),
    Math.floor(total / 60_000) % 60,
    Math.floor(total / 1000) % 60,
  ].map((part) => String(part).padStart(2, '0'))
  return `${hours}:${minutes}:${secs}.${String(total % 1000).padStart(3, '0')}`
}

type FormatWebVttProps = {
  cues: readonly SubtitleCue[]
  timestampMap: { mpegts: number; local: number } | null
}

/**
 * Cues as a WebVTT document, the inverse of `parseWebVtt` for what it keeps.
 * `timestampMap` ties the cues' local clock to the 90 kHz MPEG-TS clock an
 * HLS player runs on, so a segment of cues lines up with the video.
 */
export const formatWebVtt = ({ cues, timestampMap }: FormatWebVttProps): string => {
  const header =
    timestampMap === null
      ? ['WEBVTT']
      : [
          'WEBVTT',
          `X-TIMESTAMP-MAP=MPEGTS:${Math.round(timestampMap.mpegts)},LOCAL:${formatTimestamp(timestampMap.local)}`,
        ]
  const blocks = cues.map(
    (cue) => `${formatTimestamp(cue.start)} --> ${formatTimestamp(cue.end)}\n${cue.text}`,
  )
  return `${[header.join('\n'), ...blocks].join('\n\n')}\n\n`
}

const cueKey = (cue: SubtitleCue): string => `${cue.start}|${cue.end}|${cue.text}`

type MergeCuesProps = {
  existing: readonly SubtitleCue[]
  incoming: readonly SubtitleCue[]
}

/** Two windows overlap by their lead, so the same cue can arrive twice. */
export const mergeCues = ({ existing, incoming }: MergeCuesProps): SubtitleCue[] => {
  const seen = new Set(existing.map(cueKey))
  const fresh = incoming.filter((cue) => !seen.has(cueKey(cue)))
  return fresh.length === 0
    ? [...existing]
    : [...existing, ...fresh].toSorted((a, b) => a.start - b.start || a.end - b.end)
}

type ActiveCuesProps = {
  cues: readonly SubtitleCue[]
  time: number
}

/** Every cue showing at `time`, oldest first, as a viewer reads them top to bottom. */
export const activeCues = ({ cues, time }: ActiveCuesProps): SubtitleCue[] =>
  cues.filter((cue) => cue.start <= time && time < cue.end)

/** A stretch of cue text with one style. Line breaks stay in `text` as `\n`. */
export type CueRun = {
  text: string
  italic: boolean
  bold: boolean
  underline: boolean
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
  '&lrm;': '‎',
  '&rlm;': '‏',
}

const decodeEntities = (text: string): string =>
  text.replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp|lrm|rlm);/g, (entity) => ENTITIES[entity] ?? '')

type Styles = { italic: number; bold: number; underline: number }

const STYLE_OF: Record<string, keyof Styles> = { i: 'italic', b: 'bold', u: 'underline' }

/** `<i>`, `<i.yellow>` and `</i>` all name `i`; voice and class tags name `v` and `c`. */
const tagName = (tag: string): string => /^<\/?([a-z]+)/i.exec(tag)?.[1]?.toLowerCase() ?? ''

/**
 * Splits cue text into styled runs. Italic, bold and underline survive;
 * every other tag (voices, classes, karaoke timestamps) and any ASS
 * override block that slipped through conversion is dropped.
 */
export const cueRuns = (text: string): CueRun[] => {
  const tokens = text.replace(/\{\\[^}]*\}/g, '').split(/(<[^>]*>)/)
  const { runs } = tokens.reduce<{ runs: CueRun[]; styles: Styles }>(
    ({ runs: done, styles }, token) => {
      if (token.startsWith('<')) {
        const style = STYLE_OF[tagName(token)]
        if (!style) return { runs: done, styles }
        const step = token.startsWith('</') ? -1 : 1
        return { runs: done, styles: { ...styles, [style]: Math.max(0, styles[style] + step) } }
      }
      if (token === '') return { runs: done, styles }
      const run: CueRun = {
        text: decodeEntities(token),
        italic: styles.italic > 0,
        bold: styles.bold > 0,
        underline: styles.underline > 0,
      }
      const last = done.at(-1)
      const sameStyle =
        !!last &&
        last.italic === run.italic &&
        last.bold === run.bold &&
        last.underline === run.underline
      return {
        runs: sameStyle
          ? [...done.slice(0, -1), { ...last, text: last.text + run.text }]
          : [...done, run],
        styles,
      }
    },
    { runs: [], styles: { italic: 0, bold: 0, underline: 0 } },
  )
  return runs
}
