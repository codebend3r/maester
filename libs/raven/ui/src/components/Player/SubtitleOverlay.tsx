import { type SubtitleCue, activeCues, cueRuns } from '@raven/core'
import { type RefObject, useEffect, useRef, useState } from 'react'
import styles from '@/components/Player/SubtitleOverlay.module.scss'

const keyOf = (cues: readonly SubtitleCue[]): string =>
  cues.map((cue) => `${cue.start}|${cue.text}`).join('\n')

/**
 * Draws the cues showing now. Reads the playhead every frame rather than
 * waiting for `timeupdate`, which only fires four times a second, and
 * re-renders only when the set of cues on screen changes.
 */
export const SubtitleOverlay = ({
  cues,
  video,
  shift,
  lifted,
  scale,
}: {
  cues: readonly SubtitleCue[]
  video: RefObject<HTMLVideoElement | null>
  /** Seconds the element's clock runs ahead of the file's. */
  shift: number
  /** Raised clear of the controls while they show. */
  lifted: boolean
  scale: number
}) => {
  const [showing, setShowing] = useState<SubtitleCue[]>([])
  const shown = useRef('')
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const frame = { id: 0 }
    const tick = () => {
      const time = (video.current?.currentTime ?? 0) - shift
      const now = activeCues({ cues, time })
      const key = keyOf(now)
      if (key !== shown.current) {
        shown.current = key
        setShowing(now)
      }
      frame.id = window.requestAnimationFrame(tick)
    }
    tick()
    return () => window.cancelAnimationFrame(frame.id)
  }, [cues, video, shift])

  // A custom property rather than a font size here, so the stylesheet keeps the clamp.
  useEffect(() => {
    root.current?.style.setProperty('--caption-scale', String(scale))
  }, [scale])

  return (
    <div
      ref={root}
      className={[styles.overlay, lifted ? styles.lifted : ''].filter(Boolean).join(' ')}
      aria-live="off"
    >
      {showing.map((cue) => (
        <p key={`${cue.start}|${cue.text}`} className={styles.cue}>
          {cueRuns(cue.text).map((run, index) => (
            <span
              // Runs have no identity beyond their order within the cue.
              // oxlint-disable-next-line react/no-array-index-key
              key={index}
              className={[
                run.italic ? styles.italic : '',
                run.bold ? styles.bold : '',
                run.underline ? styles.underline : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {run.text}
            </span>
          ))}
        </p>
      ))}
    </div>
  )
}
