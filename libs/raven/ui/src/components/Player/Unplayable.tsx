import { Button } from '@/components/Button/Button'
import styles from '@/components/Player/Player.module.scss'
import { useHostServices } from '@/stores/playerServices'

const PLAYER_HINT =
  'The file is served untouched, so a player that handles every format, like VLC or IINA, can open the same link.'

/**
 * What stands in for the video when nothing this browser and server can do
 * together will play it: no way to convert, or every way tried and failed.
 * The way forward is another browser or a desktop player pointed at the
 * same URL.
 */
export const Unplayable = ({
  problems,
  onBack,
  onTryAnyway,
}: {
  problems: string[]
  /** Leaves the player, for the page that opened it. */
  onBack: () => void
  onTryAnyway: (() => void) | null
}) => {
  const {
    title,
    posterUrl: thumbnail,
    escape,
    escapeFeedback,
    escapeHint,
    unplayableNote,
    handoff,
  } = useHostServices()
  const hint = escapeHint === undefined ? PLAYER_HINT : escapeHint

  return (
    <section className={styles.unplayable} aria-labelledby="unplayable-title">
      {!!thumbnail && <img className={styles.backdrop} src={thumbnail} alt="" aria-hidden="true" />}
      <div className={styles.panel}>
        <Button tone="ghost" icon="back" className={styles.panelBack} onClick={onBack}>
          Back
        </Button>
        <h1 id="unplayable-title" className={styles.panelTitle}>
          {title.label}
        </h1>
        <p>{unplayableNote ?? "This video can't play in this browser."}</p>
        <ul className={styles.problems}>
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
        {escape && !!hint && <p className={styles.hint}>{hint}</p>}
        <div className={styles.panelActions}>
          {handoff && (
            <Button tone="primary" icon="play" onClick={() => handoff.run(title.resumeAt)}>
              {handoff.label}
            </Button>
          )}
          {!!onTryAnyway && (
            <Button tone={handoff ? 'quiet' : 'primary'} onClick={onTryAnyway}>
              Try playing anyway
            </Button>
          )}
          {escape && (
            <Button icon={escape.icon ?? 'copy'} className={styles.escape} onClick={escape.run}>
              {escape.label}
            </Button>
          )}
        </div>
        <p className={styles.hint} aria-live="polite">
          {escapeFeedback}
        </p>
      </div>
    </section>
  )
}
