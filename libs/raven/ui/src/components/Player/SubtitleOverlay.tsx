import {
  CAPTION_COLOUR_VALUES,
  CAPTION_SIZE_SCALES,
  type CaptionStyle,
  type SubtitleCue,
  activeCues,
  cueRuns,
} from '@raven/core'
import { type RefObject, useEffect, useRef, useState } from 'react'
import styles from '@/components/Player/SubtitleOverlay.module.scss'

const keyOf = (cues: readonly SubtitleCue[]): string =>
  cues.map((cue) => `${cue.start}|${cue.text}`).join('\n')

type SubtitleOverlayProps = {
  cues: readonly SubtitleCue[]
  video: RefObject<HTMLVideoElement | null>
  /** Seconds the element's clock runs ahead of the file's. */
  shift: number
  /** Raised clear of the controls while they show. */
  lifted: boolean
  /** The account's size and colour; the face is always the display face. */
  captionStyle: CaptionStyle
}

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
  captionStyle,
}: SubtitleOverlayProps) => {
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

  // Custom properties rather than a font size and a colour here, so the stylesheet keeps the clamp.
  const scale = CAPTION_SIZE_SCALES[captionStyle.size]
  const colour = CAPTION_COLOUR_VALUES[captionStyle.colour]
  useEffect(() => {
    root.current?.style.setProperty('--caption-scale', String(scale))
    root.current?.style.setProperty('--caption-colour', colour)
  }, [scale, colour])

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
              // The display face has one weight, so a bold run reads as the rest does.
              className={[run.italic ? styles.italic : '', run.underline ? styles.underline : '']
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
