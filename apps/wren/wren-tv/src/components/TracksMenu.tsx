import {
  type MenuLike,
  type MenuPlaces,
  type MenuView,
  MENU_VIEWS,
  TRACK_MENU_COPY,
  factsLineOf,
  menuGroupsOf,
} from '@raven/wren'
import { type Track, artistNames } from '@raven/core'
import { useAudioQueue } from '@raven/ui/headless'
import { useRouter } from 'expo-router'
import { type ComponentType, useState } from 'react'
import { View } from 'react-native'

import { AddToPlaylist } from '@/components/AddToPlaylist'
import { toastFailure, type WrenSession, useWren } from '@raven/wren-native'
import { WREN_PAGES, pageHref } from '@raven/wren-native/headless'
import { SPACE } from '@/theme/tvTokens'
import { themedStyles } from '@/theme/wrenTheme'
import { ListRow } from '@/ui/ListRow'
import { Sheet } from '@/ui/Sheet'
import { ICONS } from '@/ui/WrenIcon'

const useStyles = themedStyles(() => ({ group: { gap: SPACE.s1 } }))

/** What a menu is about, at its top: a name and a quiet line under it. */
type MenuHead = { title: string; line: string | null }

type TracksMenuProps = {
  session: WrenSession
  head: MenuHead
  /** The tracks it acts on, read when an action needs them: an artist's are fetched then. */
  tracksOf: () => Promise<readonly Track[]>
  /** Whether Add to playlist shows: a track's and an album's do, an artist's and a playlist's not. */
  canAddToPlaylist: boolean
  /** Where the menu can go from here; `{}` for a menu with nowhere to go. */
  places: MenuPlaces
  /** A song's Like or Unlike; left out of a menu over more than one. */
  like?: MenuLike
  /** The view it opens on: its actions, unless a button beside a song asks for its playlists. */
  startsOn?: MenuView
  onClose: () => void
}

type MenuBodyProps = TracksMenuProps & { onPlaylists: () => void }

type TracksAct = (tracks: readonly Track[]) => void

/** Like, Play next, Add to queue and, where it shows, Add to playlist; then where to go from here. */
function MenuActions({
  tracksOf,
  canAddToPlaylist,
  places,
  like,
  onPlaylists,
  onClose,
}: MenuBodyProps) {
  const styles = useStyles()
  const router = useRouter()
  const playNext = useAudioQueue((store) => store.playNext)
  const addToQueue = useAudioQueue((store) => store.addToQueue)
  const withTracks = (act: TracksAct) => () => {
    onClose()
    tracksOf().then(act, toastFailure)
  }
  const goTo = (href: ReturnType<typeof pageHref>) => {
    onClose()
    router.push(href)
  }
  const groups = menuGroupsOf({
    icons: ICONS,
    like,
    canAddToPlaylist,
    places,
    onPlayNext: withTracks(playNext),
    onAddToQueue: withTracks(addToQueue),
    onPlaylists,
    onAlbum: (albumId) => goTo(pageHref({ page: WREN_PAGES.album, id: albumId })),
    onArtist: (artistId) => goTo(pageHref({ page: WREN_PAGES.artist, id: artistId })),
  })
  return groups.map((actions, group) => (
    <View key={actions.map(({ label }) => label).join()} style={styles.group}>
      {actions.map((action, at) => (
        <ListRow
          hasPreferredFocus={group === 0 && at === 0}
          icon={action.icon}
          key={action.label}
          onPress={action.onPress}
          title={action.label}
        />
      ))}
    </View>
  ))
}

/** Add to playlist, for what the menu is about. */
function MenuPlaylists({ session, head, tracksOf, onClose }: MenuBodyProps) {
  return <AddToPlaylist name={head.title} onDone={onClose} session={session} tracksOf={tracksOf} />
}

const MENU_BODIES = {
  [MENU_VIEWS.actions]: MenuActions,
  [MENU_VIEWS.playlists]: MenuPlaylists,
} as const satisfies Record<MenuView, ComponentType<MenuBodyProps>>

type HeadOfProps = { view: MenuView; head: MenuHead }

/** The sheet's head in each view: what it is about, or Add to playlist under its name. */
const headOf = ({ view, head }: HeadOfProps): MenuHead =>
  ({
    [MENU_VIEWS.actions]: head,
    [MENU_VIEWS.playlists]: {
      title: TRACK_MENU_COPY.addToPlaylistTitle,
      line: factsLineOf([head.title, head.line]),
    },
  })[view]

/**
 * A menu over tracks, the phone's sheet as a panel in the middle of the TV: a track's, or an
 * album's, an artist's or a playlist's More. Moving to Add to playlist changes what it holds in
 * place. It is drawn only while open, so each opening starts on `startsOn`, its actions unless
 * told otherwise.
 */
export function TracksMenu(props: TracksMenuProps) {
  const [view, setView] = useState<MenuView>(props.startsOn ?? MENU_VIEWS.actions)
  const Body = MENU_BODIES[view]
  const head = headOf({ view, head: props.head })
  return (
    <Sheet isOpen line={head.line} onClose={props.onClose} title={head.title}>
      <Body {...props} onPlaylists={() => setView(MENU_VIEWS.playlists)} />
    </Sheet>
  )
}

type TrackMenuProps = Pick<TracksMenuProps, 'onClose' | 'startsOn'> & {
  track: Track
  /** The song's Like, from `useTrackLike` where the menu is opened. */
  like: MenuLike
}

type TrackMenuOfProps = TrackMenuProps & { session: WrenSession }

function TrackMenuOf({ session, track, like, startsOn, onClose }: TrackMenuOfProps) {
  const [artist] = track.artists
  return (
    <TracksMenu
      canAddToPlaylist
      head={{ title: track.title, line: factsLineOf([artistNames(track), track.album.title]) }}
      like={like}
      onClose={onClose}
      places={{ albumId: track.albumId, artist }}
      session={session}
      startsOn={startsOn}
      tracksOf={async () => [track]}
    />
  )
}

/**
 * A track's menu, held on its row or opened from its More: like or unlike it, play it next, add
 * it to the queue or to a playlist, or go to its album or artist.
 */
export function TrackMenu(props: TrackMenuProps) {
  const session = useWren()
  return session !== null && <TrackMenuOf {...props} session={session} />
}
