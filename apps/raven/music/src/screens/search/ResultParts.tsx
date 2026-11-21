import { type Artist, type Track, artistNames } from '@raven/core'
import {
  KIT_COPY,
  SEARCH_COPY,
  type SearchFilter,
  TOP_RESULT_KINDS,
  type TopResult,
} from '@raven/wren'
import { type ComponentType, type ReactNode } from 'react'
import { FlatList, Pressable, type StyleProp, Text, View, type ViewStyle } from 'react-native'

import type { Covers } from '@/music/useCovers'
import type { ResultActions } from '@/screens/search/useResultActions'
import type { SearchResults as Results } from '@/screens/search/useSearchResults'
import { type WrenTheme, themedStyles, useWrenTheme } from '@/theme/wrenTheme'
import { FORM_FACTORS, SEARCH_SIZES, SIZE, SPACE, TYPE } from '@/theme/wrenTokens'
import { AlbumArt } from '@/ui/AlbumArt'
import { ArtistAvatar } from '@/ui/ArtistAvatar'
import { BUTTON_VARIANTS } from '@/ui/Button'
import { Card } from '@/ui/Card'
import { EmptyState } from '@/ui/EmptyState'
import { IconButton } from '@/ui/IconButton'
import { pressedStyleOf } from '@/ui/press'
import { GRID_COLUMNS, type GridColumns } from '@/ui/TileGrid'
import { ICONS } from '@/ui/WrenIcon'

/** What every view of a search's results is handed. */
export type ResultsProps = {
  results: Results
  query: string
  filter: SearchFilter
  onFilter: (filter: SearchFilter) => void
  onClear: () => void
  covers: Covers
  actions: ResultActions
  /** The scroller's padding, clear of the gutters and what sits under the page. */
  contentStyle: StyleProp<ViewStyle>
}

// Album tiles to a row under the Albums chip, and in a tablet's All.
export const ALBUM_COLUMNS = {
  [FORM_FACTORS.phone]: GRID_COLUMNS[FORM_FACTORS.phone],
  [FORM_FACTORS.tablet]: 4,
} as const satisfies GridColumns

/** Nothing matched, the whole search or the kind a chip narrowed it to, with a way to clear it. */
export function NoMatches({ query, onClear, contentStyle }: ResultsProps) {
  return (
    <View style={contentStyle}>
      <EmptyState
        action={{
          label: SEARCH_COPY.clearSearch,
          onPress: onClear,
          variant: BUTTON_VARIANTS.secondary,
        }}
        body={SEARCH_COPY.noMatchesHint}
        icon={ICONS.search}
        title={SEARCH_COPY.noMatches(query)}
      />
    </View>
  )
}

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  card: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: SIZE.rowGap,
    padding: SPACE.s3,
  },
  cardMain: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: SIZE.rowGap },
  cardText: { flex: 1, gap: SPACE.s1 / 2 },
  overline: { ...TYPE.overline, color: colors.text3 },
  cardTitle: { ...TYPE.rowStrong, color: colors.text },
  cardSubtitle: { ...TYPE.meta, color: colors.text2 },
  circles: { gap: SPACE.s3 },
  circle: { alignItems: 'center', gap: SPACE.s2, width: SEARCH_SIZES.artistCircleItem },
  circleName: { ...TYPE.meta, color: colors.text, textAlign: 'center' },
}))

type TopCardProps = {
  art: ReactNode
  kind: string
  title: string
  subtitle: string | null
  onOpen: () => void
  /** Play: shown for a song or an album. */
  onPlay?: () => void
}

/** The top result as a card: its art, what it is, its title and line, and Play. */
function TopCard({ art, kind, title, subtitle, onOpen, onPlay }: TopCardProps) {
  const styles = useStyles()
  const { colors } = useWrenTheme()
  return (
    <Card style={styles.card}>
      <Pressable
        accessibilityLabel={KIT_COPY.labelled({
          label: SEARCH_COPY.topResult({ kind }),
          value: title,
        })}
        accessibilityRole="button"
        onPress={onOpen}
        style={pressedStyleOf({ style: styles.cardMain })}
      >
        {art}
        <View style={styles.cardText}>
          <Text numberOfLines={1} style={styles.overline}>
            {SEARCH_COPY.topResult({ kind })}
          </Text>
          <Text numberOfLines={1} style={styles.cardTitle}>
            {title}
          </Text>
          {subtitle !== null && (
            <Text numberOfLines={1} style={styles.cardSubtitle}>
              {subtitle}
            </Text>
          )}
        </View>
      </Pressable>
      {onPlay !== undefined && (
        <IconButton
          color={colors.accentInk}
          fill={colors.accent}
          icon={ICONS.play}
          label={SEARCH_COPY.play(title)}
          onPress={onPlay}
          size={SIZE.playButton}
        />
      )}
    </Card>
  )
}

type TopResultViewProps = {
  result: TopResult
  songs: readonly Track[]
  covers: Covers
  actions: ResultActions
}

type TopResultKind = TopResult['kind']

/** A top result's card, handed the result of its own kind. */
type TopViewProps<K extends TopResultKind> = Omit<TopResultViewProps, 'result'> & {
  result: TopResult & { kind: K }
}

function TopSong({
  result: { track },
  songs,
  covers,
  actions,
}: TopViewProps<typeof TOP_RESULT_KINDS.song>) {
  // The top song is always the first found (`topResultOf`).
  const play = () => actions.playSongs({ tracks: songs, startAt: 0 })
  return (
    <TopCard
      art={<AlbumArt cover={covers.trackCoverOf(track)} size={SEARCH_SIZES.topResultArt} />}
      kind={SEARCH_COPY.song}
      onOpen={play}
      onPlay={play}
      subtitle={artistNames(track)}
      title={track.title}
    />
  )
}

function TopAlbum({
  result: { album },
  covers,
  actions,
}: TopViewProps<typeof TOP_RESULT_KINDS.album>) {
  return (
    <TopCard
      art={
        <AlbumArt
          cover={covers.coverOf({ albumId: album.id, coverVersion: album.coverVersion })}
          size={SEARCH_SIZES.topResultArt}
        />
      }
      kind={SEARCH_COPY.album}
      onOpen={() => actions.openAlbum(album)}
      onPlay={() => actions.playAlbum(album)}
      subtitle={artistNames(album)}
      title={album.title}
    />
  )
}

function TopArtist({
  result: { artist },
  covers,
  actions,
}: TopViewProps<typeof TOP_RESULT_KINDS.artist>) {
  return (
    <TopCard
      art={
        <ArtistAvatar
          name={artist.name}
          picture={covers.artistPhotoOf(artist)}
          size={SEARCH_SIZES.topResultArt}
        />
      }
      kind={SEARCH_COPY.artist}
      onOpen={() => actions.openArtist(artist)}
      subtitle={null}
      title={artist.name}
    />
  )
}

type TopViews = { [K in TopResultKind]: ComponentType<TopViewProps<K>> }

const TOP_RESULT_VIEWS = {
  [TOP_RESULT_KINDS.song]: TopSong,
  [TOP_RESULT_KINDS.album]: TopAlbum,
  [TOP_RESULT_KINDS.artist]: TopArtist,
} as const satisfies TopViews

// Typed as the mapped type, so a kind looks up the card that takes that kind's result.
const TOP_VIEWS: TopViews = TOP_RESULT_VIEWS

/** The result a search most likely meant, as a card with Play. */
export function TopResultCard<K extends TopResultKind>(props: TopViewProps<K>) {
  const TopView: ComponentType<TopViewProps<K>> = TOP_VIEWS[props.result.kind]
  return <TopView {...props} />
}

type ArtistsProps = { artists: readonly Artist[]; covers: Covers; actions: ResultActions }

/** The artists found, as a row of circles that scrolls sideways. */
export function ArtistCircles({ artists, covers, actions }: ArtistsProps) {
  const styles = useStyles()
  return (
    <FlatList
      contentContainerStyle={styles.circles}
      data={artists}
      horizontal
      keyExtractor={(artist) => String(artist.id)}
      renderItem={({ item }) => (
        <Pressable
          accessibilityLabel={item.name}
          accessibilityRole="button"
          onPress={() => actions.openArtist(item)}
          style={pressedStyleOf({ style: styles.circle })}
        >
          <ArtistAvatar
            name={item.name}
            picture={covers.artistPhotoOf(item)}
            size={SEARCH_SIZES.artistCircle}
          />
          <Text numberOfLines={1} style={styles.circleName}>
            {item.name}
          </Text>
        </Pressable>
      )}
      showsHorizontalScrollIndicator={false}
    />
  )
}
