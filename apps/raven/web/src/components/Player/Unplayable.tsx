import { Button } from '@/components/Button/Button'
import styles from '@/components/Player/Player.module.scss'
import { usePlayerServices } from '@/components/Player/PlayerServices'

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
  const { title, posterUrl: thumbnail, escape, escapeFeedback } = usePlayerServices()

  return (
    <section className={styles.unplayable} aria-labelledby="unplayable-title">
      {!!thumbnail && <img className={styles.backdrop} src={thumbnail} alt="" aria-hidden="true" />}
      <div className={styles.panel}>
        <Button icon="back" className={styles.panelBack} onClick={onBack}>
          Back
        </Button>
        <h1 id="unplayable-title" className={styles.panelTitle}>
          {title.label}
        </h1>
        <p>This video can't play in this browser.</p>
        <ul className={styles.problems}>
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
        {escape && (
          <p className={styles.hint}>
            The file is served untouched, so a player that handles every format, like VLC or IINA,
            can open the same link.
          </p>
        )}
        <div className={styles.panelActions}>
          {!!onTryAnyway && (
            <Button tone="primary" onClick={onTryAnyway}>
              Try playing anyway
            </Button>
          )}
          {escape && (
            <Button icon="copy" onClick={escape.run}>
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
