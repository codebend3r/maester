import { type ReactNode } from 'react'
import { Modal, ScrollView, Text, View } from 'react-native'

import { RADIUS, SIZE, SPACE, TYPE } from '@/theme/tvTokens'
import { themedStyles } from '@/theme/wrenTheme'

const useStyles = themedStyles(({ colors }) => ({
  scrim: {
    alignItems: 'center',
    backgroundColor: colors.scrim,
    flex: 1,
    justifyContent: 'center',
  },
  sheet: {
    backgroundColor: colors.raised,
    borderRadius: RADIUS.card,
    gap: SPACE.s3,
    maxHeight: '86%',
    padding: SPACE.s6,
    width: SIZE.sheetWidth,
  },
  title: { ...TYPE.section, color: colors.text },
  line: { ...TYPE.meta, color: colors.text2 },
  body: { gap: SPACE.s2 },
}))

type SheetProps = {
  title: string
  /** A quiet line under the title: the song's artists. */
  line?: string | null
  isOpen: boolean
  /** Back on Android TV and Menu on Apple TV close it, as a press of a choice usually does. */
  onClose: () => void
  children: ReactNode
}

/**
 * The TV's sheet: a panel in the middle of the screen over the theme's scrim, holding a song's
 * menu, a list's choices or a form, where the phone raises one from the foot. The remote stays
 * inside it until it closes.
 */
export function Sheet({ title, line = null, isOpen, onClose, children }: SheetProps) {
  const styles = useStyles()
  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={isOpen}>
      <View style={styles.scrim}>
        <View accessibilityViewIsModal style={styles.sheet}>
          <Text accessibilityRole="header" style={styles.title}>
            {title}
          </Text>
          {line !== null && <Text style={styles.line}>{line}</Text>}
          <ScrollView contentContainerStyle={styles.body}>{children}</ScrollView>
        </View>
      </View>
    </Modal>
  )
}
