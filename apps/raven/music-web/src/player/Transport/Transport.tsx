import { REPEAT_MODES } from '@raven/core'
import { isPlayingOf, useAudioQueue } from '@raven/ui/headless'
import {
  PLAYER_COPY,
  STEPS,
  type Step,
  TRANSPORTS,
  type TransportKind,
  hasTogglesOf,
} from '@raven/wren'
import { COLORS, type Size, SIZES } from '@/theme/tokens'
import { IconButton } from '@/ui/IconButton/IconButton'
import { ICONS, type WrenIconName } from '@/ui/WrenIcon/icons'
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
      icon={isPlaying ? ICONS.pause : ICONS.play}
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
  [STEPS.previous]: { icon: ICONS.previous, label: PLAYER_COPY.previous },
  [STEPS.next]: { icon: ICONS.next, label: PLAYER_COPY.next },
} as const satisfies Record<Step, StepSpec>

type StepButtonProps = { step: Step; size: Size }

/** Previous, back to the song before or the start of this one, or Next. */
function StepButton({ step, size }: StepButtonProps) {
  const onPress = useAudioQueue((store) => store[step])
  const { icon, label } = STEP_SPECS[step]
  return <IconButton color={COLORS.text} icon={icon} label={label} onPress={onPress} size={size} />
}

type ToggleProps = {
  /** The circle's size; Up next's toggles sit on a filled circle. */
  size?: Size
  isFilled?: boolean
}

type ToggleFillOfProps = { isOn: boolean; isFilled: boolean }

/** A toggle's ground: none unless it sits on a circle, which is soft red while it is on. */
const toggleFillOf = ({ isOn, isFilled }: ToggleFillOfProps) => {
  if (!isFilled) return undefined
  return isOn ? COLORS.accentSoft : COLORS.surface2
}

/** Shuffle, red while on; Up next's sits on a soft red circle while on. */
export function ShuffleToggle({ size = SIZES.touchTarget, isFilled = false }: ToggleProps) {
  const isShuffled = useAudioQueue((store) => store.queue.isShuffled)
  const toggleShuffle = useAudioQueue((store) => store.toggleShuffle)
  return (
    <IconButton
      color={isShuffled ? COLORS.accentText : COLORS.text3}
      fill={toggleFillOf({ isOn: isShuffled, isFilled })}
      icon={ICONS.shuffle}
      isSelected={isShuffled}
      label={PLAYER_COPY.shuffle}
      onPress={toggleShuffle}
      size={size}
    />
  )
}

/** Repeat, moving from off to all to one, named for the mode it is in and red while on. */
export function RepeatToggle({ size = SIZES.touchTarget, isFilled = false }: ToggleProps) {
  const repeat = useAudioQueue((store) => store.queue.repeat)
  const cycleRepeat = useAudioQueue((store) => store.cycleRepeat)
  const isOn = repeat !== REPEAT_MODES.off
  return (
    <IconButton
      color={isOn ? COLORS.accentText : COLORS.text3}
      fill={toggleFillOf({ isOn, isFilled })}
      icon={repeat === REPEAT_MODES.one ? ICONS.repeatOne : ICONS.repeat}
      isSelected={isOn}
      label={PLAYER_COPY.repeat[repeat]}
      onPress={cycleRepeat}
      size={size}
    />
  )
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
  [TRANSPORTS.column]: { play: SIZES.playQueue, step: SIZES.transportSmall, isPlayLifted: false },
} as const satisfies Record<TransportKind, TransportLook>

type TransportProps = { kind: TransportKind }

/** Shuffle, Previous, Play or Pause, Next and Repeat, as large as the place they sit in asks. */
export function Transport({ kind }: TransportProps) {
  const { play, step, isPlayLifted } = TRANSPORT_LOOKS[kind]
  const hasToggles = hasTogglesOf(kind)
  return (
    <div className={styles[kind]}>
      {hasToggles && <ShuffleToggle />}
      <StepButton size={step} step={STEPS.previous} />
      <PlayButton isLifted={isPlayLifted} size={play} />
      <StepButton size={step} step={STEPS.next} />
      {hasToggles && <RepeatToggle />}
    </div>
  )
}
