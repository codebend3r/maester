import { isPlayingOf, useAudioQueue } from '@raven/ui/headless'
import { StyleSheet, View } from 'react-native'

import {
  PLAYER_COPY,
  type Step,
  STEPS,
  type TransportKind,
  TRANSPORTS,
  WREN_ICONS,
  type WrenIconName,
} from '@raven/wren'
import { useWrenTheme } from '@/theme/wrenTheme'
import { PLAYER_SIZES, SIZE, SPACE } from '@/theme/wrenTokens'
import { IconButton } from '@/ui/IconButton'

/** How much of Play's circle its glyph fills: well over half, past the 26 the other buttons stop at. */
const PLAY_GLYPH_SHARE = 0.7

type PlayButtonProps = { size: number; isLifted: boolean }

/** Play or Pause, a circle filled in the text colour. */
function PlayButton({ size, isLifted }: PlayButtonProps) {
  const { colors } = useWrenTheme()
  const isPlaying = useAudioQueue(isPlayingOf)
  const toggle = useAudioQueue((store) => store.toggle)
  return (
    <IconButton
      color={colors.bg}
      fill={colors.text}
      icon={isPlaying ? WREN_ICONS.pause : WREN_ICONS.play}
      iconSize={Math.round(size * PLAY_GLYPH_SHARE)}
      isLifted={isLifted}
      label={isPlaying ? PLAYER_COPY.pause : PLAYER_COPY.play}
      onPress={toggle}
      size={size}
    />
  )
}

type StepSpec = { icon: WrenIconName; label: string }

const STEP_SPECS = {
  [STEPS.previous]: { icon: WREN_ICONS.previous, label: PLAYER_COPY.previous },
  [STEPS.next]: { icon: WREN_ICONS.next, label: PLAYER_COPY.next },
} as const satisfies Record<Step, StepSpec>

type StepButtonProps = { step: Step; size: number }

/** Previous, back to the song before or the start of this one, or Next. */
function StepButton({ step, size }: StepButtonProps) {
  const { colors } = useWrenTheme()
  const onPress = useAudioQueue((store) => store[step])
  const { icon, label } = STEP_SPECS[step]
  return <IconButton color={colors.text} icon={icon} label={label} onPress={onPress} size={size} />
}

type TransportSizes = {
  /** Play or Pause's circle. */
  play: number
  /** Previous's and Next's. */
  step: number
  /** Whether Play rides above the row, as the player bar's does. */
  isPlayLifted: boolean
  /** The gap between the three buttons, which sit together in the middle of their row. */
  gap: number
}

const TRANSPORT_SIZES = {
  [TRANSPORTS.player]: {
    play: PLAYER_SIZES.playLarge,
    step: PLAYER_SIZES.transportButton,
    isPlayLifted: false,
    gap: PLAYER_SIZES.gutter,
  },
  [TRANSPORTS.lyrics]: {
    play: PLAYER_SIZES.playCompact,
    step: PLAYER_SIZES.transportButton,
    isPlayLifted: false,
    gap: PLAYER_SIZES.gutter,
  },
  [TRANSPORTS.queue]: {
    play: PLAYER_SIZES.playQueue,
    step: PLAYER_SIZES.transportSmall,
    isPlayLifted: false,
    gap: PLAYER_SIZES.gutter,
  },
  [TRANSPORTS.bar]: {
    play: SIZE.playBar,
    step: SIZE.touchTarget,
    isPlayLifted: true,
    gap: SPACE.s4,
  },
} as const satisfies Record<TransportKind, TransportSizes>

const styles = StyleSheet.create({
  row: { alignItems: 'center', flexDirection: 'row', justifyContent: 'center' },
})

type TransportProps = { kind: TransportKind }

/**
 * Previous, Play or Pause and Next, alone in their row, as large as the place they sit in asks.
 * Shuffle and Repeat are the queue's, in Up next's head.
 */
export function Transport({ kind }: TransportProps) {
  const { play, step, isPlayLifted, gap } = TRANSPORT_SIZES[kind]
  return (
    <View style={[styles.row, { gap }]}>
      <StepButton size={step} step={STEPS.previous} />
      <PlayButton isLifted={isPlayLifted} size={play} />
      <StepButton size={step} step={STEPS.next} />
    </View>
  )
}
