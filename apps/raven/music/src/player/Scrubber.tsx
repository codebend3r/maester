import { formatDuration } from '@raven/core'
import { useAudioQueue } from '@raven/ui/headless'
import type { ComponentType, ReactElement } from 'react'
import { Text, View } from 'react-native'

import { Adjuster } from '@/player/Adjuster'
import { remainingTextOf, scrubTextOf } from '@/player/playerModel'
import { type WrenTheme, themedStyles } from '@/theme/wrenTheme'
import { SPACE, TYPE } from '@/theme/wrenTokens'
import { PLAYER_COPY } from '@/ui/copy'

// How far a screen reader's swipe moves the scrubber, in seconds.
const SCRUB_STEP = 15

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  stacked: { gap: SPACE.s1 / 2 },
  times: { flexDirection: 'row', justifyContent: 'space-between' },
  inline: { alignItems: 'center', alignSelf: 'stretch', flexDirection: 'row', gap: SPACE.s3 },
  inlineLine: { flex: 1 },
  time: { ...TYPE.small, color: colors.text3 },
}))

/**
 * Where the scrubber is drawn: Now Playing's, its times under it, the tablet bar's, beside it, or
 * the tablet's Now Playing, the line alone.
 */
export const SCRUBBERS = { player: 'player', bar: 'bar', bare: 'bare' } as const

type ScrubberKind = (typeof SCRUBBERS)[keyof typeof SCRUBBERS]

type TimeProps = { text: string }

/** A time at the line's end, quiet to a screen reader, which hears the line's own value. */
function Time({ text }: TimeProps) {
  const styles = useStyles()
  return (
    <Text accessibilityElementsHidden importantForAccessibility="no" style={styles.time}>
      {text}
    </Text>
  )
}

type ScrubLayoutProps = { line: ReactElement; position: number; length: number }

/** Now Playing's: the line over how far in it is and how long is left. */
function StackedScrub({ line, position, length }: ScrubLayoutProps) {
  const styles = useStyles()
  return (
    <View style={styles.stacked}>
      {line}
      <View style={styles.times}>
        <Time text={formatDuration(position)} />
        <Time text={remainingTextOf({ position, length })} />
      </View>
    </View>
  )
}

/** The tablet bar's: how far in it is, the line, and how long the track is, along one row. */
function InlineScrub({ line, position, length }: ScrubLayoutProps) {
  const styles = useStyles()
  return (
    <View style={styles.inline}>
      <Time text={formatDuration(position)} />
      <View style={styles.inlineLine}>{line}</View>
      <Time text={formatDuration(length)} />
    </View>
  )
}

/** The tablet's Now Playing: the line alone, since its column holds no words. */
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

/** The scrubber: the line a finger drags to seek, read out as "1:02 of 4:44", and its times. */
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
