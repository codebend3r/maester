import { formatDuration } from '@raven/core'
import { type PointerEvent, useRef, useState } from 'react'
import styles from '@/components/Player/Scrubber.module.scss'

const percent = ({ time, duration }: { time: number; duration: number }): string =>
  `${duration > 0 ? Math.min(100, Math.max(0, (time / duration) * 100)) : 0}%`

/**
 * The timeline: what is buffered, what has played, and a leaf for the
 * playhead. Hovering shows the time under the pointer. Dragging previews
 * and seeks once, on release, so a converted stream is not restarted for
 * every pixel. The keyboard reaches it through the player's own arrows,
 * Home and End.
 */
export const Scrubber = ({
  time,
  duration,
  buffered,
  onSeek,
}: {
  time: number
  duration: number | null
  /** File-time ranges. */
  buffered: ReadonlyArray<[number, number]>
  onSeek: (time: number) => void
}) => {
  const track = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<number | null>(null)
  const [dragging, setDragging] = useState<number | null>(null)
  const total = duration ?? 0
  const shown = dragging ?? time

  const timeAt = (clientX: number): number => {
    const box = track.current?.getBoundingClientRect()
    if (!box || box.width === 0 || total <= 0) return 0
    return Math.min(total, Math.max(0, ((clientX - box.left) / box.width) * total))
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (total <= 0 || event.button !== 0) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setDragging(timeAt(event.clientX))
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const at = timeAt(event.clientX)
    setHover(at)
    if (dragging != null) setDragging(at)
  }

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (dragging == null) return
    onSeek(timeAt(event.clientX))
    setDragging(null)
  }

  const label = `${formatDuration(shown)} of ${formatDuration(duration)}`
  const tip = dragging ?? hover

  return (
    // A range input cannot draw buffered stretches under its track or wait
    // for release to seek, so this is an ARIA slider driven by the
    // player's own arrow, Home and End keys.
    <div
      ref={track}
      className={[styles.scrubber, dragging != null ? styles.dragging : '']
        .filter(Boolean)
        .join(' ')}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
      role="slider"
      tabIndex={0}
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.round(total)}
      aria-valuenow={Math.round(shown)}
      aria-valuetext={label}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDragging(null)}
      onPointerLeave={() => setHover(null)}
    >
      <span className={styles.rail} aria-hidden="true">
        {buffered.map(([start, end]) => (
          <span
            key={`${start}-${end}`}
            className={styles.buffered}
            style={{
              left: percent({ time: start, duration: total }),
              width: percent({ time: end - start, duration: total }),
            }}
          />
        ))}
        <span
          className={styles.played}
          style={{ width: percent({ time: shown, duration: total }) }}
        />
      </span>
      <span
        className={styles.head}
        style={{ left: percent({ time: shown, duration: total }) }}
        aria-hidden="true"
      />
      {tip != null && total > 0 && (
        <span
          className={styles.tip}
          style={{ left: percent({ time: tip, duration: total }) }}
          aria-hidden="true"
        >
          {formatDuration(tip)}
        </span>
      )}
    </div>
  )
}
