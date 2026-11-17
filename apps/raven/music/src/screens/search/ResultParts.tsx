import { type Artist, type Track, artistNames } from '@raven/core'
import { type ComponentType, type ReactNode } from 'react'
import { FlatList, Pressable, Text, View } from 'react-native'

import type { Covers } from '@/music/useCovers'
import { SEARCH_COPY } from '@/screens/copy'
import { TOP_RESULT_KINDS, type TopResult } from '@/screens/search/topResult'
import type { ResultActions } from '@/screens/search/useResultActions'
import { type WrenTheme, themedStyles, useWrenTheme } from '@/theme/wrenTheme'
import { SEARCH_SIZES, SIZE, SPACE, TYPE } from '@/theme/wrenTokens'
import { AlbumArt } from '@/ui/AlbumArt'
import { ArtistAvatar } from '@/ui/ArtistAvatar'
import { Card } from '@/ui/Card'
import { KIT_COPY } from '@/ui/copy'
import { IconButton } from '@/ui/IconButton'
import { pressedStyleOf } from '@/ui/press'
import { ICONS } from '@/ui/WrenIcon'

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
  const play = () =>
    actions.playSongs({ tracks: songs, startAt: Math.max(0, songs.indexOf(track)) })
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
