import { Pressable, ScrollView, StyleSheet } from 'react-native'

import { type CardMenuOption, isOptionBlocked } from '@/cardMenu/menuOptions'
import { Text } from '@/layouts/Text'
import { LINE_RATIO } from '@/layouts/textHeights'
import { TvSheet, useSheetStyles } from '@/layouts/TvSheet.focus'
import { usePlateStyles } from '@/layouts/tvControls'
import { OPACITIES } from '@/theme/appTheme'
import { TV_SIZES } from '@/theme/tvSizes'
import { themedStyles } from '@/theme/useTheme'

type CardMenuListProps = {
  title: string
  options: readonly CardMenuOption[]
  /** A line under the title in place of the marks: while the title is read, or why there are none. */
  note: string | null
  onClose: () => void
}

/**
 * The menu a held select opens over a card on a TV: the card's title, then each mark the remote
 * moves through, the first focused. A mark that is blocked now is drawn faint with why under it,
 * and still takes the focus so the why can be read. Choosing a mark makes it and closes the menu.
 */
export const CardMenuList = ({ title, options, note, onClose }: CardMenuListProps) => {
  const sheetStyles = useSheetStyles()
  const plateStyles = usePlateStyles()
  const styles = useStyles()
  return (
    <TvSheet onClose={onClose} title={title}>
      {note !== null && <Text style={styles.note}>{note}</Text>}
      <ScrollView contentContainerStyle={sheetStyles.options}>
        {options.map((option, index) => {
          const isBlocked = isOptionBlocked(option)
          return (
            <Pressable
              key={option.key}
              accessibilityHint={option.blockedBy ?? undefined}
              accessibilityLabel={option.label}
              accessibilityRole="button"
              accessibilityState={{ disabled: isBlocked }}
              hasTVPreferredFocus={index === 0}
              onPress={() => {
                if (isBlocked) return
                option.onPress()
                onClose()
              }}
              style={({ focused }) => [
                sheetStyles.option,
                isBlocked && styles.blocked,
                focused && sheetStyles.focused,
              ]}
            >
              <Text style={plateStyles.label}>{option.label}</Text>
              {option.blockedBy !== null && <Text style={styles.note}>{option.blockedBy}</Text>}
            </Pressable>
          )
        })}
      </ScrollView>
    </TvSheet>
  )
}

const useStyles = themedStyles((colours) =>
  StyleSheet.create({
    note: { color: colours.muted, fontSize: TV_SIZES.text, lineHeight: TV_SIZES.text * LINE_RATIO },
    blocked: { opacity: OPACITIES.disabled },
  }),
)
