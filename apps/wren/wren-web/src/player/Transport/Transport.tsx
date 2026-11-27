import { isPlayingOf, useAudioQueue } from '@raven/ui/headless'
import {
  PLAYER_COPY,
  STEPS,
  type Step,
  TRANSPORTS,
  type TransportKind,
  WREN_ICONS,
  type WrenIconName,
} from '@raven/wren'
import { COLORS, type Size, SIZES } from '@/theme/tokens'
import { IconButton } from '@/ui/IconButton/IconButton'
import styles from '@/player/Transport/Transport.module.scss'

type PlayButtonProps = { size: Size; isLifted: boolean }

/** Play or Pause, a circle filled in the text colour. */
function PlayButton({ size, isLifted }: PlayButtonProps) {
  const isPlaying = useAudioQueue(isPlayingOf)
  const toggle = useAudioQueue((store) => store.toggle)
  return (
    <IconButton
      color={COLORS.bg}
      fill={COLORS.text}
      icon={isPlaying ? WREN_ICONS.pause : WREN_ICONS.play}
      isLifted={isLifted}
      isProminent
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

type StepButtonProps = { step: Step; size: Size }

/** Previous, back to the song before or the start of this one, or Next. */
function StepButton({ step, size }: StepButtonProps) {
  const onPress = useAudioQueue((store) => store[step])
  const { icon, label } = STEP_SPECS[step]
  return <IconButton color={COLORS.text} icon={icon} label={label} onPress={onPress} size={size} />
}

type TransportLook = {
  /** Play or Pause's circle. */
  play: Size
  /** Previous's and Next's. */
  step: Size
  /** Whether Play or Pause rides above the row, past the player bar's top edge. */
  isPlayLifted: boolean
}

const TRANSPORT_LOOKS = {
  [TRANSPORTS.player]: { play: SIZES.playLarge, step: SIZES.transportButton, isPlayLifted: false },
  [TRANSPORTS.lyrics]: {
    play: SIZES.playCompact,
    step: SIZES.transportButton,
    isPlayLifted: false,
  },
  [TRANSPORTS.queue]: { play: SIZES.playQueue, step: SIZES.transportSmall, isPlayLifted: false },
  [TRANSPORTS.bar]: { play: SIZES.playBar, step: SIZES.touchTarget, isPlayLifted: true },
} as const satisfies Record<TransportKind, TransportLook>

type TransportProps = { kind: TransportKind }

/**
 * Previous, Play or Pause and Next, alone in their row, as large as the place they sit in asks.
 * Shuffle and Repeat are the queue's, in Up next's head.
 */
export function Transport({ kind }: TransportProps) {
  const { play, step, isPlayLifted } = TRANSPORT_LOOKS[kind]
  return (
    <div className={styles[kind]}>
      <StepButton size={step} step={STEPS.previous} />
      <PlayButton isLifted={isPlayLifted} size={play} />
      <StepButton size={step} step={STEPS.next} />
    </div>
  )
}
