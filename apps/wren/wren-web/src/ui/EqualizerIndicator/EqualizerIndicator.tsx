import { EQUALIZER_MARK, EQUALIZER_SIZES, type EqualizerSize, useSoundBars } from '@raven/ui'
import { classNames } from '@raven/ui/headless'
import { useRef } from 'react'
import styles from '@/ui/EqualizerIndicator/EqualizerIndicator.module.scss'

/** The four bars from the logo's chest, lowest band first; the stylesheet gives each its rest. */
const BARS = ['first', 'second', 'third', 'fourth'] as const

const SIZE_CLASSES = {
  [EQUALIZER_SIZES.small]: styles.small,
  [EQUALIZER_SIZES.medium]: styles.medium,
  [EQUALIZER_SIZES.large]: styles.large,
} as const satisfies Record<EqualizerSize, string | undefined>

type EqualizerIndicatorProps = {
  /** Whether the track plays: the bars follow the sound while it does and hold while it is paused. */
  isPlaying: boolean
  /** Whether it sits on a cover's veil, so its bars wear the picture's ink rather than the accent. */
  isOnPicture?: boolean
  size?: EqualizerSize
}

/**
 * The now-playing mark: the logo's four equalizer bars, following what plays (each a band of
 * the sound, low to high) while the track plays, holding where they are while it is paused,
 * and standing at their rest for a listener who asked for less motion or while nothing
 * measures the sound. Decorative: the row it sits in says it is playing.
 */
export function EqualizerIndicator({
  isPlaying,
  isOnPicture = false,
  size = EQUALIZER_SIZES.small,
}: EqualizerIndicatorProps) {
  const ref = useRef<HTMLSpanElement>(null)
  useSoundBars({ ref, isPlaying })
  const mark = { [EQUALIZER_MARK]: size }
  return (
    <span
      {...mark}
      aria-hidden="true"
      className={classNames([styles.bars, SIZE_CLASSES[size], isOnPicture && styles.onPicture])}
      ref={ref}
    >
      {BARS.map((bar) => (
        <span className={styles.bar} key={bar} />
      ))}
    </span>
  )
}
