import { Icon } from '@raven/native'
import type { IconName } from '@raven/ui/iconDrawings'
import { Pressable, StyleSheet, Text } from 'react-native'

import { WREN_ICONS } from '@/theme/icons'
import { OPACITIES, PALETTE, SIZES } from '@/theme/wrenTheme'

type ActionButtonProps = {
  label: string
  icon: IconName
  onPress: () => void
  isPrimary?: boolean
}

/** A page's action under the thumb: Play, Shuffle. */
function ActionButton({ label, icon, onPress, isPrimary = false }: ActionButtonProps) {
  const colour = isPrimary ? PALETTE.onAccent : PALETTE.text
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        isPrimary ? styles.primary : styles.quiet,
        pressed && styles.pressed,
      ]}
    >
      <Icon colour={colour} name={icon} size={SIZES.text} />
      <Text style={[styles.actionLabel, { color: colour }]}>{label}</Text>
    </Pressable>
  )
}

type IconButtonProps = { label: string; icon: IconName; onPress: () => void }

/** A control drawn as its icon alone, named for a screen reader by `label`. */
export function IconButton({ label, icon, onPress }: IconButtonProps) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={SIZES.space1}
      onPress={onPress}
      style={({ pressed }) => [styles.icon, pressed && styles.pressed]}
    >
      <Icon colour={PALETTE.muted} name={icon} size={SIZES.textLg} />
    </Pressable>
  )
}

const PLAY_COPY = { play: 'Play', shuffle: 'Shuffle' } as const

type PlayButtonsProps = { onPlay: () => void; onShuffle: () => void }

/** Play and Shuffle, side by side, for an album or a playlist. */
export function PlayButtons({ onPlay, onShuffle }: PlayButtonsProps) {
  return (
    <>
      <ActionButton icon={WREN_ICONS.play} isPrimary label={PLAY_COPY.play} onPress={onPlay} />
      <ActionButton icon={WREN_ICONS.shuffle} label={PLAY_COPY.shuffle} onPress={onShuffle} />
    </>
  )
}

const FAVOURITE = 'Favourite'

type FavouriteToggleProps = { isOn: boolean; onToggle: () => void }

/** Whether the album or artist is one of the listener's favourites, and the switch to change it. */
export function FavouriteToggle({ isOn, onToggle }: FavouriteToggleProps) {
  return (
    <Pressable
      accessibilityLabel={FAVOURITE}
      accessibilityRole="switch"
      accessibilityState={{ checked: isOn }}
      hitSlop={SIZES.space1}
      onPress={onToggle}
      style={({ pressed }) => [styles.icon, pressed && styles.pressed]}
    >
      <Icon
        colour={isOn ? PALETTE.accent : PALETTE.muted}
        isFocused={isOn}
        name={WREN_ICONS.favourite}
        size={SIZES.textLg}
      />
    </Pressable>
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
})
