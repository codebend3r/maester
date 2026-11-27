import { type Track, artistNames } from '@raven/core'
import { KeyedView, type ViewOf, type ViewsOf } from '@raven/ui/headless'
import { KIT_COPY, SEARCH_COPY, TOP_RESULT_KINDS, type TopResult, WREN_ICONS } from '@raven/wren'
import { type Cover, type Covers, type ResultActions } from '@raven/wren-native'
import { Text, View } from 'react-native'

import { RADIUS, SIZE, SPACE, TYPE } from '@/theme/tvTokens'
import { themedStyles } from '@/theme/wrenTheme'
import { AlbumArt } from '@/ui/AlbumArt'
import { Focusable } from '@/ui/Focusable'
import { BUTTON_TONES, FocusButton } from '@/ui/FocusButton'

const useStyles = themedStyles(({ colors }) => ({
  card: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderRadius: RADIUS.card,
    flexDirection: 'row',
    gap: SPACE.s4,
    padding: SPACE.s3,
  },
  main: { alignItems: 'center', flexDirection: 'row', gap: SPACE.s4, padding: SPACE.s1 },
  lit: { backgroundColor: colors.surface2, borderRadius: RADIUS.item },
  words: { gap: SPACE.s1 / 2, maxWidth: SIZE.fieldWidth },
  overline: { ...TYPE.overline, color: colors.text3 },
  title: { ...TYPE.cardTitle, color: colors.text },
  line: { ...TYPE.meta, color: colors.text2 },
}))

type TopCardProps = {
  cover: Cover | null
  isRound?: boolean
  kind: string
  title: string
  line: string | null
  onOpen: () => void
  /** Play: shown for a song or an album. */
  onPlay?: () => void
}

/** The top result as a card: its picture, what it is, its title and line, and Play. */
function TopCard({ cover, isRound, kind, title, line, onOpen, onPlay }: TopCardProps) {
  const styles = useStyles()
  const overline = SEARCH_COPY.topResult({ kind })
  return (
    <View style={styles.card}>
      <Focusable
        focusedStyle={styles.lit}
        hasRing={false}
        label={KIT_COPY.labelled({ label: overline, value: title })}
        onPress={onOpen}
        style={styles.main}
      >
        <AlbumArt cover={cover} isRound={isRound} size={SIZE.tileSmall} />
        <View style={styles.words}>
          <Text numberOfLines={1} style={styles.overline}>
            {overline}
          </Text>
          <Text numberOfLines={1} style={styles.title}>
            {title}
          </Text>
          {line !== null && (
            <Text numberOfLines={1} style={styles.line}>
              {line}
            </Text>
          )}
        </View>
      </Focusable>
      {onPlay !== undefined && (
        <FocusButton
          icon={WREN_ICONS.play}
          label={SEARCH_COPY.play(title)}
          onPress={onPlay}
          tone={BUTTON_TONES.primary}
        />
      )}
    </View>
  )
}

type TopResultKind = TopResult['kind']

type TopViewProps<K extends TopResultKind> = {
  result: TopResult & { kind: K }
  songs: readonly Track[]
  covers: Covers
  actions: ResultActions
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
      cover={covers.trackCoverOf(track)}
      kind={SEARCH_COPY.song}
      line={artistNames(track)}
      onOpen={play}
      onPlay={play}
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
      cover={covers.coverOf({ albumId: album.id, coverVersion: album.coverVersion })}
      kind={SEARCH_COPY.album}
      line={artistNames(album)}
      onOpen={() => actions.openAlbum(album)}
      onPlay={() => actions.playAlbum(album)}
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
      cover={covers.artistPhotoOf(artist)}
      isRound
      kind={SEARCH_COPY.artist}
      line={null}
      onOpen={() => actions.openArtist(artist)}
      title={artist.name}
    />
  )
}

/** Each kind of top result's view props, or only `Keys`' for a builder generic over the kind. */
type TopProps<Keys extends TopResultKind = TopResultKind> = { [K in Keys]: TopViewProps<K> }

const TOP_RESULT_VIEWS = {
  [TOP_RESULT_KINDS.song]: TopSong,
  [TOP_RESULT_KINDS.album]: TopAlbum,
  [TOP_RESULT_KINDS.artist]: TopArtist,
} as const satisfies ViewsOf<TopProps>

/** The top result as its kind's card, so each card is handed its own kind of result. */
const topViewOf = <K extends TopResultKind>({
  result,
  songs,
  covers,
  actions,
}: TopViewProps<K>): ViewOf<TopProps<K>, K> => ({
  key: result.kind,
  props: { result, songs, covers, actions },
})

type TopResultCardProps = Omit<TopViewProps<TopResultKind>, 'result'> & { result: TopResult }

/** The top result's card, by what it is. */
export function TopResultCard(props: TopResultCardProps) {
  return <KeyedView<TopProps> view={topViewOf(props)} views={TOP_RESULT_VIEWS} />
}
