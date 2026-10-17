import { WATCHED_STATES, watchedStateOf } from '@raven/core'
import { Icon } from '@raven/ui'
import { plural } from '@/lib/plural'
import styles from '@/components/WatchedCount/WatchedCount.module.scss'

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
  if (state === WATCHED_STATES.watched) return 'Watched'
  return plural({ n: total - watched, one: `unwatched ${unit}`, many: `unwatched ${unit}s` })
}

/** The words of the count, for a screen reader; the count itself is only a picture. */
export const WatchedCountWords = (counted: Counted) => {
  const words = wordsOf(counted)
  return words != null && <span className="visually-hidden">{words}</span>
}

/**
 * How much of what a show, season or saga holds is watched: a check when
 * all of it is, the number left to watch when some is, nothing when none
 * is. It carries its own words, unless `decorative`: inside a picture that
 * is hidden from a screen reader, the card says them with
 * `WatchedCountWords` beside its other facts. Where it sits is the
 * container's to say, so it takes a `className`.
 */
export const WatchedCount = ({
  decorative = false,
  className,
  ...counted
}: Counted & { decorative?: boolean; className?: string }) => {
  const state = watchedStateOf(counted)
  if (state === WATCHED_STATES.unwatched) return null
  return (
    <span
      className={[styles.count, className ?? ''].filter(Boolean).join(' ')}
      aria-hidden={decorative ? 'true' : undefined}
    >
      {state === WATCHED_STATES.watched ? (
        <Icon name="check" size={14} />
      ) : (
        <span aria-hidden="true">{counted.total - counted.watched}</span>
      )}
      {!decorative && <WatchedCountWords {...counted} />}
    </span>
  )
}
