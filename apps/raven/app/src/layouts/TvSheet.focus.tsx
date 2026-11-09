import type { ReactNode } from 'react'
import { Modal, StyleSheet, View } from 'react-native'

import { Text, TEXT_VARIANTS } from '@/layouts/Text'
import { LINE_RATIO } from '@/layouts/textHeights'
import { TV_SIZES } from '@/theme/tvSizes'
import { themedStyles } from '@/theme/useTheme'

type TvSheetProps = {
  title: string
  isOverPicture?: boolean
  /** Menu or Back, which close the sheet without choosing. */
  onClose: () => void
  children: ReactNode
}

/**
 * A sheet a TV opens over the screen in place of an action sheet, which tvOS has none of: a
 * panel on a scrim with a title, holding the rows the remote moves through. Over the video it is
 * the player's dark glass in every theme. Menu or Back closes it.
 */
export const TvSheet = ({ title, isOverPicture = false, onClose, children }: TvSheetProps) => {
  const styles = useSheetStyles({ isOverPicture })
  return (
    <Modal transparent visible onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.shade} />
        <View accessibilityLabel={title} style={styles.panel}>
          <Text
            variant={TEXT_VARIANTS.display}
            accessibilityRole="header"
            numberOfLines={2}
            style={styles.title}
          >
            {title}
          </Text>
          {children}
        </View>
      </View>
    </Modal>
  )
}

/** The sheet's own styles, and the row styles its lists share: `options`, `option`, `focused`. */
export const useSheetStyles = themedStyles((colours) =>
  StyleSheet.create({
    backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    // The web's `--color-scrim` is a translucent black React Native's tokens cannot carry.
    shade: { ...StyleSheet.absoluteFill, backgroundColor: colours.deep, opacity: 0.85 },
    panel: {
      minWidth: TV_SIZES.measure / 2,
      maxWidth: TV_SIZES.measure,
      maxHeight: '80%',
      gap: TV_SIZES.space3,
      padding: TV_SIZES.space5,
      borderRadius: TV_SIZES.radius,
      backgroundColor: colours.raised,
    },
    title: {
      color: colours.text,
      fontSize: TV_SIZES.textXl,
      lineHeight: TV_SIZES.textXl * LINE_RATIO,
      fontWeight: 'bold',
    },
    options: { gap: TV_SIZES.space1 },
    option: {
      minHeight: TV_SIZES.controlLarge,
      justifyContent: 'center',
      gap: TV_SIZES.space0,
      paddingVertical: TV_SIZES.space2,
      paddingHorizontal: TV_SIZES.space3,
      borderRadius: TV_SIZES.radius,
      borderWidth: TV_SIZES.tvFocusRing,
      borderColor: 'transparent',
    },
    focused: { borderColor: colours.text },
  }),
)
