import { hasPlayingTrackOf, shuffledTracksOf, useAudioQueue } from '@raven/ui/headless'
import {
  countsLineOf,
  greetingOf,
  HOME_COPY,
  LIBRARY_PAGE_COPY,
  LIBRARY_SEGMENTS,
  lineValueOf,
  OFFLINE_COPY,
  RECENT_SORTS,
  type RecentSort,
  recentDateLineOf,
} from '@raven/wren'
import { useRouter } from 'expo-router'
import { type ComponentType, useState } from 'react'
import { ScrollView, Text, View } from 'react-native'

import { Nothing } from '@/components/Nothing'
import { Notice } from '@/components/Notice'
import { WrenLockup } from '@/components/WrenLockup'
import {
  type CoverOf,
  useCovers,
  toastFailure,
  type WrenSession,
  useWren,
  useMusicLibraries,
  usePlaylists,
  useRecentAlbums,
  useSongCount,
} from '@raven/wren-native'
import { useDownloadsSummary } from '@/screens/library/downloadsSummary'
import { libraryHref } from '@raven/wren-native/headless'
import { ContinueCard } from '@/screens/home/ContinueCard'
import { ShortcutCard } from '@/screens/home/ShortcutCard'
import { LIST_SHAPES } from '@/components/ListSkeleton'
import { ListNotice } from '@/screens/library/ListNotice'
import { usePageInsets } from '@/shell/useShell'
import { useWrenPrefs } from '@/stores/wrenPrefs'
import { type WrenTheme, themedStyles, useFormFactor } from '@/theme/wrenTheme'
import { SIZE, SPACE, TYPE, FORM_FACTORS, type FormFactor } from '@/theme/wrenTokens'
import { AlbumTileOf } from '@/ui/AlbumTile'
import { BUTTON_VARIANTS, Button } from '@/ui/Button'
import { Card } from '@/ui/Card'
import { SectionHeader } from '@/ui/SectionHeader'
import { type Choice, SegmentedControl } from '@/ui/SegmentedControl'
import { ServerStatusChip } from '@/ui/ServerStatusChip'
import { GRID_COLUMNS, type GridColumns, TileGrid } from '@/ui/TileGrid'
import { ICONS } from '@/ui/WrenIcon'

/** How many rows of albums Home's grid shows. */
const RECENT_ROWS = 6

/** Home's grid holds six to a tablet's row, one more than a list's. */
const RECENT_COLUMNS = {
  [FORM_FACTORS.phone]: GRID_COLUMNS[FORM_FACTORS.phone],
  [FORM_FACTORS.tablet]: 6,
} as const satisfies GridColumns

/** The two orders of Home's albums, as its control offers them. */
const RECENT_CHOICES = [
  { key: RECENT_SORTS.release, label: HOME_COPY.sorts.release },
  { key: RECENT_SORTS.added, label: HOME_COPY.sorts.added },
] as const satisfies readonly Choice<RecentSort>[]

/** What the section is called under each order. */
const RECENT_TITLES = {
  [RECENT_SORTS.added]: LIBRARY_PAGE_COPY.recent,
  [RECENT_SORTS.release]: HOME_COPY.latestReleases,
} as const satisfies Record<RecentSort, string>

const useStyles = themedStyles(({ colors }: WrenTheme) => ({
  ground: { backgroundColor: colors.bg, flex: 1 },
  content: { gap: SPACE.s5 },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  offline: { padding: SPACE.s4 },
  offlineBody: { gap: SPACE.s3 },
  offlineTitle: { ...TYPE.rowStrong, color: colors.text },
  [FORM_FACTORS.phone]: { gap: SPACE.s3 },
  [FORM_FACTORS.tablet]: { flexDirection: 'row', gap: SPACE.s4 },
  shortcuts: { flexDirection: 'row', flexGrow: 1, gap: SPACE.s3 },
  section: { gap: SPACE.s3 },
}))

type HomeHeaderProps = { session: WrenSession }

/** The phone's header: the lockup, and whether the server answers. The tablet's sidebar has both. */
function HomeHeader({ session }: HomeHeaderProps) {
  const styles = useStyles()
  return (
    <View style={styles.header}>
      <WrenLockup size={SIZE.lockup} />
      <ServerStatusChip session={session} />
    </View>
  )
}

/** With the server out of reach: why, and the way to what plays without it. */
type OfflineProps = { message: string }

function Offline({ message }: OfflineProps) {
  const styles = useStyles()
  const router = useRouter()
  return (
    <Card style={styles.offline}>
      <View accessibilityLiveRegion="polite" style={styles.offlineBody}>
        <Text accessibilityRole="header" style={styles.offlineTitle}>
          {OFFLINE_COPY.title}
        </Text>
        <Notice text={message} />
        <Button
          icon={ICONS.downloads}
          label={OFFLINE_COPY.playDownloads}
          onPress={() => router.push(libraryHref(LIBRARY_SEGMENTS.downloads))}
          variant={BUTTON_VARIANTS.secondary}
        />
      </View>
    </Card>
  )
}

const useGreetingStyles = themedStyles(({ colors }: WrenTheme) => ({
  [FORM_FACTORS.phone]: { ...TYPE.largeTitle, color: colors.text },
  [FORM_FACTORS.tablet]: { ...TYPE.tabletTitle, color: colors.text },
}))

// Beside Continue listening the shortcuts stack in a column on a tablet; alone they share the row.
const useBesideStyles = themedStyles(() => ({
  [FORM_FACTORS.phone]: { flexDirection: 'row', flexGrow: 1, gap: SPACE.s3 },
  [FORM_FACTORS.tablet]: { flexDirection: 'column', flexGrow: 0, gap: SPACE.s3, width: '40%' },
}))

type PlaylistsShortcutProps = { session: WrenSession }

/** The tablet's third shortcut: the account's playlists. */
function PlaylistsShortcut({ session }: PlaylistsShortcutProps) {
  const router = useRouter()
  const playlists = usePlaylists(session)
  return (
    <ShortcutCard
      icon={ICONS.playlist}
      onPress={() => router.push(libraryHref(LIBRARY_SEGMENTS.playlists))}
      title={LIBRARY_PAGE_COPY.playlists}
      value={lineValueOf({
        line: playlists.isSuccess ? countsLineOf({ playlists: playlists.data.length }) : null,
        none: HOME_COPY.firstPlaylist,
      })}
    />
  )
}

const MORE_SHORTCUTS = {
  [FORM_FACTORS.phone]: Nothing,
  [FORM_FACTORS.tablet]: PlaylistsShortcut,
} as const satisfies Record<FormFactor, ComponentType<PlaylistsShortcutProps>>

// The phone's header: the lockup and the server's status; the tablet's sidebar has both.
const HEADERS = {
  [FORM_FACTORS.phone]: HomeHeader,
  [FORM_FACTORS.tablet]: Nothing,
} as const satisfies Record<FormFactor, ComponentType<HomeHeaderProps>>

type ShortcutsProps = { session: WrenSession; formFactor: FormFactor }

/** Shuffle all and Downloads, and on a tablet Playlists too. */
function Shortcuts({ session, formFactor }: ShortcutsProps) {
  const styles = useStyles()
  const besideStyles = useBesideStyles()
  const router = useRouter()
  const music = useMusicLibraries(session)
  const songs = useSongCount({ session, search: '' })
  const downloads = useDownloadsSummary(session.server.id)
  const playTracks = useAudioQueue((store) => store.playTracks)
  const isBesideContinue = useAudioQueue(hasPlayingTrackOf)
  const MoreShortcut = MORE_SHORTCUTS[formFactor]
  // A random page of each library, dealt anew each press: every song at once would be too many to queue.
  const shuffleAll = async () => {
    const tracks = await shuffledTracksOf({ api: session.api, libraries: music.libraries })
    playTracks({ tracks, isShuffled: true })
  }
  return (
    <View style={isBesideContinue ? besideStyles[formFactor] : styles.shortcuts}>
      <ShortcutCard
        icon={ICONS.shuffle}
        isAccent
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
      <ShortcutCard
        icon={ICONS.downloads}
        onPress={() => router.push(libraryHref(LIBRARY_SEGMENTS.downloads))}
        title={LIBRARY_PAGE_COPY.downloads}
        value={lineValueOf({
          line: countsLineOf({ albums: downloads.albums }),
          none: LIBRARY_PAGE_COPY.noneYet,
        })}
      />
      <MoreShortcut session={session} />
    </View>
  )
}

type RecentlyAddedProps = { session: WrenSession; coverOf: CoverOf }

/*
 * Every music library's newest albums, six rows of them, by when they were added or when they
 * came out, as the control under the title sets; See all opens Albums.
 */
function RecentlyAdded({ session, coverOf }: RecentlyAddedProps) {
  const styles = useStyles()
  const router = useRouter()
  const sort = useWrenPrefs((state) => state.homeSort)
  const change = useWrenPrefs((state) => state.change)
  const limit = RECENT_ROWS * RECENT_COLUMNS[useFormFactor()]
  const { albums, listing } = useRecentAlbums({ session, sort, limit })
  return (
    <View style={styles.section}>
      <SectionHeader
        onSeeAll={() => router.push(libraryHref(LIBRARY_SEGMENTS.albums))}
        title={RECENT_TITLES[sort]}
      />
      <SegmentedControl
        choices={RECENT_CHOICES}
        label={HOME_COPY.sortAlbums}
        onSelect={(homeSort) => change({ homeSort })}
        selected={sort}
      />
      {albums.length === 0 && (
        <ListNotice
          empty={LIBRARY_PAGE_COPY.noAlbums}
          listing={listing}
          shape={LIST_SHAPES.tiles}
        />
      )}
      <TileGrid
        columns={RECENT_COLUMNS}
        items={albums}
        keyOf={(album) => album.id}
        renderTile={({ item, width }) => (
          <AlbumTileOf
            album={item}
            coverOf={coverOf}
            detail={recentDateLineOf({ album: item, sort })}
            width={width}
          />
        )}
      />
    </View>
  )
}

type HomePageProps = { session: WrenSession }

function HomePage({ session }: HomePageProps) {
  const styles = useStyles()
  const insets = usePageInsets()
  const formFactor = useFormFactor()
  const covers = useCovers(session)
  const music = useMusicLibraries(session)
  const greetingStyles = useGreetingStyles()
  const Header = HEADERS[formFactor]
  // Read once as Home opens, so a scroll never changes the greeting under the listener.
  const [greeting] = useState(() => greetingOf(new Date().getHours()))
  return (
    <ScrollView contentContainerStyle={[insets, styles.content]} style={styles.ground}>
      <Header session={session} />
      <Text accessibilityRole="header" style={greetingStyles[formFactor]}>
        {greeting}
      </Text>
      {music.failure !== null && <Offline message={music.failure.message} />}
      <View style={styles[formFactor]}>
        <ContinueCard covers={covers} />
        <Shortcuts formFactor={formFactor} session={session} />
      </View>
      <RecentlyAdded coverOf={covers.coverOf} session={session} />
    </ScrollView>
  )
}

/**
 * Wren's first tab: a greeting, the track to pick up again, the ways to shuffle everything or
 * play what is downloaded, and what every music library gained lately.
 */
export function Home() {
  const session = useWren()
  return session !== null && <HomePage session={session} />
}
