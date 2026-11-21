import { classNames, hasPlayingTrackOf, shuffledTracksOf, useAudioQueue } from '@raven/ui/headless'
import {
  HOME_COPY,
  LIBRARY_PAGE_COPY,
  OFFLINE_COPY,
  RECENT_SORTS,
  type RecentSort,
  countsLineOf,
  greetingOf,
  lineValueOf,
} from '@raven/wren'
import { type ComponentType, useState } from 'react'
import { AlbumGrid } from '@/components/AlbumGrid/AlbumGrid'
import { ListNotice } from '@/components/ListNotice/ListNotice'
import { Nothing } from '@/components/Nothing/Nothing'
import { Notice } from '@/components/Notice/Notice'
import { Section } from '@/components/Section/Section'
import { WrenLockup } from '@/components/WrenLockup/WrenLockup'
import { api } from '@/lib/api'
import { usePlaylists, useRecentAlbums, useSongCount } from '@/music/listings'
import { useMusicLibraries } from '@/music/musicLibraries'
import { COLLECTION_KINDS, collectionPath } from '@/routes'
import { ContinueCard } from '@/screens/Home/ContinueCard'
import { ShortcutCard } from '@/screens/Home/ShortcutCard'
import { Page } from '@/shell/Page/Page'
import { toastFailure } from '@/stores/toast'
import { useWrenPrefs } from '@/stores/wrenPrefs'
import { FORM_FACTORS, type FormFactor, useFormFactor } from '@/theme/formFactor'
import { SIZES } from '@/theme/tokens'
import { Card } from '@/ui/Card/Card'
import type { Choice } from '@/ui/RadioChoices/RadioChoices'
import { SegmentedControl } from '@/ui/SegmentedControl/SegmentedControl'
import { ServerStatusChip } from '@/ui/ServerStatusChip/ServerStatusChip'
import { GRID_COLUMNS, type GridColumns } from '@/ui/TileGrid/TileGrid'
import { ICONS } from '@/ui/WrenIcon/icons'
import styles from '@/screens/Home/Home.module.scss'

/** How many rows of albums Home's grid shows. */
const RECENT_ROWS = 6

/** Home's grid holds six to the wide layout's row, one more than a list's. */
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

/** The narrow layout's header: the lockup, and whether the server answers. The sidebar has both. */
function HomeHeader() {
  return (
    <header className={styles.header}>
      <WrenLockup size={SIZES.lockup} />
      <ServerStatusChip />
    </header>
  )
}

type OfflineProps = { message: string }

/** With the server out of reach: that it is, and why. */
function Offline({ message }: OfflineProps) {
  return (
    <Card className={styles.offline}>
      <h2 className={styles.offlineTitle}>{OFFLINE_COPY.title}</h2>
      <Notice text={message} />
    </Card>
  )
}

/** The wide layout's second shortcut: the account's playlists. */
function PlaylistsShortcut() {
  const playlists = usePlaylists()
  return (
    <ShortcutCard
      href={collectionPath(COLLECTION_KINDS.playlists)}
      icon={ICONS.playlist}
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
} as const satisfies Record<FormFactor, ComponentType>

const HEADERS = {
  [FORM_FACTORS.phone]: HomeHeader,
  [FORM_FACTORS.tablet]: Nothing,
} as const satisfies Record<FormFactor, ComponentType>

type ShortcutsProps = { formFactor: FormFactor; isBesideContinue: boolean }

/** Shuffle all, and on the wide layout Playlists too. */
function Shortcuts({ formFactor, isBesideContinue }: ShortcutsProps) {
  const music = useMusicLibraries()
  const songs = useSongCount({ search: '' })
  const playTracks = useAudioQueue((store) => store.playTracks)
  const MoreShortcut = MORE_SHORTCUTS[formFactor]
  // A random page of each library, dealt anew each press: every song at once would be too many to queue.
  const shuffleAll = async () => {
    const tracks = await shuffledTracksOf({ api, libraries: music.libraries })
    playTracks({ tracks, isShuffled: true })
  }
  return (
    <div className={classNames([styles.shortcuts, isBesideContinue && styles.beside])}>
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
      <MoreShortcut />
    </div>
  )
}

/*
 * Every music library's newest albums, six rows of them, by when they were added or when they
 * came out, as the control under the title sets; See all opens Albums.
 */
function RecentlyAdded() {
  const sort = useWrenPrefs((state) => state.homeSort)
  const change = useWrenPrefs((state) => state.change)
  const limit = RECENT_ROWS * RECENT_COLUMNS[useFormFactor()]
  const { albums, listing } = useRecentAlbums({ sort, limit })
  return (
    <Section seeAll={{ href: collectionPath(COLLECTION_KINDS.albums) }} title={RECENT_TITLES[sort]}>
      <SegmentedControl
        choices={RECENT_CHOICES}
        label={HOME_COPY.sortAlbums}
        onSelect={(homeSort) => change({ homeSort })}
        selected={sort}
      />
      {albums.length === 0 && <ListNotice empty={LIBRARY_PAGE_COPY.noAlbums} listing={listing} />}
      <AlbumGrid albums={albums} columns={RECENT_COLUMNS} />
    </Section>
  )
}

/**
 * `/`, Wren's first tab: a greeting, the track to pick up again, the way to shuffle everything,
 * and what every music library gained lately.
 */
export function Home() {
  const formFactor = useFormFactor()
  const music = useMusicLibraries()
  const isBesideContinue = useAudioQueue(hasPlayingTrackOf)
  const Header = HEADERS[formFactor]
  // Read once as Home opens, so a redraw never changes the greeting under the listener.
  const [greeting] = useState(() => greetingOf(new Date().getHours()))
  return (
    <Page className={styles.page}>
      <Header />
      <h1 className={styles.greeting}>{greeting}</h1>
      {music.failure !== null && <Offline message={music.failure.message} />}
      <div className={classNames([styles.feature, isBesideContinue && styles.continuing])}>
        <ContinueCard />
        <Shortcuts formFactor={formFactor} isBesideContinue={isBesideContinue} />
      </div>
      <RecentlyAdded />
    </Page>
  )
}
