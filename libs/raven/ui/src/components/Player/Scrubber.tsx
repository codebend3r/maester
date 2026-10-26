import { formatDuration } from '@raven/core'
import { type CSSProperties, type PointerEvent, useRef, useState } from 'react'
import styles from '@/components/Player/Scrubber.module.scss'

type ShareProps = { time: number; duration: number }

const share = ({ time, duration }: ShareProps): number =>
  duration > 0 ? Math.min(100, Math.max(0, (time / duration) * 100)) : 0

type PercentProps = { time: number; duration: number }

const percent = ({ time, duration }: PercentProps): string => `${share({ time, duration })}%`

const NO_CHAPTERS: readonly number[] = []

const gapStart = (at: number): string => `calc(${at}% - var(--chapter-gap) / 2)`
const gapEnd = (at: number): string => `calc(${at}% + var(--chapter-gap) / 2)`

type ChapterMaskProps = {
  chapters: readonly number[]
  duration: number
}

/**
 * A mask that cuts a gap into the track at each chapter's start, so the
 * buffered and played stretches break there too. A mask reads only alpha,
 * so any opaque colour does for the parts that show. Null without chapters
 * inside the video.
 */
export const chapterMask = ({ chapters, duration }: ChapterMaskProps): string | null => {
  const cuts = chapters
    .filter((start) => start > 0 && start < duration)
    .toSorted((a, b) => a - b)
    .map((start) => share({ time: start, duration }))
  if (cuts.length === 0) return null
  const solid = 'var(--color-stage)'
  const stops = cuts.reduce<{ from: string; parts: string[] }>(
    (acc, at) => ({
      from: gapEnd(at),
      parts: [
        ...acc.parts,
        `${solid} ${acc.from} ${gapStart(at)}`,
        `transparent ${gapStart(at)} ${gapEnd(at)}`,
      ],
    }),
    { from: '0%', parts: [] },
  )
  return `linear-gradient(to right, ${[...stops.parts, `${solid} ${stops.from} 100%`].join(', ')})`
}

type ScrubberProps = {
  time: number
  duration: number | null
  /** File-time ranges. */
  buffered: ReadonlyArray<[number, number]>
  /** Where each chapter starts, in seconds of the file. */
  chapters?: readonly number[]
  onSeek: (time: number) => void
}

/**
 * The timeline: what is buffered, what has played, and a round thumb for
 * the playhead, broken at each chapter when the video has them. Hovering
 * shows the time under the pointer. Dragging previews and seeks once, on
 * release, so a converted stream is not restarted for every pixel. The
 * keyboard reaches it through the player's own arrows, Home and End.
 */
export const Scrubber = ({
  time,
  duration,
  buffered,
  chapters = NO_CHAPTERS,
  onSeek,
}: ScrubberProps) => {
  const track = useRef<HTMLDivElement>(null)
  const tipRef = useRef<HTMLSpanElement>(null)
  const [dragging, setDragging] = useState<number | null>(null)
  const total = duration ?? 0
  const shown = dragging ?? time
  const mask = chapterMask({ chapters, duration: total })
  const railStyle: CSSProperties | undefined = mask
    ? { maskImage: mask, WebkitMaskImage: mask }
    : undefined

  const timeAt = (clientX: number): number => {
    const box = track.current?.getBoundingClientRect()
    if (!box || box.width === 0 || total <= 0) return 0
    return Math.min(total, Math.max(0, ((clientX - box.left) / box.width) * total))
  }

  // The tip follows the pointer through the DOM, not state, so a sweep across
  // the bar renders nothing in React.
  const moveTip = (at: number | null) => {
    const tip = tipRef.current
    if (tip === null) return
    tip.hidden = at === null || total <= 0
    if (at === null) return
    tip.style.left = percent({ time: at, duration: total })
    tip.textContent = formatDuration(at)
  }

  const leave = () => moveTip(null)

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (total <= 0 || event.button !== 0) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setDragging(timeAt(event.clientX))
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const at = timeAt(event.clientX)
    moveTip(at)
    if (dragging != null) setDragging(at)
  }

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (dragging == null) return
    onSeek(timeAt(event.clientX))
    setDragging(null)
  }

  const label = `${formatDuration(shown)} of ${formatDuration(duration)}`

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
      onPointerCancel={() => {
        setDragging(null)
        leave()
      }}
      onPointerLeave={leave}
    >
      <span className={styles.rail} style={railStyle} aria-hidden="true">
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
      <span ref={tipRef} className={styles.tip} aria-hidden="true" hidden />
    </div>
  )
}
