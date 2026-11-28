import {
  EQUALIZER_MARK,
  EQUALIZER_SIZES,
  type EqualizerSize,
  classNames,
  useSoundBars,
} from '@raven/ui'
import { useRef } from 'react'
import styles from '@/components/Equalizer/Equalizer.module.scss'

/** One bar a band of the sound, the lowest first. */
const BARS = [0, 1, 2, 3, 4] as const

const SIZE_CLASSES = {
  [EQUALIZER_SIZES.small]: styles.small,
  [EQUALIZER_SIZES.medium]: styles.medium,
  [EQUALIZER_SIZES.large]: styles.large,
} as const satisfies Record<EqualizerSize, string | undefined>

type EqualizerProps = {
  /** Whether the song plays: the bars follow the sound while it does and hold while it is paused. */
  isPlaying: boolean
  size?: EqualizerSize
}

/**
 * Bars that follow what plays, each a band of the sound from low to high, while a song plays,
 * and hold where they were while it is paused. With nothing measuring the sound, or for a
 * viewer who asks for less motion, they stand still at their rest. Decorative.
 */
export const Equalizer = ({ isPlaying, size = EQUALIZER_SIZES.medium }: EqualizerProps) => {
  const ref = useRef<HTMLSpanElement>(null)
  useSoundBars({ ref, isPlaying })
  const mark = { [EQUALIZER_MARK]: size }
  return (
    <span
      {...mark}
      ref={ref}
      className={classNames([styles.equalizer, SIZE_CLASSES[size]])}
      aria-hidden="true"
    >
      {BARS.map((bar) => (
        <span key={bar} className={styles.bar} />
      ))}
    </span>
  )
}
