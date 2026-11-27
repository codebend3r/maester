import { REPEAT_MODES } from '@raven/core'
import { isPlayingOf, useAudioQueue } from '@raven/ui/headless'
import {
  PLAYER_COPY,
  STEPS,
  type Step,
  repeatIconOf,
  WREN_ICONS,
  type WrenIconName,
} from '@raven/wren'
import { View } from 'react-native'

import { SPACE } from '@/theme/tvTokens'
import { themedStyles } from '@/theme/wrenTheme'
import { BUTTON_TONES, FocusButton } from '@/ui/FocusButton'

const useStyles = themedStyles(() => ({
  row: { alignItems: 'center', flexDirection: 'row', gap: SPACE.s3 },
  toggles: { flex: 1, flexDirection: 'row', gap: SPACE.s3, justifyContent: 'flex-end' },
}))

type PlayButtonProps = { hasPreferredFocus: boolean }

/** Play or Pause, the screen's loudest button, named for what a press does. */
function PlayButton({ hasPreferredFocus }: PlayButtonProps) {
  const isPlaying = useAudioQueue(isPlayingOf)
  const toggle = useAudioQueue((store) => store.toggle)
  return (
    <FocusButton
      hasPreferredFocus={hasPreferredFocus}
      icon={isPlaying ? WREN_ICONS.pause : WREN_ICONS.play}
      label={isPlaying ? PLAYER_COPY.pause : PLAYER_COPY.play}
      onPress={toggle}
      tone={BUTTON_TONES.primary}
    />
  )
}

type StepSpec = { icon: WrenIconName; label: string }

const STEP_SPECS = {
  [STEPS.previous]: { icon: WREN_ICONS.previous, label: PLAYER_COPY.previous },
  [STEPS.next]: { icon: WREN_ICONS.next, label: PLAYER_COPY.next },
} as const satisfies Record<Step, StepSpec>

type StepButtonProps = { step: Step }

/** Previous, back to the song before or the start of this one, or Next. */
function StepButton({ step }: StepButtonProps) {
  const onPress = useAudioQueue((store) => store[step])
  const { icon, label } = STEP_SPECS[step]
  return <FocusButton icon={icon} label={label} onPress={onPress} />
}

/** Shuffle, the queue's: picked while it is on. */
export function ShuffleToggle() {
  const isShuffled = useAudioQueue((store) => store.queue.isShuffled)
  const toggleShuffle = useAudioQueue((store) => store.toggleShuffle)
  return (
    <FocusButton
      icon={WREN_ICONS.shuffle}
      isSelected={isShuffled}
      label={PLAYER_COPY.shuffle}
      onPress={toggleShuffle}
    />
  )
}

/**
 * Repeat, the queue's: moving from off to all to one, named for the mode it is in, drawn with a
 * 1 while it repeats one song, and picked while it repeats at all.
 */
export function RepeatToggle() {
  const repeat = useAudioQueue((store) => store.queue.repeat)
  const cycleRepeat = useAudioQueue((store) => store.cycleRepeat)
  return (
    <FocusButton
      icon={repeatIconOf({ repeat, icons: WREN_ICONS })}
      isSelected={repeat !== REPEAT_MODES.off}
      label={PLAYER_COPY.repeat[repeat]}
      onPress={cycleRepeat}
    />
  )
}

type TransportProps = {
  /** Whether the remote starts on Play or Pause as Now Playing opens. */
  hasPreferredFocus?: boolean
}

/**
 * Previous, Play or Pause and Next, then Shuffle and Repeat at the row's end: on a TV the
 * player's one row holds the queue's toggles too, a press of right away from the transport.
 */
export function Transport({ hasPreferredFocus = false }: TransportProps) {
  const styles = useStyles()
  return (
    <View style={styles.row}>
      <StepButton step={STEPS.previous} />
      <PlayButton hasPreferredFocus={hasPreferredFocus} />
      <StepButton step={STEPS.next} />
      <View style={styles.toggles}>
        <ShuffleToggle />
        <RepeatToggle />
      </View>
    </View>
  )
}
