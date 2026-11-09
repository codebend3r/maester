import { Pressable, ScrollView, StyleSheet } from 'react-native'

import { type CardMenuOption, isOptionBlocked, readingNoteOf } from '@/cardMenu/menuOptions'
import {
  type CardMenuKit,
  type CardMenuViewProps,
  type ReadingMenuProps,
} from '@/layouts/cardMenuKit'
import { Text } from '@/layouts/Text'
import { LINE_RATIO } from '@/layouts/textHeights'
import { TvSheet, useSheetStyles } from '@/layouts/TvSheet.focus'
import { usePlateStyles } from '@/layouts/tvControls'
import { OPACITIES } from '@/theme/appTheme'
import { TV_SIZES } from '@/theme/tvSizes'
import { themedStyles } from '@/theme/useTheme'
import { CAN_DOWNLOAD } from '@/layouts/downloadKind'

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
const CardMenuList = ({ title, options, note, onClose }: CardMenuListProps) => {
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

/** The menu once its title is read: its options, each a line. */
const CardMenuView = ({ title, options, onClose }: CardMenuViewProps) => (
  <CardMenuList note={null} onClose={onClose} options={options} title={title} />
)

/** The menu while its title is read, or once the read failed: the title and a line, no marks. */
const ReadingMenu = ({ title, isFailed, onClose }: ReadingMenuProps) => (
  <CardMenuList note={readingNoteOf(isFailed)} onClose={onClose} options={[]} title={title} />
)

/** A card's menu on a TV: a sheet the remote moves through, with no Download, as the TVs' downloads kit has none. */
export const focusCardMenu: CardMenuKit = {
  CardMenuView,
  ReadingMenu,
  canDownload: CAN_DOWNLOAD.focus,
}

const useStyles = themedStyles((colours) =>
  StyleSheet.create({
    note: { color: colours.muted, fontSize: TV_SIZES.text, lineHeight: TV_SIZES.text * LINE_RATIO },
    blocked: { opacity: OPACITIES.disabled },
  }),
)
