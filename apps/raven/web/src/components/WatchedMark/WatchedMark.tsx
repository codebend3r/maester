import { Icon } from '@raven/ui'
import styles from '@/components/WatchedMark/WatchedMark.module.scss'

type WatchedWordsProps = { watched: boolean }

/** The words of the check, for a screen reader; the check itself is only a picture. */
export const WatchedWords = ({ watched }: WatchedWordsProps) =>
  watched && <span className="visually-hidden">Watched</span>

type WatchedMarkProps = {
  watched: boolean
  decorative?: boolean
  className?: string
}

/**
 * A check for a video that is watched; nothing for one that is not. It
 * carries its own words, unless `decorative`: inside a picture that is
 * hidden from a screen reader, the card says them with `WatchedWords`
 * beside its other facts, as `PartlyWatched` does for the resume line.
 * Where it sits is the container's to say, so it takes a `className`.
 */
export const WatchedMark = ({ watched, decorative = false, className }: WatchedMarkProps) =>
  watched && (
    <span
      className={[styles.mark, className ?? ''].filter(Boolean).join(' ')}
      aria-hidden={decorative ? 'true' : undefined}
    >
      <Icon name="check" size={14} />
      {!decorative && <WatchedWords watched={watched} />}
    </span>
  )
