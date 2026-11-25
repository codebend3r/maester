import { classNames, useAudioQueue } from '@raven/ui/headless'
import {
  NOW_PLAYING_COPY,
  PLAYER_COPY,
  countsLineOf,
  placesToClearOf,
  upNextRowsOf,
} from '@raven/wren'
import { RepeatToggle, ShuffleToggle } from '@/player/QueueToggles/QueueToggles'
import { QueueRow } from '@/screens/NowPlaying/QueueRow'
import { TextLink } from '@/ui/TextLink/TextLink'
import styles from '@/screens/NowPlaying/UpNext.module.scss'

/** Where Up next sits: under the narrow player, or in the pane beside the wide one. */
export const UP_NEXT_PLACES = { sheet: 'sheet', panel: 'panel' } as const

export type UpNextPlace = (typeof UP_NEXT_PLACES)[keyof typeof UP_NEXT_PLACES]

type UpNextProps = {
  /** The source's name for the line under the heading, or null when it has none. */
  sourceName: string | null
  place: UpNextPlace
}

/**
 * What plays after this song: a heading with where the queue came from and how many songs are
 * left, beside what changes the queue, Shuffle, Repeat and Clear (which lets go of every song
 * still to play); then the songs, each playable, moved up or down a place, and removed.
 */
export function UpNext({ sourceName, place }: UpNextProps) {
  const queue = useAudioQueue((store) => store.queue)
  const tracks = useAudioQueue((store) => store.tracks)
  const jump = useAudioQueue((store) => store.jump)
  const move = useAudioQueue((store) => store.move)
  const remove = useAudioQueue((store) => store.remove)
  const rows = upNextRowsOf({ queue, tracks })
  const first = rows[0]?.place ?? 0
  const last = rows.at(-1)?.place ?? 0
  const songs = countsLineOf({ songs: rows.length })
  return (
    <section className={classNames([styles.upNext, styles[place]])}>
      <header className={styles.head}>
        <div className={styles.headText}>
          <h2 className={styles.title}>{PLAYER_COPY.upNext}</h2>
          {rows.length > 0 && (
            <p className={styles.line}>
              {NOW_PLAYING_COPY.sourceLine({ source: sourceName, songs })}
            </p>
          )}
        </div>
        <div className={styles.modes}>
          <ShuffleToggle />
          <RepeatToggle />
          {rows.length > 0 && (
            <TextLink
              label={NOW_PLAYING_COPY.clear}
              onPress={() => placesToClearOf(rows).forEach((at) => remove(at))}
              spoken={NOW_PLAYING_COPY.clearLabel}
            />
          )}
        </div>
      </header>
      {rows.length === 0 && <p className={styles.empty}>{NOW_PLAYING_COPY.nothingNext}</p>}
      {rows.length > 0 && (
        <ul className={styles.list}>
          {rows.map((row) => (
            <QueueRow
              first={first}
              key={row.key}
              last={last}
              onJump={jump}
              onMove={move}
              onRemove={remove}
              place={place}
              row={row}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
