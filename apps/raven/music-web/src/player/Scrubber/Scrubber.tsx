import { formatDuration } from '@raven/core'
import { useAudioQueue } from '@raven/ui/headless'
import { PLAYER_COPY, remainingTextOf, scrubTextOf } from '@raven/wren'
import type { ComponentType, ReactElement } from 'react'
import { Adjuster } from '@/player/Adjuster/Adjuster'
import styles from '@/player/Scrubber/Scrubber.module.scss'

// How far an arrow key moves the scrubber, in seconds.
const SCRUB_STEP = 15

/**
 * Where the scrubber is drawn: Now Playing's, its times under it, the player bar's, beside it, or
 * the wide Now Playing's, the line alone.
 */
export const SCRUBBERS = { player: 'player', bar: 'bar', bare: 'bare' } as const

type ScrubberKind = (typeof SCRUBBERS)[keyof typeof SCRUBBERS]

type TimeProps = { text: string }

/** A time at the line's end, quiet to a screen reader, which hears the line's own value. */
function Time({ text }: TimeProps) {
  return (
    <span aria-hidden="true" className={styles.time}>
      {text}
    </span>
  )
}

type ScrubLayoutProps = { line: ReactElement; position: number; length: number }

/** Now Playing's: the line over how far in it is and how long is left. */
function StackedScrub({ line, position, length }: ScrubLayoutProps) {
  return (
    <div className={styles.stacked}>
      {line}
      <div className={styles.times}>
        <Time text={formatDuration(position)} />
        <Time text={remainingTextOf({ position, length })} />
      </div>
    </div>
  )
}

/** The player bar's: how far in it is, the line, and how long the track is, along one row. */
function InlineScrub({ line, position, length }: ScrubLayoutProps) {
  return (
    <div className={styles.inline}>
      <Time text={formatDuration(position)} />
      {line}
      <Time text={formatDuration(length)} />
    </div>
  )
}

/** The wide Now Playing's: the line alone, since its column holds no words. */
function BareScrub({ line }: ScrubLayoutProps) {
  return line
}

const SCRUB_LAYOUTS = {
  [SCRUBBERS.player]: StackedScrub,
  [SCRUBBERS.bar]: InlineScrub,
  [SCRUBBERS.bare]: BareScrub,
} as const satisfies Record<ScrubberKind, ComponentType<ScrubLayoutProps>>

type ScrubberProps = {
  /** The track's length, in seconds. */
  length: number
  kind: ScrubberKind
}

/** The scrubber: the line a pointer drags to seek, read out as "1:02 of 4:44", and its times. */
export function Scrubber({ length, kind }: ScrubberProps) {
  const position = useAudioQueue((store) => store.position)
  const seekTo = useAudioQueue((store) => store.seekTo)
  const Layout = SCRUB_LAYOUTS[kind]
  return (
    <Layout
      length={length}
      line={
        <Adjuster
          label={PLAYER_COPY.position}
          max={length}
          onChange={seekTo}
          step={SCRUB_STEP}
          value={position}
          valueText={(at) => scrubTextOf({ position: at, length })}
        />
      }
      position={position}
    />
  )
}
