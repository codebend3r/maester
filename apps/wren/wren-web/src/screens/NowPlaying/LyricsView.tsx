import { type LyricLine, activeLineAt } from '@raven/core'
import { useAudioQueue } from '@raven/ui/headless'
import {
  NOW_PLAYING_COPY,
  SHOWN_LYRICS_KINDS,
  type ShownLyrics,
  lyricOffsetOf,
  lyricToneOf,
} from '@raven/wren'
import { type ComponentType, useEffect, useRef } from 'react'
import { Pressable } from '@/ui/Pressable/Pressable'
import styles from '@/screens/NowPlaying/LyricsView.module.scss'

type SyncedLinesProps = { lines: readonly LyricLine[] }

/*
 * The synced lines, scrolled so the one being sung stays about a third of the way down, unless
 * a pointer holds the list; a press on a line plays from it. The stylesheet makes the scroll
 * glide only for a listener who has not asked for less motion.
 */
function SyncedLines({ lines }: SyncedLinesProps) {
  const position = useAudioQueue((store) => store.position)
  const seekTo = useAudioQueue((store) => store.seekTo)
  const scroller = useRef<HTMLUListElement>(null)
  const sung = useRef<HTMLLIElement>(null)
  const isHeld = useRef(false)
  const current = activeLineAt({ lines, at: position })
  // A song repeats lines, so each is keyed by its place and its time.
  const items = lines.map((line, place) => ({ key: `${place}:${line.at}`, place, line }))

  useEffect(() => {
    const list = scroller.current
    if (isHeld.current || list === null) return
    const lineTop = current === null ? 0 : (sung.current?.offsetTop ?? 0)
    list.scrollTo({ top: lyricOffsetOf({ lineTop, viewport: list.clientHeight }) })
  }, [current])

  const letGo = () => {
    isHeld.current = false
  }
  return (
    <ul
      className={styles.lines}
      onPointerCancel={letGo}
      onPointerDown={() => {
        isHeld.current = true
      }}
      onPointerUp={letGo}
      ref={scroller}
    >
      {items.map(({ key, place, line }) => (
        <li key={key} ref={place === current ? sung : undefined}>
          <Pressable
            className={styles[lyricToneOf({ place, current })]}
            isCurrent={place === current}
            onPress={() => seekTo(line.at)}
          >
            {line.text === '' ? NOW_PLAYING_COPY.instrumental : line.text}
          </Pressable>
        </li>
      ))}
    </ul>
  )
}

type LyricsKind = ShownLyrics['kind']

type LyricsOfProps<K extends LyricsKind> = { lyrics: ShownLyrics & { kind: K } }

function SyncedLyrics({ lyrics }: LyricsOfProps<typeof SHOWN_LYRICS_KINDS.synced>) {
  return <SyncedLines lines={lyrics.lines} />
}

/** The words as they are, with no times to follow. */
function PlainLyrics({ lyrics }: LyricsOfProps<typeof SHOWN_LYRICS_KINDS.plain>) {
  return <p className={styles.plain}>{lyrics.text}</p>
}

function NoLyrics() {
  return <p className={styles.empty}>{NOW_PLAYING_COPY.noLyrics}</p>
}

/** While the lyrics are read, the pane stays quiet. */
function ReadingLyrics() {
  return <span className={styles.reading} />
}

type LyricsViews = { [K in LyricsKind]: ComponentType<LyricsOfProps<K>> }

const LYRICS_VIEWS = {
  [SHOWN_LYRICS_KINDS.synced]: SyncedLyrics,
  [SHOWN_LYRICS_KINDS.plain]: PlainLyrics,
  [SHOWN_LYRICS_KINDS.none]: NoLyrics,
  [SHOWN_LYRICS_KINDS.reading]: ReadingLyrics,
} as const satisfies LyricsViews

// Typed as the mapped type, so a kind looks up the view that takes that kind's lyrics.
const LYRICS: LyricsViews = LYRICS_VIEWS

/** The song's words: synced lines a press plays from, plain words, that it has none, or nothing yet while they are read. */
export function LyricsView<K extends LyricsKind>({ lyrics }: LyricsOfProps<K>) {
  const Shown: ComponentType<LyricsOfProps<K>> = LYRICS[lyrics.kind]
  return <Shown lyrics={lyrics} />
}
