import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/Button/Button'
import {
  NO_CONTEXT,
  REPORTED_MESSAGE,
  REPORT_FAILED_MESSAGE,
  type ReportContext,
  gatherDiagnostics,
} from '@/components/Player/errorReport'
import styles from '@/components/Player/Player.module.scss'
import type { ErrorReporter } from '@/components/Player/PlayerServices'
import { useMediaOrigin } from '@/stores/mediaOrigin'
import { useHostServices } from '@/stores/playerServices'
import { useToasts } from '@/stores/toasts'

const PLAYER_HINT =
  'The file is served untouched, so a player that handles every format, like VLC or IINA, can open the same link.'

const REPORT_STATES = { idle: 'idle', sending: 'sending', failed: 'failed' } as const

type ReportState = (typeof REPORT_STATES)[keyof typeof REPORT_STATES]

/**
 * What stands in for the video when nothing this browser and server can do
 * together will play it: no way to convert, or every way tried and failed.
 * The way forward is another browser or a desktop player pointed at the
 * same URL. A host that takes reports offers Report this error, which sends
 * what the player knew and leaves as Back does.
 */
export const Unplayable = ({
  problems,
  onBack,
  onTryAnyway,
  context = NO_CONTEXT,
}: {
  problems: string[]
  /** Leaves the player, for the page that opened it. */
  onBack: () => void
  onTryAnyway: (() => void) | null
  /** What a report says beyond the problems: the file, its tracks and the ways tried. */
  context?: ReportContext
}) => {
  const {
    title,
    posterUrl: thumbnail,
    escape,
    escapeFeedback,
    escapeHint,
    unplayableNote,
    handoff,
    report,
  } = useHostServices()
  const hint = escapeHint === undefined ? PLAYER_HINT : escapeHint
  const showToast = useToasts((state) => state.show)
  const [reportState, setReportState] = useState<ReportState>(REPORT_STATES.idle)
  // A report still sending when the viewer leaves by Back must not leave a second time.
  const hasLeft = useRef(false)
  useEffect(() => {
    hasLeft.current = false
    return () => {
      hasLeft.current = true
    }
  }, [])

  const sendReport = async (reporter: ErrorReporter): Promise<void> => {
    setReportState(REPORT_STATES.sending)
    const { pick, isProbing } = useMediaOrigin.getState()
    await reporter.send(
      gatherDiagnostics({
        title: title.label,
        problems,
        resumeAt: title.resumeAt,
        context,
        pick,
        isProbingOrigins: isProbing,
        appVersion: reporter.appVersion,
      }),
    )
    showToast(REPORTED_MESSAGE)
    if (!hasLeft.current) onBack()
  }

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
        {report && (
          <Button
            icon="alert"
            className={styles.report}
            disabled={reportState === REPORT_STATES.sending}
            aria-busy={reportState === REPORT_STATES.sending}
            onClick={() => {
              sendReport(report).catch(() => setReportState(REPORT_STATES.failed))
            }}
          >
            Report this error
          </Button>
        )}
        <p className={styles.hint} aria-live="polite">
          {reportState === REPORT_STATES.failed ? REPORT_FAILED_MESSAGE : escapeFeedback}
        </p>
      </div>
    </section>
  )
}
