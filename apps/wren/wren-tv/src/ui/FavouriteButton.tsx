import { FocusButton } from '@/ui/FocusButton'
import { FOCUS_ROLES } from '@/ui/Focusable'
import { ICONS } from '@/ui/WrenIcon'

type FavouriteButtonProps = { label: string; isOn: boolean; onToggle: () => void }

/**
 * A heart, filled while it is a favourite, read as a switch: an album's Like, an artist's Follow,
 * and the playing song's heart on Now Playing.
 */
export function FavouriteButton({ label, isOn, onToggle }: FavouriteButtonProps) {
  return (
    <FocusButton
      icon={isOn ? ICONS.heartFilled : ICONS.heart}
      isSelected={isOn}
      label={label}
      onPress={onToggle}
      role={FOCUS_ROLES.switch}
    />
  )
}
