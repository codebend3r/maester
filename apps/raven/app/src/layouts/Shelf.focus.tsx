import { type ComponentRef, useRef } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import type { ShelfCard } from '@/queries/cards'
import type { ShelfView } from '@/queries/homeShelves'

import { FocusBand } from '@/layouts/FocusBand'
import { focusCardWidthOf, FocusCard } from '@/layouts/FocusCard'
import { useOpenerFocus, useOpeningFocus, useScreenFocusScope } from '@/layouts/focus'
import {
  NOTHING_HERE,
  SEARCH_EVERY_LIBRARY,
  SEE_ALL,
  SETTINGS_ENTRY,
  type ShelfKit,
  type ShelfProps,
  type ShelvesProps,
  seeAllLabelOf,
} from '@/layouts/shelfKit'
import { PlateButton, plateStyles } from '@/layouts/tvControls'
import { COLOURS } from '@/theme/appTheme'
import { TV_SIZES } from '@/theme/tvSizes'

/** Where the Settings entry sits on Home, a place no shelf's card shares. */
const SETTINGS_PLACE = 'settings'

/**
 * The way into Settings, which takes the remote's focus back when Settings goes, as a card does
 * for the screen it opened: Android TV restores nothing on its own.
 */
const SettingsEntry = ({ onPress, onFocused }: { onPress: () => void; onFocused: () => void }) => {
  const view = useRef<ComponentRef<typeof Pressable>>(null)
  const { remember } = useOpenerFocus({ place: SETTINGS_PLACE, view })
  return (
    <Pressable
      ref={view}
      accessibilityLabel={SETTINGS_ENTRY.label}
      accessibilityRole="link"
      onFocus={onFocused}
      onPress={() => {
        remember()
        onPress()
      }}
      style={({ focused }) => [plateStyles.plate, focused && plateStyles.focused]}
    >
      <Text style={plateStyles.label}>{SETTINGS_ENTRY.label}</Text>
    </Pressable>
  )
}

/**
 * Home's shelves under its title and, beside it, the ways into the search and Settings. Those
 * are drawn only once the shelves are read, with them: drawn alone, they would be all tvOS had
 * to give the opening focus to, which belongs to the first card. Anything here taking the focus
 * spends the opening focus, so a shelf drawn later never pulls the focus back.
 */
const Shelves = ({ title, notice, isLoading, onSearch, onSettings, children }: ShelvesProps) => {
  const { settle } = useScreenFocusScope()
  return (
    <ScrollView contentContainerStyle={styles.shelves} style={styles.ground}>
      <View style={styles.pageRow}>
        <Text accessibilityRole="header" style={styles.pageTitle}>
          {title}
        </Text>
        {!isLoading && (
          <>
            <PlateButton
              label={SEARCH_EVERY_LIBRARY.label}
              onFocused={settle}
              onPress={onSearch}
              accessibilityRole="link"
              text={SEARCH_EVERY_LIBRARY.text}
            />
            <SettingsEntry onFocused={settle} onPress={onSettings} />
          </>
        )}
      </View>
      {notice !== null && <Text style={styles.notice}>{notice}</Text>}
      {children}
    </ScrollView>
  )
}

/**
 * A shelf's title, and after a library's the way into the library, which the remote reaches
 * above the row, as the web's shelf heading links to it.
 */
const ShelfTitle = ({
  shelf,
  onOpenLibrary,
  onFocused,
}: Pick<ShelfProps, 'shelf' | 'onOpenLibrary'> & { onFocused: () => void }) => {
  const { libraryId } = shelf
  return (
    <View style={styles.titleRow}>
      <Text accessibilityRole="header" style={styles.shelfTitle}>
        {shelf.title}
      </Text>
      {libraryId !== null && (
        <Pressable
          accessibilityLabel={seeAllLabelOf(shelf.title)}
          accessibilityRole="link"
          onFocus={onFocused}
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

/** Where a card sits on its screen: one title can sit on two shelves, as Continue watching's do. */
const placeOf = ({ shelf, card }: { shelf: ShelfView; card: ShelfCard }): string =>
  `${shelf.key}/${card.key}`

/**
 * A shelf the remote moves along: its title, then one row, scrolled as focus moves. The row is a
 * band the width of the screen, so the remote coming down or up into it from anywhere lands on
 * a card: the first, or the one it last left there.
 */
const Shelf = ({ shelf, onOpen, onOpenLibrary, isFirst = false }: ShelfProps) => {
  const { isOpening, settle } = useOpeningFocus()
  return (
    <View style={styles.shelf}>
      <ShelfTitle onFocused={settle} onOpenLibrary={onOpenLibrary} shelf={shelf} />
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
                onFocused={settle}
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

const styles = StyleSheet.create({
  ground: { flex: 1, backgroundColor: COLOURS.ground },
  shelves: { gap: TV_SIZES.space4, paddingVertical: TV_SIZES.space6 },
  pageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: TV_SIZES.space5,
    paddingHorizontal: TV_SIZES.space8,
  },
  pageTitle: { color: COLOURS.text, fontSize: TV_SIZES.textXl, fontWeight: 'bold' },
  notice: { color: COLOURS.muted, fontSize: TV_SIZES.textLg, paddingHorizontal: TV_SIZES.space8 },
  shelf: { gap: TV_SIZES.space1 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: TV_SIZES.space3,
    paddingHorizontal: TV_SIZES.space8,
  },
  shelfTitle: { color: COLOURS.text, fontSize: TV_SIZES.textXl, fontWeight: 'bold' },
  seeAll: {
    paddingHorizontal: TV_SIZES.space2,
    paddingVertical: TV_SIZES.space0,
    borderRadius: TV_SIZES.radius,
    borderWidth: TV_SIZES.tvFocusRing,
    borderColor: 'transparent',
  },
  focusedLink: { borderColor: COLOURS.text, backgroundColor: COLOURS.quiet },
  seeAllLabel: { color: COLOURS.muted, fontSize: TV_SIZES.textLg, fontWeight: '600' },
  focusedLabel: { color: COLOURS.text },
  row: {
    gap: TV_SIZES.space5,
    paddingHorizontal: TV_SIZES.space8,
    paddingVertical: TV_SIZES.space4,
  },
})
