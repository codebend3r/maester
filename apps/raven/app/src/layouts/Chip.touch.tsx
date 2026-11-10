import { Icon } from '@raven/native'
import type { IconName } from '@raven/ui/iconDrawings'
import type { ComponentRef, Ref } from 'react'
import { Pressable, StyleSheet, type View } from 'react-native'

import { Text } from '@/layouts/Text'
import { OPACITIES, SIZES } from '@/theme/appTheme'
import { themedStyles, useTheme } from '@/theme/useTheme'

export type ChipProps = {
  icon: IconName
  /** What it says aloud, whatever words it shows. */
  label: string
  /** The words it shows beside the icon, or null for the icon alone in a square a finger wide. */
  text: string | null
  /** A muted word before `text`, a picker's "Sort"; drawn only with `text`. */
  lead?: string | null
  /** Filled in the accent, its words and icon in the on-accent colour: a mark that is on. */
  isOn?: boolean
  /** Drawn faint, its press doing nothing. */
  isDisabled?: boolean
  /** Drawn over the video: the player's dark glass in every theme. */
  isOverPicture?: boolean
  onPress: () => void
  /** The chip's view, for a sheet that points at it. */
  ref?: Ref<ComponentRef<typeof View>>
}

/**
 * A toolbar chip under the thumb: an icon, and words beside it where it has any. One look for
 * every chip, so a picker, a tool button, a favourite mark and a download read as one row.
 */
export const Chip = ({
  icon,
  label,
  text,
  lead = null,
  isOn = false,
  isDisabled = false,
  isOverPicture = false,
  onPress,
  ref,
}: ChipProps) => {
  const styles = useChipStyles({ isOverPicture })
  const palette = useTheme((theme) => (isOverPicture ? theme.overPicture : theme.palette))
  return (
    <Pressable
      ref={ref}
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ selected: isOn, disabled: isDisabled }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        text === null && styles.square,
        isOn && styles.on,
        isDisabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Icon colour={isOn ? palette.onAccent : palette.text} name={icon} size={SIZES.text} />
      {text !== null && lead !== null && <Text style={styles.lead}>{lead}</Text>}
      {text !== null && <Text style={[styles.text, isOn && styles.textOn]}>{text}</Text>}
    </Pressable>
  )
}

/** The chip's look, on the page or over the video. */
const useChipStyles = themedStyles((colours) =>
  StyleSheet.create({
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SIZES.space1,
      minHeight: SIZES.fieldHeight,
      paddingHorizontal: SIZES.space2,
      borderRadius: SIZES.radius,
      backgroundColor: colours.quiet,
    },
    // An icon-only chip is a square the icon sits in the middle of.
    square: { minWidth: SIZES.fieldHeight, paddingHorizontal: 0, justifyContent: 'center' },
    on: { backgroundColor: colours.accent },
    disabled: { opacity: OPACITIES.disabled },
    pressed: { opacity: OPACITIES.pressed },
    lead: { color: colours.muted, fontSize: SIZES.textSm },
    text: { color: colours.text, fontSize: SIZES.textSm, fontWeight: '600' },
    textOn: { color: colours.onAccent },
  }),
)
