import { useId } from 'react'
import { Button } from '@/components/Button/Button'
import { CountdownRing } from '@/components/Player/CountdownRing'
import type { UpNext } from '@/components/Player/PlayerServices'
import styles from '@/components/Player/UpNextCard.module.scss'

const secondsWords = (seconds: number): string =>
  seconds === 1 ? '1 second' : `${seconds} seconds`

type UpNextCardProps = {
  next: UpNext
  /** How far the countdown has run, 0 to 1; null when what is next waits for a click. */
  countdown: number | null
  /** Whole seconds until it plays by itself; null when it waits for a click. */
  secondsLeft: number | null
  /** The credits end before the file does: a scene follows them. */
  hasSceneAfter: boolean
  onPlay: () => void
  onDismiss: () => void
}

/**
 * What plays next, offered in the video's last seconds above the bar: its
 * picture, its name and where it falls, how long until it plays by itself,
 * whether a scene follows the credits, Play now, and Watch credits to put
 * the card away for this title.
 */
export const UpNextCard = ({
  next,
  countdown,
  secondsLeft,
  hasSceneAfter,
  onPlay,
  onDismiss,
}: UpNextCardProps) => {
  const heading = useId()
  const isNextSeason = next.isNextSeason === true
  return (
    <section className={styles.card} aria-labelledby={heading}>
      {!!next.posterUrl && <img className={styles.poster} src={next.posterUrl} alt="" />}
      <p className={styles.lead}>{isNextSeason ? 'Next season' : 'Up next'}</p>
      <h2 id={heading} className={styles.title}>
        {next.label}
      </h2>
      {!!next.detail && <p className={styles.detail}>{next.detail}</p>}
      {countdown != null && secondsLeft != null && (
        <p className={styles.countdown}>
          <span className={styles.ring}>
            <CountdownRing countdown={countdown} />
          </span>
          Plays in {secondsWords(secondsLeft)}
        </p>
      )}
      {hasSceneAfter && <p className={styles.scene}>A scene follows the credits</p>}
      <p className={styles.actions}>
        <Button tone="primary" icon="play" onClick={onPlay}>
          {isNextSeason ? 'Play next season' : 'Play now'}
        </Button>
        <Button tone="ghost" className={styles.dismiss} onClick={onDismiss}>
          Watch credits
        </Button>
      </p>
    </section>
  )
}
