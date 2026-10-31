import { Icon } from '@raven/native'
import type { IconName } from '@raven/ui/iconDrawings'
import { Pressable, StyleSheet, Text } from 'react-native'

import { CONTROLS_COPY } from '@/components/copy'
import { WREN_ICONS } from '@/theme/icons'
import { OPACITIES, PALETTE, SIZES } from '@/theme/wrenTheme'

type ActionButtonProps = {
  label: string
  icon: IconName
  onPress: () => void
  isPrimary?: boolean
  /** Shown but not pressable, and said as dimmed: a download on its way. */
  isDisabled?: boolean
}

/** A page's action under the thumb: Play, Shuffle, Download. */
export function ActionButton({
  label,
  icon,
  onPress,
  isPrimary = false,
  isDisabled = false,
}: ActionButtonProps) {
  const colour = isPrimary ? PALETTE.onAccent : PALETTE.text
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        isPrimary ? styles.primary : styles.quiet,
        pressed && styles.pressed,
        isDisabled && styles.disabled,
      ]}
    >
      <Icon colour={colour} name={icon} size={SIZES.text} />
      <Text style={[styles.actionLabel, { color: colour }]}>{label}</Text>
    </Pressable>
  )
}

type IconButtonProps = {
  label: string
  icon: IconName
  onPress: () => void
  /** Whether it is the control the others sit around, drawn larger and brighter: Play. */
  isProminent?: boolean
}

/** A control drawn as its icon alone, named for a screen reader by `label`. */
export function IconButton({ label, icon, onPress, isProminent = false }: IconButtonProps) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={SIZES.space1}
      onPress={onPress}
      style={({ pressed }) => [styles.icon, pressed && styles.pressed]}
    >
      <Icon
        colour={isProminent ? PALETTE.text : PALETTE.muted}
        name={icon}
        size={isProminent ? SIZES.space5 : SIZES.textLg}
      />
    </Pressable>
  )
}

type PlayButtonsProps = { onPlay: () => void; onShuffle: () => void }

/** Play and Shuffle, side by side, for an album or a playlist. */
export function PlayButtons({ onPlay, onShuffle }: PlayButtonsProps) {
  return (
    <>
      <ActionButton icon={WREN_ICONS.play} isPrimary label={CONTROLS_COPY.play} onPress={onPlay} />
      <ActionButton icon={WREN_ICONS.shuffle} label={CONTROLS_COPY.shuffle} onPress={onShuffle} />
    </>
  )
}

type ToggleButtonProps = { label: string; icon: IconName; isOn: boolean; onToggle: () => void }

/** A control drawn as its icon, on or off, bright while it is on: Favourite, Shuffle. */
export function ToggleButton({ label, icon, isOn, onToggle }: ToggleButtonProps) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="switch"
      accessibilityState={{ checked: isOn }}
      hitSlop={SIZES.space1}
      onPress={onToggle}
      style={({ pressed }) => [styles.icon, pressed && styles.pressed]}
    >
      <Icon
        colour={isOn ? PALETTE.accent : PALETTE.muted}
        isFocused={isOn}
        name={icon}
        size={SIZES.textLg}
      />
    </Pressable>
  )
}

type FavouriteToggleProps = { isOn: boolean; onToggle: () => void }

/** Whether the album or artist is one of the listener's favourites, and the switch to change it. */
export function FavouriteToggle({ isOn, onToggle }: FavouriteToggleProps) {
  return (
    <ToggleButton
      icon={WREN_ICONS.favourite}
      isOn={isOn}
      label={CONTROLS_COPY.favourite}
      onToggle={onToggle}
    />
  )
}

const styles = StyleSheet.create({
  action: {
    alignItems: 'center',
    borderRadius: SIZES.radius,
    flexDirection: 'row',
    gap: SIZES.space1,
    justifyContent: 'center',
    minHeight: SIZES.fieldHeight,
    paddingHorizontal: SIZES.space3,
  },
  primary: { backgroundColor: PALETTE.accent },
  quiet: { backgroundColor: PALETTE.quiet },
  actionLabel: { fontSize: SIZES.text, fontWeight: 'bold' },
  icon: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: SIZES.fieldHeight,
    minWidth: SIZES.fieldHeight,
  },
  pressed: { opacity: OPACITIES.pressed },
  disabled: { opacity: OPACITIES.disabled },
})
