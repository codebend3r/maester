import { REPEAT_MODES } from '@raven/core'
import { isPlayingOf, useAudioQueue } from '@raven/ui/headless'
import { StyleSheet, View } from 'react-native'

import { useWrenTheme } from '@/theme/wrenTheme'
import { PLAYER_SIZES, SIZE, SPACE } from '@/theme/wrenTokens'
import { IconButton } from '@/ui/IconButton'
import { ICONS } from '@/ui/WrenIcon'
import { PLAYER_COPY } from '@/ui/copy'

type PlayButtonProps = { size: number }

/** Play or Pause, a circle filled in the text colour. */
function PlayButton({ size }: PlayButtonProps) {
  const { colors } = useWrenTheme()
  const isPlaying = useAudioQueue(isPlayingOf)
  const toggle = useAudioQueue((store) => store.toggle)
  return (
    <IconButton
      color={colors.bg}
      fill={colors.text}
      icon={isPlaying ? ICONS.pause : ICONS.play}
      label={isPlaying ? PLAYER_COPY.pause : PLAYER_COPY.play}
      onPress={toggle}
      size={size}
    />
  )
}

type StepButtonsProps = { size: number }

/** Previous: back to the song before, or the start of this one. */
function PreviousButton({ size }: StepButtonsProps) {
  const { colors } = useWrenTheme()
  const previous = useAudioQueue((store) => store.previous)
  return (
    <IconButton
      color={colors.text}
      icon={ICONS.previous}
      label={PLAYER_COPY.previous}
      onPress={previous}
      size={size}
    />
  )
}

function NextButton({ size }: StepButtonsProps) {
  const { colors } = useWrenTheme()
  const next = useAudioQueue((store) => store.next)
  return (
    <IconButton
      color={colors.text}
      icon={ICONS.next}
      label={PLAYER_COPY.next}
      onPress={next}
      size={size}
    />
  )
}

type ToggleProps = {
  /** The circle's size; Up next's toggles sit on a filled circle. */
  size?: number
  isFilled?: boolean
}

/** Shuffle, red while on; Up next's sits on a soft red circle while on. */
export function ShuffleToggle({ size = SIZE.touchTarget, isFilled = false }: ToggleProps) {
  const { colors } = useWrenTheme()
  const isShuffled = useAudioQueue((store) => store.queue.isShuffled)
  const toggleShuffle = useAudioQueue((store) => store.toggleShuffle)
  const idleFill = isFilled ? colors.surface2 : undefined
  return (
    <IconButton
      color={isShuffled ? colors.accentText : colors.text3}
      fill={isShuffled && isFilled ? colors.accentSoft : idleFill}
      icon={ICONS.shuffle}
      isSelected={isShuffled}
      label={PLAYER_COPY.shuffle}
      onPress={toggleShuffle}
      size={size}
    />
  )
}

/** Repeat, moving from off to all to one, named for the mode it is in and red while on. */
export function RepeatToggle({ size = SIZE.touchTarget, isFilled = false }: ToggleProps) {
  const { colors } = useWrenTheme()
  const repeat = useAudioQueue((store) => store.queue.repeat)
  const cycleRepeat = useAudioQueue((store) => store.cycleRepeat)
  const isOn = repeat !== REPEAT_MODES.off
  const idleFill = isFilled ? colors.surface2 : undefined
  return (
    <IconButton
      color={isOn ? colors.accentText : colors.text3}
      fill={isOn && isFilled ? colors.accentSoft : idleFill}
      icon={repeat === REPEAT_MODES.one ? ICONS.repeatOne : ICONS.repeat}
      isSelected={isOn}
      label={PLAYER_COPY.repeat[repeat]}
      onPress={cycleRepeat}
      size={size}
    />
  )
}

/**
 * Where the transport is drawn: the player's, the lyrics', Up next's, the tablet bar's and the
 * narrow column of the tablet's Now Playing.
 */
export const TRANSPORTS = {
  player: 'player',
  lyrics: 'lyrics',
  queue: 'queue',
  bar: 'bar',
  column: 'column',
} as const

type TransportKind = (typeof TRANSPORTS)[keyof typeof TRANSPORTS]

type TransportSpec = {
  /** Play or Pause's circle. */
  play: number
  /** Previous's and Next's. */
  step: number
  /** Whether Shuffle and Repeat flank it; Up next's head holds its own. */
  hasToggles: boolean
}

const TRANSPORT_SPECS = {
  [TRANSPORTS.player]: {
    play: PLAYER_SIZES.playLarge,
    step: PLAYER_SIZES.transportButton,
    hasToggles: true,
  },
  [TRANSPORTS.lyrics]: {
    play: PLAYER_SIZES.playCompact,
    step: PLAYER_SIZES.transportButton,
    hasToggles: true,
  },
  [TRANSPORTS.queue]: {
    play: PLAYER_SIZES.playQueue,
    step: PLAYER_SIZES.transportSmall,
    hasToggles: false,
  },
  [TRANSPORTS.bar]: { play: SIZE.playButton, step: SIZE.touchTarget, hasToggles: true },
  [TRANSPORTS.column]: {
    play: PLAYER_SIZES.playQueue,
    step: PLAYER_SIZES.transportSmall,
    hasToggles: true,
  },
} as const satisfies Record<TransportKind, TransportSpec>

const spread = {
  alignItems: 'center',
  flexDirection: 'row',
  justifyContent: 'space-between',
} as const

// Now Playing's spread across the width; Up next's and the bar's sit together in the middle.
const TRANSPORT_ROWS = StyleSheet.create({
  [TRANSPORTS.player]: spread,
  [TRANSPORTS.lyrics]: spread,
  [TRANSPORTS.queue]: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: PLAYER_SIZES.gutter,
    justifyContent: 'center',
  },
  [TRANSPORTS.bar]: { alignItems: 'center', flexDirection: 'row', gap: SPACE.s4 },
  [TRANSPORTS.column]: spread,
})

type TransportProps = { kind: TransportKind }

/** Shuffle, Previous, Play or Pause, Next and Repeat, as large as the place they sit in asks. */
export function Transport({ kind }: TransportProps) {
  const { play, step, hasToggles } = TRANSPORT_SPECS[kind]
  return (
    <View style={TRANSPORT_ROWS[kind]}>
      {hasToggles && <ShuffleToggle />}
      <PreviousButton size={step} />
      <PlayButton size={play} />
      <NextButton size={step} />
      {hasToggles && <RepeatToggle />}
    </View>
  )
}
