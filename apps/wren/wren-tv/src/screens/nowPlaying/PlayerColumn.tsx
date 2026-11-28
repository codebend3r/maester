import { WREN_ICONS } from '@raven/wren'
import type { ArtistCredit } from '@raven/core'
import {
  AUDIOBOOK_SPEEDS,
  KeyedView,
  type ViewOf,
  type ViewsOf,
  usePlayerPrefs,
} from '@raven/ui/headless'
import { WREN_PAGES, pageHref } from '@raven/wren-native/headless'
import { router } from 'expo-router'
import {
  KIT_COPY,
  NOW_PLAYING_COPY,
  PLAYER_COPY,
  type SongActions,
  TRACK_MENU_COPY,
} from '@raven/wren'
import { useState } from 'react'
import { type LayoutChangeEvent, Text, View } from 'react-native'

import type { Cover } from '@raven/wren-native'

import { Scrubber } from '@/player/Scrubber'
import { Transport } from '@/player/Transport'
import type { Playing } from '@/screens/nowPlaying/usePlaying'
import { SIZE, SPACE, TYPE } from '@/theme/tvTokens'
import { themedStyles } from '@/theme/wrenTheme'
import { AlbumArt } from '@/ui/AlbumArt'
import { ChoiceRow } from '@/ui/ChoiceRow'
import { FavouriteButton } from '@/ui/FavouriteButton'
import { FOCUS_ROLES, Focusable } from '@/ui/Focusable'
import { FocusButton } from '@/ui/FocusButton'
import { QualityChips } from '@/ui/QualityChips'

const useStyles = themedStyles(({ colors }) => ({
  column: { gap: SPACE.s4, width: SIZE.playerColumn },
  // The room the column leaves once its words and controls are drawn, which the cover fills.
  artRoom: { flex: 1, minHeight: 0 },
  source: { gap: SPACE.s1 / 2 },
  overline: { ...TYPE.overline, color: colors.text3 },
  sourceName: { ...TYPE.meta, color: colors.text2 },
  titled: { alignItems: 'flex-start', flexDirection: 'row', gap: SPACE.s2 },
  song: { flex: 1, gap: SPACE.s1 },
  name: { ...TYPE.cardTitle, color: colors.text },
  artist: { ...TYPE.body, color: colors.text2 },
  artistLink: { alignSelf: 'flex-start' },
  litArtist: { color: colors.accentText },
  actions: { flexDirection: 'row', gap: SPACE.s2 },
  error: { ...TYPE.meta, color: colors.accentText },
}))

type SongProps = { playing: Playing }

/** "Playing from album" over "1000 Forms Of Fear", where the queue plays from. */
function SourceName({ playing }: SongProps) {
  const styles = useStyles()
  return (
    <View accessible style={styles.source}>
      <Text numberOfLines={1} style={styles.overline}>
        {playing.title.overline}
      </Text>
      <Text numberOfLines={1} style={styles.sourceName}>
        {playing.title.name}
      </Text>
    </View>
  )
}

/** The song's artists in words, where it credits none to open. */
function PlainArtists({ playing }: SongProps) {
  const styles = useStyles()
  return (
    <Text numberOfLines={1} style={styles.artist}>
      {playing.artists}
    </Text>
  )
}

type ArtistLinkProps = SongProps & { artist: ArtistCredit }

/** The song's artists, a link to the first one's page. */
function ArtistLink({ playing, artist }: ArtistLinkProps) {
  const styles = useStyles()
  return (
    <Focusable
      hasRing={false}
      label={playing.artists}
      onPress={() => router.push(pageHref({ page: WREN_PAGES.artist, id: artist.id }))}
      role={FOCUS_ROLES.link}
      style={styles.artistLink}
    >
      {({ isFocused }) => (
        <Text numberOfLines={1} style={[styles.artist, isFocused && styles.litArtist]}>
          {playing.artists}
        </Text>
      )}
    </Focusable>
  )
}

/** Whether the song's artists open a page. */
const ARTIST_KINDS = { link: 'link', plain: 'plain' } as const

type ArtistViewsProps = {
  [ARTIST_KINDS.link]: ArtistLinkProps
  [ARTIST_KINDS.plain]: SongProps
}

const ARTIST_VIEWS = {
  [ARTIST_KINDS.link]: ArtistLink,
  [ARTIST_KINDS.plain]: PlainArtists,
} as const satisfies ViewsOf<ArtistViewsProps>

/** The song's artists as a link where it credits one to open, else as plain words. */
const artistsViewOf = ({ playing }: SongProps): ViewOf<ArtistViewsProps> =>
  playing.firstArtist === null
    ? { key: ARTIST_KINDS.plain, props: { playing } }
    : { key: ARTIST_KINDS.link, props: { playing, artist: playing.firstArtist } }

/** The song's artists: a link to the first one's page when it credits one, plain words when not. */
function Artists({ playing }: SongProps) {
  return <KeyedView<ArtistViewsProps> view={artistsViewOf({ playing })} views={ARTIST_VIEWS} />
}

/** The speeds a book plays at, each named by its number: "1.25×". */
function Speeds() {
  const speed = usePlayerPrefs((prefs) => prefs.audiobookSpeed)
  const setSpeed = usePlayerPrefs((prefs) => prefs.setAudiobookSpeed)
  return (
    <ChoiceRow
      choices={AUDIOBOOK_SPEEDS.map((choice) => ({
        key: choice,
        label: NOW_PLAYING_COPY.speedOf(choice),
      }))}
      label={PLAYER_COPY.speed}
      onSelect={setSpeed}
      selected={speed}
    />
  )
}

type FittedArtProps = { cover: Cover | null }

/**
 * The cover, as large as the column leaves room for and never larger than `SIZE.playerArt`: the
 * song, the scrubber and the transport keep their sizes, so they stay on the TV whatever its
 * height, the title's lines or an audiobook's speeds.
 */
function FittedArt({ cover }: FittedArtProps) {
  const styles = useStyles()
  const [room, setRoom] = useState(0)
  const measure = ({ nativeEvent }: LayoutChangeEvent) =>
    setRoom(Math.min(nativeEvent.layout.width, nativeEvent.layout.height, SIZE.playerArt))
  return (
    <View onLayout={measure} style={styles.artRoom}>
      {room > 0 && <AlbumArt cover={cover} size={room} />}
    </View>
  )
}

type PlayerColumnProps = { playing: Playing; actions: SongActions }

/**
 * The player, as the tablet's first column draws it: where the queue plays from, the cover large,
 * the song with its heart, Add to playlist and More beside its name, what it plays as, the
 * scrubber over its times, then Previous, Play or Pause and Next with the queue's Shuffle and
 * Repeat, and an audiobook's speed. The cover gives way so every control is on the TV, and the
 * remote starts on Play or Pause.
 */
export function PlayerColumn({ playing, actions }: PlayerColumnProps) {
  const styles = useStyles()
  const { like } = actions
  const title = playing.track.title
  return (
    <View style={styles.column}>
      <SourceName playing={playing} />
      <FittedArt cover={playing.cover} />
      <View style={styles.titled}>
        <View style={styles.song}>
          <Text accessibilityRole="header" numberOfLines={2} style={styles.name}>
            {title}
          </Text>
          <Artists playing={playing} />
          {playing.quality !== null && <QualityChips quality={playing.quality} />}
          {playing.error !== null && (
            <Text accessibilityLiveRegion="polite" style={styles.error}>
              {playing.error}
            </Text>
          )}
        </View>
        <View style={styles.actions}>
          <FavouriteButton
            isOn={like.isLiked}
            label={TRACK_MENU_COPY.likeSong(title)}
            onToggle={like.onToggle}
          />
          <FocusButton
            icon={WREN_ICONS.playlistAdd}
            label={NOW_PLAYING_COPY.addToPlaylist}
            onPress={actions.onAddToPlaylist}
          />
          <FocusButton
            icon={WREN_ICONS.more}
            label={KIT_COPY.more(title)}
            onPress={actions.onMore}
          />
        </View>
      </View>
      <Scrubber length={playing.length} />
      <Transport hasPreferredFocus />
      {playing.isAudiobook && <Speeds />}
    </View>
  )
}
