import styles from '@/components/Equalizer/Equalizer.module.scss'

const BARS = [0, 1, 2, 3, 4] as const

type EqualizerProps = { isPlaying: boolean }

/** Bars that move while a song plays and hold still, where they were, while it is paused. */
export const Equalizer = ({ isPlaying }: EqualizerProps) => (
  <span
    className={isPlaying ? styles.equalizer : `${styles.equalizer} ${styles.still}`}
    aria-hidden="true"
  >
    {BARS.map((bar) => (
      <span key={bar} />
    ))}
  </span>
)
