import { type Artist, plural } from '@raven/core'
import {
  COUNTS_COPY,
  firstAtLetter,
  INDEX_LETTERS,
  LIBRARY_PAGE_COPY,
  matchingArtists,
} from '@raven/wren'
import { useRouter } from 'expo-router'
import { useRef, useState } from 'react'
import { FlatList, Pressable, Text, View } from 'react-native'

import { useCovers } from '@/music/useCovers'
import { CollectionHeader } from '@/screens/library/CollectionHeader'
import type { CollectionPageProps } from '@/screens/library/CollectionPage'
import { useAllArtists } from '@/screens/library/listings'
import { ListNotice } from '@/screens/library/ListNotice'
import { useCollectionSearch } from '@/screens/library/useCollectionSearch'
import { WREN_PAGES, pageHref } from '@/routes'
import { usePageInsets } from '@/shell/useShell'
import { type WrenTheme, themedStyles } from '@/theme/wrenTheme'
import { SIZE, SPACE, TYPE } from '@/theme/wrenTokens'
import { ArtistRow } from '@/ui/ArtistRow'

// Every row is the same height, so the rail jumps by arithmetic rather than by measuring.
const ROW_HEIGHT = SIZE.artistRow + SIZE.hairline

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  page: { backgroundColor: colors.bg, flex: 1 },
  header: { paddingBottom: SPACE.s2 },
  row: { height: ROW_HEIGHT, justifyContent: 'center' },
  divider: {
    backgroundColor: colors.line,
    bottom: 0,
    height: SIZE.hairline,
    left: SIZE.avatar + SPACE.s4,
    position: 'absolute',
    right: 0,
  },
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

type IndexRailProps = { onLetter: (letter: string) => void; top: number; bottom: number }

/** The A to Z rail down the right edge: a letter jumps the list to the first artist under it. */
function IndexRail({ onLetter, top, bottom }: IndexRailProps) {
  const styles = useStyles()
  return (
    <View style={[styles.rail, { top, bottom }]}>
      {INDEX_LETTERS.map((letter) => (
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

/** Artists: every music library's, each once, by name, with an A to Z rail to jump the list. */
export function ArtistsCollection({ session, onBack }: CollectionPageProps) {
  const styles = useStyles()
  const router = useRouter()
  const insets = usePageInsets()
  const search = useCollectionSearch({
    placeholder: LIBRARY_PAGE_COPY.searchArtists,
    none: LIBRARY_PAGE_COPY.noArtists,
  })
  const list = useRef<FlatList<Artist>>(null)
  const [headerEnd, setHeaderEnd] = useState(0)
  const { artists, listing } = useAllArtists({ session, search: '' })
  const { artistPhotoOf } = useCovers(session)
  const shown = matchingArtists({ artists, query: search.query })
  const count = listing.isRead ? plural({ n: shown.length, ...COUNTS_COPY.artists }) : null
  const jump = (letter: string) => {
    const at = firstAtLetter({ names: shown.map(({ sortName }) => sortName), letter })
    if (at === null) return
    list.current?.scrollToOffset({ offset: headerEnd + at * ROW_HEIGHT, animated: false })
  }
  return (
    <View style={styles.page}>
      <FlatList
        ListEmptyComponent={<ListNotice empty={search.empty} listing={listing} />}
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
        contentContainerStyle={insets}
        data={shown}
        keyExtractor={(artist) => String(artist.id)}
        keyboardDismissMode="on-drag"
        ref={list}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <ArtistRow
              albumCount={item.albumCount}
              name={item.name}
              onPress={() => router.push(pageHref({ page: WREN_PAGES.artist, id: item.id }))}
              picture={artistPhotoOf(item)}
              trackCount={item.trackCount}
            />
            <View style={styles.divider} />
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
