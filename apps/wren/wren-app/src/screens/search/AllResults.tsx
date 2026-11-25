import {
  ALBUMS_IN_ALL,
  FILTER_LABELS,
  SEARCH_FILTERS,
  SONGS_IN_ALL,
  type SearchFilter,
  topResultOf,
} from '@raven/wren'
import type { ComponentType, ReactNode } from 'react'
import { ScrollView, type StyleProp, View, type ViewStyle } from 'react-native'

import {
  ALBUM_COLUMNS,
  ArtistCircles,
  type ResultsProps,
  TopResultCard,
} from '@/screens/search/ResultParts'
import { FoundArtist, FoundSong } from '@/screens/search/ResultRows'
import { type WrenTheme, themedStyles, useFormFactor } from '@/theme/wrenTheme'
import { FORM_FACTORS, type FormFactor, SPACE } from '@/theme/wrenTokens'
import { AlbumTileOf } from '@/ui/AlbumTile'
import { SectionHeader } from '@/ui/SectionHeader'
import { Shelf } from '@/ui/Shelf'
import { TileGrid } from '@/ui/TileGrid'

// A tablet's All: the songs and albums take this share of the width, the artists the rest.
const TABLET_MAIN_SHARE = 1.4 / 2.4

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  scroller: { backgroundColor: colors.bg, flex: 1 },
  sections: { gap: SPACE.s6 },
  section: { gap: SPACE.s3 },
  columns: { flexDirection: 'row', gap: SPACE.s8 },
  main: { flex: TABLET_MAIN_SHARE, gap: SPACE.s6 },
  side: { flex: 1 - TABLET_MAIN_SHARE },
}))

type ResultSectionProps = Pick<ResultsProps, 'onFilter'> & {
  /** The kind this section shows the start of: its title, and what its See all narrows to. */
  filter: SearchFilter
  /** How many of that kind were found; none, and the section is not drawn. */
  count: number
  /** The room under the heading; rows bring their own height and take none. */
  style?: StyleProp<ViewStyle>
  children: ReactNode
}

/** One kind of result in All: its title, See all, and the start of what was found. */
function ResultSection({ filter, count, onFilter, style, children }: ResultSectionProps) {
  return (
    count > 0 && (
      <View style={style}>
        <SectionHeader onSeeAll={() => onFilter(filter)} title={FILTER_LABELS[filter]} />
        {children}
      </View>
    )
  )
}

type SongsSectionProps = Pick<ResultsProps, 'results' | 'onFilter' | 'covers' | 'actions'> & {
  /** How many of the songs All shows; See all opens the rest. */
  shown: number
}

/** All's songs: the first few found, and See all. */
function SongsSection({ results, onFilter, covers, actions, shown }: SongsSectionProps) {
  const { songs } = results
  return (
    <ResultSection count={songs.length} filter={SEARCH_FILTERS.songs} onFilter={onFilter}>
      {songs.slice(0, shown).map((track, index) => (
        <FoundSong
          actions={actions}
          covers={covers}
          index={index}
          key={track.id}
          track={track}
          tracks={songs}
        />
      ))}
    </ResultSection>
  )
}

/** What a search found, as All shows it on a phone: the top result, then each kind in turn. */
function PhoneAll({ results, query, onFilter, covers, actions, contentStyle }: ResultsProps) {
  const styles = useStyles()
  const { albums, artists, songs } = results
  const top = topResultOf({ query, albums, artists, songs })
  return (
    <ScrollView
      contentContainerStyle={[contentStyle, styles.sections]}
      keyboardShouldPersistTaps="handled"
      style={styles.scroller}
    >
      {top !== null && (
        <TopResultCard actions={actions} covers={covers} result={top} songs={songs} />
      )}
      <ResultSection
        count={albums.length}
        filter={SEARCH_FILTERS.albums}
        onFilter={onFilter}
        style={styles.section}
      >
        <Shelf albums={albums} coverOf={covers.coverOf} onOpen={actions.openAlbum} />
      </ResultSection>
      <ResultSection
        count={artists.length}
        filter={SEARCH_FILTERS.artists}
        onFilter={onFilter}
        style={styles.section}
      >
        <ArtistCircles actions={actions} artists={artists} covers={covers} />
      </ResultSection>
      <SongsSection
        actions={actions}
        covers={covers}
        onFilter={onFilter}
        results={results}
        shown={SONGS_IN_ALL[FORM_FACTORS.phone]}
      />
    </ScrollView>
  )
}

/** All on a tablet: the songs and albums on the left, the artists on the right. */
function TabletAll({ results, onFilter, covers, actions, contentStyle }: ResultsProps) {
  const styles = useStyles()
  const { albums, artists } = results
  return (
    <ScrollView
      contentContainerStyle={contentStyle}
      keyboardShouldPersistTaps="handled"
      style={styles.scroller}
    >
      <View style={styles.columns}>
        <View style={styles.main}>
          <SongsSection
            actions={actions}
            covers={covers}
            onFilter={onFilter}
            results={results}
            shown={SONGS_IN_ALL[FORM_FACTORS.tablet]}
          />
          <ResultSection
            count={albums.length}
            filter={SEARCH_FILTERS.albums}
            onFilter={onFilter}
            style={styles.section}
          >
            <TileGrid
              columns={ALBUM_COLUMNS}
              items={albums.slice(0, ALBUMS_IN_ALL)}
              keyOf={(album) => album.id}
              renderTile={({ item, width }) => (
                <AlbumTileOf
                  album={item}
                  coverOf={covers.coverOf}
                  onPress={actions.openAlbum}
                  width={width}
                />
              )}
            />
          </ResultSection>
        </View>
        <View style={styles.side}>
          <ResultSection count={artists.length} filter={SEARCH_FILTERS.artists} onFilter={onFilter}>
            {artists.map((artist) => (
              <FoundArtist actions={actions} artist={artist} covers={covers} key={artist.id} />
            ))}
          </ResultSection>
        </View>
      </View>
    </ScrollView>
  )
}

/** Each form factor's All. */
const ALL_VIEWS = {
  [FORM_FACTORS.phone]: PhoneAll,
  [FORM_FACTORS.tablet]: TabletAll,
} as const satisfies Record<FormFactor, ComponentType<ResultsProps>>

/** Everything a search found, the start of each kind, laid out for the form factor. */
export function AllResults(props: ResultsProps) {
  const All = ALL_VIEWS[useFormFactor()]
  return <All {...props} />
}
