import { formatDuration, remainingTimeOf } from '@raven/core'
import { useAudioQueue } from '@raven/ui/headless'
import { PLAYER_COPY, SCRUB_STEP_SECONDS, scrubTextOf } from '@raven/wren'
import type { ComponentType, ReactElement } from 'react'
import { Adjuster } from '@/player/Adjuster/Adjuster'
import styles from '@/player/Scrubber/Scrubber.module.scss'

/** Where the scrubber is drawn: Now Playing's, its times under it, or the player bar's, beside it. */
export const SCRUBBERS = { player: 'player', bar: 'bar' } as const

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

type ScrubLayoutProps = {
  line: ReactElement
  /** How far in it is, "1:02". */
  played: string
  /** How long is left, "-3:42". */
  left: string
}

/** Now Playing's: the line over how far in it is and how long is left. */
function StackedScrub({ line, played, left }: ScrubLayoutProps) {
  return (
    <div className={styles.stacked}>
      {line}
      <div className={styles.times}>
        <Time text={played} />
        <Time text={left} />
      </div>
    </div>
  )
}

/** The player bar's: how far in it is, the line, and how long is left, along one row. */
function InlineScrub({ line, played, left }: ScrubLayoutProps) {
  return (
    <div className={styles.inline}>
      <Time text={played} />
      {line}
      <Time text={left} />
    </div>
  )
}

const SCRUB_LAYOUTS = {
  [SCRUBBERS.player]: StackedScrub,
  [SCRUBBERS.bar]: InlineScrub,
} as const satisfies Record<ScrubberKind, ComponentType<ScrubLayoutProps>>

type ScrubberProps = {
  /** The track's length, in seconds. */
  length: number
  kind: ScrubberKind
}

/**
 * The scrubber: the line a pointer drags to seek, read out as "1:02 of 4:44", with how far in it
 * is at its start and how long is left, "-3:42", at its end.
 */
export function Scrubber({ length, kind }: ScrubberProps) {
  const position = useAudioQueue((store) => store.position)
  const seekTo = useAudioQueue((store) => store.seekTo)
  const Layout = SCRUB_LAYOUTS[kind]
  return (
    <Layout
      left={remainingTimeOf({ position, length })}
      line={
        <Adjuster
          label={PLAYER_COPY.position}
          max={length}
          onChange={seekTo}
          step={SCRUB_STEP_SECONDS}
          value={position}
          valueText={(at) => scrubTextOf({ position: at, length })}
        />
      }
      played={formatDuration(position)}
    />
  )
}
