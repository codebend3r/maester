import { type QueryStatus, type UseQueryResult, useQuery } from '@tanstack/react-query'
import { LYRICS_KINDS, type LyricLine, type Lyrics } from '@raven/core'
import { activeLineAt, useAudioQueue } from '@raven/ui/headless'
import type { ComponentType } from 'react'
import { lyricsQuery } from '@/lib/queries'
import { NOW_PLAYING_COPY } from '@/pages/NowPlayingPage/copy'
import styles from '@/pages/NowPlayingPage/LyricsPanel.module.scss'

/**
 * Scrolls the lines' box to put `line` in its middle, as the line becomes
 * the one sung. Stable, so it runs only when a line takes or leaves it.
 */
const scrollToMiddle = (line: HTMLLIElement | null): void => {
  if (line === null) return
  const box = line.parentElement
  if (box === null) return
  box.scrollTo({ top: line.offsetTop - (box.clientHeight - line.clientHeight) / 2 })
}

type SyncedLinesProps = { lines: readonly LyricLine[] }

/**
 * Lines timed to the music: the one being sung is marked, and the box
 * scrolls to keep it in the middle. Smoothly, unless motion is turned down.
 */
const SyncedLines = ({ lines }: SyncedLinesProps) => {
  const active = useAudioQueue((store) => activeLineAt({ lines, at: store.position }))
  return (
    <ol className={styles.synced} aria-label={NOW_PLAYING_COPY.lyrics}>
      {lines.map((line, index) => (
        <li
          // A song repeats lines, so a line is known by its time and words.
          key={`${line.at}-${line.text}`}
          className={index === active ? `${styles.line} ${styles.active}` : styles.line}
          aria-current={index === active ? 'true' : undefined}
          ref={index === active ? scrollToMiddle : undefined}
        >
          {line.text === '' ? NOW_PLAYING_COPY.instrumental : line.text}
        </li>
      ))}
    </ol>
  )
}

type LyricsBodyProps = { lyrics: Lyrics }

type SyncedLyricsProps = LyricsBodyProps

const SyncedLyrics = ({ lyrics }: SyncedLyricsProps) =>
  lyrics.kind === LYRICS_KINDS.synced && <SyncedLines lines={lyrics.lines} />

type PlainLyricsProps = LyricsBodyProps

const PlainLyrics = ({ lyrics }: PlainLyricsProps) =>
  lyrics.kind === LYRICS_KINDS.plain && (
    // A scrolling region a keyboard can reach.
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
    <section className={styles.plain} tabIndex={0} aria-label={NOW_PLAYING_COPY.lyrics}>
      {lyrics.text}
    </section>
  )

const NoLyrics = () => <p className={styles.quiet}>{NOW_PLAYING_COPY.noLyrics}</p>

/** The lyrics as they came: timed lines, text that scrolls, or a quiet word that there are none. */
const LYRICS_BODIES = {
  [LYRICS_KINDS.synced]: SyncedLyrics,
  [LYRICS_KINDS.plain]: PlainLyrics,
  [LYRICS_KINDS.none]: NoLyrics,
} as const satisfies Record<Lyrics['kind'], ComponentType<LyricsBodyProps>>

const LyricsBody = ({ lyrics }: LyricsBodyProps) => {
  const Body: ComponentType<LyricsBodyProps> = LYRICS_BODIES[lyrics.kind]
  return <Body lyrics={lyrics} />
}

/** What TanStack Query says of the lyrics' read. */
const QUERY_STATUSES = {
  pending: 'pending',
  error: 'error',
  success: 'success',
} as const satisfies Record<QueryStatus, QueryStatus>

type LyricsReadProps = { query: UseQueryResult<Lyrics> }

const FindingLyrics = () => <p className={styles.quiet}>{NOW_PLAYING_COPY.findingLyrics}</p>

const LyricsFailed = () => <p className={styles.quiet}>{NOW_PLAYING_COPY.lyricsFailed}</p>

type LyricsReadyProps = LyricsReadProps

const LyricsReady = ({ query }: LyricsReadyProps) =>
  query.isSuccess && <LyricsBody lyrics={query.data} />

const LYRICS_READS = {
  [QUERY_STATUSES.pending]: FindingLyrics,
  [QUERY_STATUSES.error]: LyricsFailed,
  [QUERY_STATUSES.success]: LyricsReady,
} as const satisfies Record<QueryStatus, ComponentType<LyricsReadProps>>

type LyricsPanelProps = { trackId: number }

/** The playing track's lyrics, from its tags, a sidecar `.lrc` or LRCLIB, as the server finds them. */
export const LyricsPanel = ({ trackId }: LyricsPanelProps) => {
  const lyrics = useQuery(lyricsQuery(trackId))
  const Read: ComponentType<LyricsReadProps> = LYRICS_READS[lyrics.status]
  return <Read query={lyrics} />
}
