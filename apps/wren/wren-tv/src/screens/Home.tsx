import { type Track, artistNames } from '@raven/core'
import { playingTrackOf, shuffledTracksOf, useAudioQueue } from '@raven/ui/headless'
import {
  HOME_COPY,
  HOME_RECENT_CHOICES,
  HOME_RECENT_TITLES,
  KIT_COPY,
  LIBRARY_PAGE_COPY,
  LIBRARY_SEGMENTS,
  OFFLINE_COPY,
  countsLineOf,
  greetingOf,
  lineValueOf,
  recentDateLineOf,
} from '@raven/wren'
import { router } from 'expo-router'
import { useState } from 'react'
import { ScrollView, Text, View } from 'react-native'

import { AlbumTileOf } from '@/components/AlbumTileOf'
import { ListNotice } from '@/components/ListNotice'
import {
  type Covers,
  useCovers,
  toastFailure,
  type WrenSession,
  useWren,
  usePlaylists,
  useRecentAlbums,
  useSongCount,
  useMusicLibraries,
} from '@raven/wren-native'
import { WREN_ROUTES, albumsInOrderHref, libraryHref } from '@raven/wren-native/headless'
import { TAB_TILE_COLUMNS } from '@/shell/layout'
import { useWrenPrefs } from '@/stores/wrenPrefs'
import { RADIUS, SIZE, SPACE, TYPE } from '@/theme/tvTokens'
import { usePageStyles } from '@/ui/pageStyles'
import { themedStyles } from '@/theme/wrenTheme'
import { AlbumArt } from '@/ui/AlbumArt'
import { Focusable } from '@/ui/Focusable'
import { ChoiceRow } from '@/ui/ChoiceRow'
import { PageHeader, SectionHeader } from '@/ui/Headers'
import { TileGrid } from '@/ui/TileGrid'

/** How many rows of albums Home's grid shows, the phone's six. */
const RECENT_ROWS = 6

/** As many tiles as the page holds to a row, so the grid's rows are whole. */
const RECENT_COLUMNS = TAB_TILE_COLUMNS

const useStyles = themedStyles(({ colors }) => ({
  content: { gap: SPACE.s6, padding: SPACE.gutter },
  offline: { gap: SPACE.s2 },
  offlineText: { ...TYPE.body, color: colors.accentText },
  cards: { flexDirection: 'row', gap: SPACE.s4 },
  card: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: RADIUS.card,
    flexDirection: 'row',
    gap: SPACE.s4,
    padding: SPACE.s4,
  },
  continueCard: { flex: 2 },
  shortcut: { flex: 1 },
  lit: { backgroundColor: colors.surface2 },
  cardWords: { flex: 1, gap: SPACE.s1 },
  overline: { ...TYPE.overline, color: colors.text3 },
  cardTitle: { ...TYPE.cardTitle, color: colors.text },
  cardLine: { ...TYPE.meta, color: colors.text2 },
}))

type ContinueCardProps = { track: Track; covers: Covers }

/** Continue listening: the queue's album and where it stands, opening Now Playing. */
function ContinueCard({ track, covers }: ContinueCardProps) {
  const styles = useStyles()
  const at = useAudioQueue((store) => (store.queue.at ?? 0) + 1)
  const count = useAudioQueue((store) => store.queue.order.length)
  const line = HOME_COPY.continueLine({
    artists: artistNames(track),
    track: HOME_COPY.trackOf({ at, count }),
  })
  return (
    <Focusable
      focusedStyle={styles.lit}
      label={HOME_COPY.continueLabel({ album: track.album.title, line })}
      onPress={() => router.push(WREN_ROUTES.nowPlaying)}
      style={[styles.card, styles.continueCard]}
    >
      <AlbumArt cover={covers.trackCoverOf(track)} size={SIZE.tileSmall} />
      <View style={styles.cardWords}>
        <Text style={styles.overline}>{HOME_COPY.continueListening}</Text>
        <Text numberOfLines={2} style={styles.cardTitle}>
          {track.album.title}
        </Text>
        <Text numberOfLines={2} style={styles.cardLine}>
          {line}
        </Text>
      </View>
    </Focusable>
  )
}

type ShortcutProps = {
  title: string
  /** What it holds; left out while that is on its way. */
  value: string | undefined
  onPress: () => void
  isDisabled?: boolean
  hasPreferredFocus?: boolean
}

/** A shortcut card: its name over what it holds, read as "Shuffle all, 1,204 songs". */
function Shortcut({ title, value, onPress, isDisabled, hasPreferredFocus }: ShortcutProps) {
  const styles = useStyles()
  return (
    <Focusable
      focusedStyle={styles.lit}
      hasPreferredFocus={hasPreferredFocus}
      isDisabled={isDisabled}
      label={value === undefined ? title : KIT_COPY.labelled({ label: title, value })}
      onPress={onPress}
      style={[styles.card, styles.shortcut]}
    >
      <View style={styles.cardWords}>
        <Text style={styles.cardTitle}>{title}</Text>
        {value !== undefined && <Text style={styles.cardLine}>{value}</Text>}
      </View>
    </Focusable>
  )
}

type CardsProps = { session: WrenSession }

/**
 * Continue listening while something is queued, then Shuffle all and the account's Playlists, the
 * tablet's shortcuts; a TV keeps no downloads, so there is no Downloads card.
 */
function Cards({ session }: CardsProps) {
  const styles = useStyles()
  const covers = useCovers(session)
  const music = useMusicLibraries(session)
  const songs = useSongCount({ session, search: '' })
  const playlists = usePlaylists(session)
  const track = useAudioQueue(playingTrackOf)
  const playTracks = useAudioQueue((store) => store.playTracks)
  // A random page of each library, dealt anew each press: every song at once would be too many to queue.
  const shuffleAll = async () => {
    const tracks = await shuffledTracksOf({ api: session.api, libraries: music.libraries })
    playTracks({ tracks, isShuffled: true })
  }
  return (
    <View style={styles.cards}>
      {track !== null && <ContinueCard covers={covers} track={track} />}
      <Shortcut
        hasPreferredFocus={track === null}
        isDisabled={songs === 0}
        onPress={() => {
          shuffleAll().catch(toastFailure)
        }}
        title={HOME_COPY.shuffleAll}
        value={lineValueOf({
          line: songs === null ? null : countsLineOf({ songs }),
          none: LIBRARY_PAGE_COPY.noneYet,
        })}
      />
      <Shortcut
        onPress={() => router.push(libraryHref(LIBRARY_SEGMENTS.playlists))}
        title={LIBRARY_PAGE_COPY.playlists}
        value={lineValueOf({
          line: playlists.isSuccess ? countsLineOf({ playlists: playlists.data.length }) : null,
          none: HOME_COPY.firstPlaylist,
        })}
      />
    </View>
  )
}

type RecentAlbumsProps = { session: WrenSession }

/**
 * Every music library's newest albums, six rows of them, by when they were added or when they
 * came out, as the choices under the title set; See all opens Albums in that same order.
 */
function RecentAlbums({ session }: RecentAlbumsProps) {
  const page = usePageStyles()
  const { coverOf } = useCovers(session)
  const sort = useWrenPrefs((state) => state.homeSort)
  const change = useWrenPrefs((state) => state.change)
  const { albums, listing } = useRecentAlbums({
    session,
    sort,
    limit: RECENT_ROWS * RECENT_COLUMNS,
  })
  return (
    <View style={page.section}>
      <SectionHeader
        action={{
          text: KIT_COPY.seeAll,
          label: KIT_COPY.seeAllOf(HOME_RECENT_TITLES[sort]),
          onPress: () => router.push(albumsInOrderHref({ sort })),
        }}
        title={HOME_RECENT_TITLES[sort]}
      />
      <ChoiceRow
        choices={HOME_RECENT_CHOICES}
        label={HOME_COPY.sortAlbums}
        onSelect={(homeSort) => change({ homeSort })}
        selected={sort}
      />
      {albums.length === 0 && <ListNotice empty={LIBRARY_PAGE_COPY.noAlbums} listing={listing} />}
      <TileGrid
        items={albums}
        keyOf={(album) => album.id}
        renderTile={(album) => (
          <AlbumTileOf album={album} coverOf={coverOf} detail={recentDateLineOf({ album, sort })} />
        )}
      />
    </View>
  )
}

type HomePageProps = { session: WrenSession }

function HomePage({ session }: HomePageProps) {
  const page = usePageStyles()
  const styles = useStyles()
  const music = useMusicLibraries(session)
  // Read once as Home opens, so the greeting never changes under the listener.
  const [greeting] = useState(() => greetingOf(new Date().getHours()))
  return (
    <ScrollView contentContainerStyle={styles.content} style={page.ground}>
      <PageHeader title={greeting} />
      {music.failure !== null && (
        <View accessibilityLiveRegion="polite" style={styles.offline}>
          <SectionHeader title={OFFLINE_COPY.title} />
          <Text style={styles.offlineText}>{music.failure.message}</Text>
        </View>
      )}
      <Cards session={session} />
      <RecentAlbums session={session} />
    </ScrollView>
  )
}

/**
 * Wren's first place: a greeting, the album to pick up again, the ways to shuffle everything or
 * reach the playlists, and what every music library gained lately.
 */
export function Home() {
  const session = useWren()
  return session !== null && <HomePage session={session} />
}
