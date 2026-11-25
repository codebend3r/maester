import { REPEAT_MODES } from '@raven/core'
import { useAudioQueue } from '@raven/ui/headless'
import { PLAYER_COPY, repeatIconOf, toggleLookOf } from '@raven/wren'
import { COLORS, SIZES } from '@/theme/tokens'
import { IconButton } from '@/ui/IconButton/IconButton'
import { ICONS, type WrenIconName } from '@/ui/WrenIcon/icons'

type QueueToggleProps = { isOn: boolean; icon: WrenIconName; label: string; onPress: () => void }

/** A toggle in Up next's head: red on a soft red circle while on, quiet while off. */
function QueueToggle({ isOn, icon, label, onPress }: QueueToggleProps) {
  return (
    <IconButton
      {...toggleLookOf({ isOn, colors: COLORS })}
      icon={icon}
      isSelected={isOn}
      label={label}
      onPress={onPress}
      size={SIZES.toggleCircle}
    />
  )
}

/** Shuffle, the queue's. */
export function ShuffleToggle() {
  const isShuffled = useAudioQueue((store) => store.queue.isShuffled)
  const toggleShuffle = useAudioQueue((store) => store.toggleShuffle)
  return (
    <QueueToggle
      icon={ICONS.shuffle}
      isOn={isShuffled}
      label={PLAYER_COPY.shuffle}
      onPress={toggleShuffle}
    />
  )
}

/**
 * Repeat, the queue's: moving from off to all to one, named for the mode it is in, and drawn
 * with a 1 while it repeats one song.
 */
export function RepeatToggle() {
  const repeat = useAudioQueue((store) => store.queue.repeat)
  const cycleRepeat = useAudioQueue((store) => store.cycleRepeat)
  return (
    <QueueToggle
      icon={repeatIconOf({ repeat, icons: ICONS })}
      isOn={repeat !== REPEAT_MODES.off}
      label={PLAYER_COPY.repeat[repeat]}
      onPress={cycleRepeat}
    />
  )
}
