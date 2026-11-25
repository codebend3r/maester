import { formatDuration, remainingTimeOf } from '@raven/core'
import { useAudioQueue } from '@raven/ui/headless'
import { PLAYER_COPY, scrubTextOf } from '@raven/wren'
import type { ComponentType, ReactElement } from 'react'
import { Text, View } from 'react-native'

import { Adjuster } from '@/player/Adjuster'
import { type WrenTheme, themedStyles } from '@/theme/wrenTheme'
import { SPACE, TYPE } from '@/theme/wrenTokens'

// How far a screen reader's swipe moves the scrubber, in seconds.
const SCRUB_STEP = 15

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  stacked: { gap: SPACE.s1 / 2 },
  times: { flexDirection: 'row', justifyContent: 'space-between' },
  inline: { alignItems: 'center', alignSelf: 'stretch', flexDirection: 'row', gap: SPACE.s3 },
  inlineLine: { flex: 1 },
  time: { ...TYPE.small, color: colors.text3 },
}))

/** Where the scrubber is drawn: Now Playing's, its times under it, or the tablet bar's, beside it. */
export const SCRUBBERS = { player: 'player', bar: 'bar' } as const

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

type ScrubLayoutProps = {
  line: ReactElement
  /** How far in it is, "1:02". */
  played: string
  /** How long is left, "-3:42". */
  left: string
}

/** Now Playing's: the line over how far in it is and how long is left. */
function StackedScrub({ line, played, left }: ScrubLayoutProps) {
  const styles = useStyles()
  return (
    <View style={styles.stacked}>
      {line}
      <View style={styles.times}>
        <Time text={played} />
        <Time text={left} />
      </View>
    </View>
  )
}

/** The tablet bar's: how far in it is, the line, and how long is left, along one row. */
function InlineScrub({ line, played, left }: ScrubLayoutProps) {
  const styles = useStyles()
  return (
    <View style={styles.inline}>
      <Time text={played} />
      <View style={styles.inlineLine}>{line}</View>
      <Time text={left} />
    </View>
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
 * The scrubber: the line a finger drags to seek, read out as "1:02 of 4:44", with how far in it
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
          step={SCRUB_STEP}
          value={position}
          valueText={(at) => scrubTextOf({ position: at, length })}
        />
      }
      played={formatDuration(position)}
    />
  )
}
