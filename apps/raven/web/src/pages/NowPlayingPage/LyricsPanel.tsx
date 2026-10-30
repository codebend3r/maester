import { useQuery } from '@tanstack/react-query'
import { LYRICS_KINDS, type LyricLine, type Lyrics } from '@raven/core'
import { activeLineAt, useAudioQueue } from '@raven/ui/headless'
import { lyricsQuery } from '@/lib/queries'
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
    <ol className={styles.synced} aria-label="Lyrics">
      {lines.map((line, index) => (
        <li
          // A song repeats lines, so a line is known by its time and words.
          key={`${line.at}-${line.text}`}
          className={index === active ? `${styles.line} ${styles.active}` : styles.line}
          aria-current={index === active ? 'true' : undefined}
          ref={index === active ? scrollToMiddle : undefined}
        >
          {line.text === '' ? '♪' : line.text}
        </li>
      ))}
    </ol>
  )
}

type LyricsBodyProps = { lyrics: Lyrics }

/** The lyrics as they came: timed lines, text that scrolls, or a quiet word that there are none. */
const LyricsBody = ({ lyrics }: LyricsBodyProps) => {
  switch (lyrics.kind) {
    case LYRICS_KINDS.synced:
      return <SyncedLines lines={lyrics.lines} />
    case LYRICS_KINDS.plain:
      return (
        // A scrolling region a keyboard can reach.
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        <section className={styles.plain} tabIndex={0} aria-label="Lyrics">
          {lyrics.text}
        </section>
      )
    case LYRICS_KINDS.none:
      return <p className={styles.quiet}>No lyrics for this track.</p>
    default: {
      const unknown: never = lyrics
      return unknown
    }
  }
}

type LyricsPanelProps = { trackId: number }

/** The playing track's lyrics, from its tags, a sidecar `.lrc` or LRCLIB, as the server finds them. */
export const LyricsPanel = ({ trackId }: LyricsPanelProps) => {
  const lyrics = useQuery(lyricsQuery(trackId))
  if (lyrics.isPending) return <p className={styles.quiet}>Looking for lyrics…</p>
  if (lyrics.isError) return <p className={styles.quiet}>Could not read the lyrics.</p>
  return <LyricsBody lyrics={lyrics.data} />
}
