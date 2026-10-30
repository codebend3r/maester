import { Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { Text } from '@/layouts/Text'
import type { ShelfCard } from '@/queries/cards'
import type { ShelfView } from '@/queries/homeShelves'

import { FocusBand } from '@/layouts/FocusBand'
import { focusCardWidthOf, FocusCard } from '@/layouts/FocusCard'
import { useOpeningFocus, useScreenFocusScope } from '@/layouts/focus'
import {
  NOTHING_HERE,
  SEE_ALL,
  type ShelfKit,
  type ShelfProps,
  type ShelvesProps,
  seeAllLabelOf,
} from '@/layouts/shelfKit'
import { Logo } from '@/layouts/Logo'
import { SideMenu } from '@/layouts/SideMenu.focus'
import { TV_GUTTER, TV_SIZES } from '@/theme/tvSizes'
import { themedStyles } from '@/theme/useTheme'

/**
 * Home's shelves under its title, with the side menu beside them. Home draws them only once the
 * shelves are read, so the menu never stands alone as all tvOS has to give the opening focus to,
 * which belongs to the first card. Anything here taking the focus spends the opening focus, so a
 * shelf drawn later never pulls the focus back.
 */
const Shelves = ({
  title,
  notice,
  onSearch,
  onSettings,
  libraries,
  onOpenLibrary,
  children,
}: ShelvesProps) => {
  // Home's hold on its screen's focus; the menu's rows and the shelves' cards spend the opening focus themselves.
  useScreenFocusScope()
  const styles = useStyles()
  return (
    <View style={styles.screen}>
      <SideMenu
        libraries={libraries}
        onOpenLibrary={onOpenLibrary}
        onSearch={onSearch}
        onSettings={onSettings}
      />
      <ScrollView contentContainerStyle={styles.shelves} style={styles.ground}>
        <View style={styles.pageRow}>
          <Logo width={TV_SIZES.textXl} />
          <Text accessibilityRole="header" style={styles.pageTitle}>
            {title}
          </Text>
        </View>
        {notice !== null && <Text style={styles.notice}>{notice}</Text>}
        {children}
      </ScrollView>
    </View>
  )
}

type ShelfTitleProps = Pick<ShelfProps, 'shelf' | 'onOpenLibrary'>

/**
 * A shelf's title, and after a library's the way into the library, which the remote reaches
 * above the row, as the web's shelf heading links to it.
 */
const ShelfTitle = ({ shelf, onOpenLibrary }: ShelfTitleProps) => {
  const { libraryId } = shelf
  const { settle } = useOpeningFocus()
  const styles = useStyles()
  return (
    <View style={styles.titleRow}>
      <Text accessibilityRole="header" style={styles.shelfTitle}>
        {shelf.title}
      </Text>
      {libraryId !== null && (
        <Pressable
          accessibilityLabel={seeAllLabelOf(shelf.title)}
          accessibilityRole="link"
          onFocus={settle}
          onPress={() => onOpenLibrary(libraryId)}
          style={({ focused }) => [styles.seeAll, focused && styles.focusedLink]}
        >
          {({ focused }) => (
            <Text style={[styles.seeAllLabel, focused === true && styles.focusedLabel]}>
              {SEE_ALL}
            </Text>
          )}
        </Pressable>
      )}
    </View>
  )
}

type PlaceOfProps = { shelf: ShelfView; card: ShelfCard }

/** Where a card sits on its screen: one title can sit on two shelves, as Continue watching's do. */
const placeOf = ({ shelf, card }: PlaceOfProps): string => `${shelf.key}/${card.key}`

/**
 * A shelf the remote moves along: its title, then one row, scrolled as focus moves. The row is a
 * band the width of the screen, so the remote coming down or up into it from anywhere lands on
 * a card: the first, or the one it last left there.
 */
const Shelf = ({ shelf, onOpen, onOpenLibrary, isFirst = false }: ShelfProps) => {
  const { isOpening } = useOpeningFocus()
  const styles = useStyles()
  return (
    <View style={styles.shelf}>
      <ShelfTitle onOpenLibrary={onOpenLibrary} shelf={shelf} />
      {shelf.cards.length === 0 ? (
        <Text style={styles.notice}>{NOTHING_HERE}</Text>
      ) : (
        <FocusBand>
          <ScrollView
            contentContainerStyle={styles.row}
            horizontal
            showsHorizontalScrollIndicator={false}
          >
            {shelf.cards.map((card, index) => (
              <FocusCard
                key={card.key}
                card={card}
                isPreferred={isOpening && isFirst && index === 0}
                onPress={() => onOpen(card)}
                place={placeOf({ shelf, card })}
                width={focusCardWidthOf(card.shape)}
              />
            ))}
          </ScrollView>
        </FocusBand>
      )}
    </View>
  )
}

/**
 * Home on a TV: shelves down the screen, each a row the remote moves along, never the touch
 * layout made larger. The rows run to the screen's edges, past the title-safe margin the
 * titles keep, and leave room above and below for a card grown by focus.
 */
export const focusShelf: ShelfKit = { Shelves, Shelf }

const useStyles = themedStyles((colours) =>
  StyleSheet.create({
    screen: { flex: 1, flexDirection: 'row', backgroundColor: colours.ground },
    ground: { flex: 1, backgroundColor: colours.ground },
    shelves: { gap: TV_SIZES.space4, paddingVertical: TV_SIZES.space6 },
    pageRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TV_SIZES.space5,
      paddingHorizontal: TV_GUTTER,
    },
    pageTitle: { color: colours.text, fontSize: TV_SIZES.textXl, fontWeight: 'bold' },
    notice: { color: colours.muted, fontSize: TV_SIZES.textLg, paddingHorizontal: TV_GUTTER },
    shelf: { gap: TV_SIZES.space1 },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TV_SIZES.space3,
      paddingHorizontal: TV_GUTTER,
    },
    shelfTitle: { color: colours.text, fontSize: TV_SIZES.textXl, fontWeight: 'bold' },
    seeAll: {
      paddingHorizontal: TV_SIZES.space2,
      paddingVertical: TV_SIZES.space0,
      borderRadius: TV_SIZES.radius,
      borderWidth: TV_SIZES.tvFocusRing,
      borderColor: 'transparent',
    },
    focusedLink: { borderColor: colours.text, backgroundColor: colours.quiet },
    seeAllLabel: { color: colours.muted, fontSize: TV_SIZES.textLg, fontWeight: '600' },
    focusedLabel: { color: colours.text },
    row: {
      gap: TV_SIZES.space5,
      paddingHorizontal: TV_GUTTER,
      paddingVertical: TV_SIZES.space4,
    },
  }),
)
