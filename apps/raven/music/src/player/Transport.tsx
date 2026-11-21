import { REPEAT_MODES } from '@raven/core'
import { isPlayingOf, useAudioQueue } from '@raven/ui/headless'
import { StyleSheet, View } from 'react-native'

import {
  hasTogglesOf,
  PLAYER_COPY,
  type Step,
  STEPS,
  type TransportKind,
  TRANSPORTS,
} from '@raven/wren'
import { useWrenTheme } from '@/theme/wrenTheme'
import { PLAYER_SIZES, SIZE, SPACE } from '@/theme/wrenTokens'
import { IconButton } from '@/ui/IconButton'
import { ICONS, type WrenIconName } from '@/ui/WrenIcon'

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

type StepSpec = { icon: WrenIconName; label: string }

const STEP_SPECS = {
  [STEPS.previous]: { icon: ICONS.previous, label: PLAYER_COPY.previous },
  [STEPS.next]: { icon: ICONS.next, label: PLAYER_COPY.next },
} as const satisfies Record<Step, StepSpec>

type StepButtonProps = { step: Step; size: number }

/** Previous, back to the song before or the start of this one, or Next. */
function StepButton({ step, size }: StepButtonProps) {
  const { colors } = useWrenTheme()
  const onPress = useAudioQueue((store) => store[step])
  const { icon, label } = STEP_SPECS[step]
  return <IconButton color={colors.text} icon={icon} label={label} onPress={onPress} size={size} />
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

type TransportSizes = {
  /** Play or Pause's circle. */
  play: number
  /** Previous's and Next's. */
  step: number
}

const TRANSPORT_SIZES = {
  [TRANSPORTS.player]: { play: PLAYER_SIZES.playLarge, step: PLAYER_SIZES.transportButton },
  [TRANSPORTS.lyrics]: { play: PLAYER_SIZES.playCompact, step: PLAYER_SIZES.transportButton },
  [TRANSPORTS.queue]: { play: PLAYER_SIZES.playQueue, step: PLAYER_SIZES.transportSmall },
  [TRANSPORTS.bar]: { play: SIZE.playButton, step: SIZE.touchTarget },
  [TRANSPORTS.column]: { play: PLAYER_SIZES.playQueue, step: PLAYER_SIZES.transportSmall },
} as const satisfies Record<TransportKind, TransportSizes>

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
  const { play, step } = TRANSPORT_SIZES[kind]
  const hasToggles = hasTogglesOf(kind)
  return (
    <View style={TRANSPORT_ROWS[kind]}>
      {hasToggles && <ShuffleToggle />}
      <StepButton size={step} step={STEPS.previous} />
      <PlayButton size={play} />
      <StepButton size={step} step={STEPS.next} />
      {hasToggles && <RepeatToggle />}
    </View>
  )
}
