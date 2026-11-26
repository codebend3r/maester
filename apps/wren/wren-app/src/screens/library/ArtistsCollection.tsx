import { type Artist, type Letter, LETTERS, plural } from '@raven/core'
import { COUNTS_COPY, firstAtLetter, LIBRARY_PAGE_COPY, matchingArtists } from '@raven/wren'
import { useRef, useState } from 'react'
import { FlatList, Pressable, Text, View } from 'react-native'

import { useCovers, useAllArtists } from '@raven/wren-native'
import { CollectionHeader } from '@/screens/library/CollectionHeader'
import type { CollectionPageProps } from '@/screens/library/CollectionPage'
import { LIST_SHAPES } from '@/components/ListSkeleton'
import { ListNotice } from '@/screens/library/ListNotice'
import { useCollectionSearch } from '@/screens/library/useCollectionSearch'
import { usePageInsets } from '@/shell/useShell'
import { type WrenTheme, themedStyles } from '@/theme/wrenTheme'
import { SIZE, SPACE, TYPE } from '@/theme/wrenTokens'
import { ARTIST_CARD_HEIGHT, ArtistCard } from '@/ui/ArtistCard'
import { GRID_GAP, useGrid } from '@/ui/TileGrid'

// Every row of cards is the same height, gap included, so the rail jumps by arithmetic.
const ROW_HEIGHT = ARTIST_CARD_HEIGHT + SPACE.s3

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  page: { backgroundColor: colors.bg, flex: 1 },
  header: { paddingBottom: SPACE.s2 },
  row: { height: ROW_HEIGHT },
  columns: { gap: GRID_GAP },
  rail: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'absolute',
    right: 0,
    width: SIZE.gutter,
  },
  letter: { alignItems: 'center', flexGrow: 1, flexShrink: 1, justifyContent: 'center' },
  letterText: { ...TYPE.small, color: colors.accentText, fontFamily: TYPE.metaStrong.fontFamily },
}))

type IndexRailProps = { onLetter: (letter: Letter) => void; top: number; bottom: number }

/** The A to Z rail down the right edge: a letter jumps the list to the first artist under it. */
function IndexRail({ onLetter, top, bottom }: IndexRailProps) {
  const styles = useStyles()
  return (
    <View style={[styles.rail, { top, bottom }]}>
      {LETTERS.map((letter) => (
        <Pressable
          accessibilityLabel={LIBRARY_PAGE_COPY.jumpTo(letter)}
          accessibilityRole="button"
          hitSlop={{ left: SPACE.s3 }}
          key={letter}
          onPress={() => onLetter(letter)}
          style={styles.letter}
        >
          <Text style={styles.letterText}>{letter}</Text>
        </Pressable>
      ))}
    </View>
  )
}

/**
 * Artists: every music library's, each once, by name, as a grid of cards like raven's Artists
 * tab, with an A to Z rail to jump the grid to the row of the first card under a letter.
 */
export function ArtistsCollection({ session, onBack }: CollectionPageProps) {
  const styles = useStyles()
  const insets = usePageInsets()
  const search = useCollectionSearch({
    placeholder: LIBRARY_PAGE_COPY.searchArtists,
    none: LIBRARY_PAGE_COPY.noArtists,
  })
  const list = useRef<FlatList<Artist>>(null)
  const [headerEnd, setHeaderEnd] = useState(0)
  const { artists, listing } = useAllArtists({ session, search: '' })
  const { artistPhotoOf } = useCovers(session)
  const { columns, tileWidth, onLayout } = useGrid({ tile: SIZE.artistCard })
  const shown = matchingArtists({ artists, query: search.query })
  const count = listing.isRead ? plural({ n: shown.length, ...COUNTS_COPY.artists }) : null
  const jump = (letter: Letter) => {
    const at = firstAtLetter({ names: shown.map(({ sortName }) => sortName), letter })
    if (at === null) return
    const row = Math.floor(at / columns)
    list.current?.scrollToOffset({ offset: headerEnd + row * ROW_HEIGHT, animated: false })
  }
  return (
    <View style={styles.page}>
      <FlatList
        ListEmptyComponent={
          <ListNotice empty={search.empty} listing={listing} shape={LIST_SHAPES.tiles} />
        }
        ListHeaderComponent={
          <View
            onLayout={({ nativeEvent: { layout } }) => setHeaderEnd(layout.y + layout.height)}
            style={styles.header}
          >
            <CollectionHeader
              count={count}
              onBack={onBack}
              search={search.field}
              title={LIBRARY_PAGE_COPY.artists}
            />
          </View>
        }
        // React Native refuses a row's style on a list of one column.
        columnWrapperStyle={columns > 1 && styles.columns}
        contentContainerStyle={insets}
        data={shown}
        key={columns}
        keyExtractor={(artist) => String(artist.id)}
        keyboardDismissMode="on-drag"
        numColumns={columns}
        onLayout={onLayout}
        ref={list}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <ArtistCard artist={item} photoOf={artistPhotoOf} width={tileWidth} />
          </View>
        )}
        showsVerticalScrollIndicator={false}
      />
      {shown.length > 0 && (
        <IndexRail bottom={insets.paddingBottom} onLetter={jump} top={headerEnd} />
      )}
    </View>
  )
}
