import { WATCHED_STATES, type WatchedState, watchedStateOf } from '@raven/core'
import type { ComponentType } from 'react'
import { Icon } from '@raven/ui'
import { WATCHED_COUNT_COPY } from '@/components/WatchedCount/copy'
import styles from '@/components/WatchedCount/WatchedCount.module.scss'
import { COMMON_COPY } from '@/lib/copy'

type Counted = {
  watched: number
  total: number
  /** What the card holds: its episodes, or a saga's movies. */
  unit?: 'episode' | 'movie'
}

/** "Watched", or "6 unwatched episodes"; null when none is watched. */
const wordsOf = ({ watched, total, unit = 'episode' }: Counted): string | null => {
  const state = watchedStateOf({ watched, total })
  if (state === WATCHED_STATES.unwatched) return null
  if (state === WATCHED_STATES.watched) return COMMON_COPY.watched
  return WATCHED_COUNT_COPY.unwatched({ n: total - watched, unit })
}

type WatchedCountWordsProps = Counted

/** The words of the count, for a screen reader; the count itself is only a picture. */
export const WatchedCountWords = (counted: WatchedCountWordsProps) => {
  const words = wordsOf(counted)
  return words != null && <span className="visually-hidden">{words}</span>
}

type CountMarkProps = { counted: Counted }

const WatchedCheck = () => <Icon name="check" size={14} />

type LeftToWatchProps = CountMarkProps

const LeftToWatch = ({ counted }: LeftToWatchProps) => (
  <span aria-hidden="true">{counted.total - counted.watched}</span>
)

/** What the mark shows for each state but unwatched, which shows none. */
const COUNT_MARKS = {
  [WATCHED_STATES.watched]: WatchedCheck,
  [WATCHED_STATES.partly]: LeftToWatch,
} as const satisfies Record<
  Exclude<WatchedState, typeof WATCHED_STATES.unwatched>,
  ComponentType<CountMarkProps>
>

type WatchedCountMarkProps = CountMarkProps & {
  state: Exclude<WatchedState, typeof WATCHED_STATES.unwatched>
  decorative: boolean
  className?: string
}

const WatchedCountMark = ({ state, counted, decorative, className }: WatchedCountMarkProps) => {
  const Mark: ComponentType<CountMarkProps> = COUNT_MARKS[state]
  return (
    <span
      className={[styles.count, className ?? ''].filter(Boolean).join(' ')}
      aria-hidden={decorative ? 'true' : undefined}
    >
      <Mark counted={counted} />
      {!decorative && <WatchedCountWords {...counted} />}
    </span>
  )
}

type WatchedCountProps = Counted & { decorative?: boolean; className?: string }

/**
 * How much of what a show, season or saga holds is watched: a check when
 * all of it is, the number left to watch when some is, nothing when none
 * is. It carries its own words, unless `decorative`: inside a picture that
 * is hidden from a screen reader, the card says them with
 * `WatchedCountWords` beside its other facts. Where it sits is the
 * container's to say, so it takes a `className`.
 */
export const WatchedCount = ({ decorative = false, className, ...counted }: WatchedCountProps) => {
  const state = watchedStateOf(counted)
  return (
    state !== WATCHED_STATES.unwatched && (
      <WatchedCountMark
        state={state}
        counted={counted}
        decorative={decorative}
        className={className}
      />
    )
  )
}
