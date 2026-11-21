import { type Track, artistNames } from '@raven/core'
import { useAudioQueue } from '@raven/ui/headless'
import { useRouter } from 'expo-router'
import { type ComponentProps, type ComponentType, useState } from 'react'

import { type MenuPlaces, factsLineOf, menuGroupsOf, TRACK_MENU_COPY } from '@raven/wren'
import { AddToPlaylist } from '@/components/AddToPlaylist'
import { useCovers } from '@/music/useCovers'
import { WREN_PAGES, pageHref } from '@/routes'
import { toastFailure } from '@/stores/toast'
import { BottomSheet } from '@/ui/BottomSheet'
import { SheetActions } from '@/ui/SheetActions'
import { ICONS } from '@/ui/WrenIcon'
import { type WrenSession, useWren } from '@/useWren'

/** What the menu shows: its actions, or the listener's playlists to add its tracks to. */
const MENU_VIEWS = { actions: 'actions', playlists: 'playlists' } as const

type MenuView = (typeof MENU_VIEWS)[keyof typeof MENU_VIEWS]

type SheetHead = ComponentProps<typeof BottomSheet>['head']

type TracksMenuProps = {
  session: WrenSession
  /** What the menu is about, at its top: a track, an album, an artist or a playlist. */
  head: SheetHead
  /** The tracks it acts on, read when an action needs them: an artist's are fetched then. */
  tracksOf: () => Promise<readonly Track[]>
  /** Whether Add to playlist shows: a track's and an album's do, an artist's and a playlist's not. */
  canAddToPlaylist: boolean
  /** Where the menu can go from here; `{}` for a menu with nowhere to go. */
  places: MenuPlaces
  onClose: () => void
}

type MenuBodyProps = TracksMenuProps & {
  /** Shows the listener's playlists in the actions' place. */
  onPlaylists: () => void
}

type TracksAct = (tracks: readonly Track[]) => void

/** Play next, Add to queue and, where it shows, Add to playlist; then where to go from here. */
function MenuActions({ tracksOf, canAddToPlaylist, places, onPlaylists, onClose }: MenuBodyProps) {
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
    canAddToPlaylist,
    places,
    onPlayNext: withTracks(playNext),
    onAddToQueue: withTracks(addToQueue),
    onPlaylists,
    onAlbum: (albumId) => goTo(pageHref({ page: WREN_PAGES.album, id: albumId })),
    onArtist: (artistId) => goTo(pageHref({ page: WREN_PAGES.artist, id: artistId })),
  })
  return <SheetActions groups={groups} />
}

/** Add to playlist, for what the menu is about. */
function MenuPlaylists({ session, head, tracksOf, onClose }: MenuBodyProps) {
  return <AddToPlaylist name={head.title} onDone={onClose} session={session} tracksOf={tracksOf} />
}

const MENU_BODIES = {
  [MENU_VIEWS.actions]: MenuActions,
  [MENU_VIEWS.playlists]: MenuPlaylists,
} as const satisfies Record<MenuView, ComponentType<MenuBodyProps>>

type HeadOfProps = { view: MenuView; head: SheetHead }

/** The sheet's head in each view: what it is about, or Add to playlist under its name. */
const headOf = ({ view, head }: HeadOfProps): SheetHead =>
  ({
    [MENU_VIEWS.actions]: head,
    [MENU_VIEWS.playlists]: {
      title: TRACK_MENU_COPY.addToPlaylistTitle,
      subtitle: factsLineOf([head.title, head.subtitle ?? null]),
    },
  })[view]

/**
 * A menu over tracks, as one sheet over the page whichever view it shows, so moving to Add to
 * playlist changes what it holds without it rising again: a track's, or an album's, an
 * artist's or a playlist's More. It is drawn only while open, so each opening starts on its actions.
 */
export function TracksMenu(props: TracksMenuProps) {
  const [view, setView] = useState<MenuView>(MENU_VIEWS.actions)
  const Body = MENU_BODIES[view]
  return (
    <BottomSheet head={headOf({ view, head: props.head })} isOpen onClose={props.onClose}>
      <Body {...props} onPlaylists={() => setView(MENU_VIEWS.playlists)} />
    </BottomSheet>
  )
}

type TrackMenuProps = Pick<TracksMenuProps, 'onClose'> & { track: Track }

type TrackMenuOfProps = TrackMenuProps & { session: WrenSession }

function TrackMenuOf({ session, track, onClose }: TrackMenuOfProps) {
  const { trackCoverOf } = useCovers(session)
  const [artist] = track.artists
  // TODO(redesign): Like and Download once the server keeps a track's favourite and a track downloads alone.
  return (
    <TracksMenu
      canAddToPlaylist
      head={{
        title: track.title,
        subtitle: factsLineOf([artistNames(track), track.album.title]),
        cover: trackCoverOf(track),
      }}
      onClose={onClose}
      places={{ albumId: track.albumId, artist }}
      session={session}
      tracksOf={async () => [track]}
    />
  )
}

/**
 * A track's menu, held on its row or opened from its More: play it next, add it to the queue
 * or to a playlist, or go to its album or artist. Like and Download are left out: the server
 * keeps no favourite for a track, and a download is an album's or a playlist's.
 */
export function TrackMenu(props: TrackMenuProps) {
  const session = useWren()
  return session !== null && <TrackMenuOf {...props} session={session} />
}
