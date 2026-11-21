import { classNames } from '@raven/ui/headless'
import styles from '@/ui/EqualizerIndicator/EqualizerIndicator.module.scss'

/** The four bars from the logo's chest; the stylesheet gives each its heights and its pace. */
const BARS = ['first', 'second', 'third', 'fourth'] as const

type EqualizerIndicatorProps = {
  /** Whether the track plays: the bars move while it does and hold still while it is paused. */
  isPlaying: boolean
}

/**
 * The now-playing mark: the logo's four equalizer bars, moving while the track plays, frozen
 * while it is paused, and still for a listener who asked for less motion. Decorative: the row
 * it sits in says it is playing.
 */
export function EqualizerIndicator({ isPlaying }: EqualizerIndicatorProps) {
  return (
    <span aria-hidden="true" className={classNames([styles.bars, isPlaying && styles.playing])}>
      {BARS.map((bar) => (
        <span className={styles.bar} key={bar} />
      ))}
    </span>
  )
}
