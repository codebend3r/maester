import styles from '@/components/Player/CountdownRing.module.scss'

type CountdownRingProps = {
  /** How far the countdown has run, 0 to 1. */
  countdown: number
}

/** A ring that fills clockwise from the top as the countdown to what is up next runs out. */
export const CountdownRing = ({ countdown }: CountdownRingProps) => (
  <svg className={styles.ring} viewBox="0 0 44 44" aria-hidden="true" focusable="false">
    <circle className={styles.track} cx="22" cy="22" r="20" />
    <circle
      className={styles.fill}
      cx="22"
      cy="22"
      r="20"
      pathLength={1}
      strokeDasharray={1}
      strokeDashoffset={1 - countdown}
      data-countdown={countdown}
    />
  </svg>
)
