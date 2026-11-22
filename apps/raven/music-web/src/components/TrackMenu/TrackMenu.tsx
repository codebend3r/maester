import { type Track, artistNames } from '@raven/core'
import { useAudioQueue } from '@raven/ui/headless'
import {
  type MenuLike,
  type MenuPlaces,
  TRACK_MENU_COPY,
  factsLineOf,
  menuGroupsOf,
} from '@raven/wren'
import { type ComponentProps, type ComponentType, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AddToPlaylist } from '@/components/AddToPlaylist/AddToPlaylist'
import { useCovers } from '@/music/useCovers'
import { albumPath, artistPath } from '@/routes'
import { toastFailure } from '@/stores/toast'
import { BottomSheet } from '@/ui/BottomSheet/BottomSheet'
import { SheetActions } from '@/ui/SheetActions/SheetActions'
import { ICONS } from '@/ui/WrenIcon/icons'

/** What the menu shows: its actions, or the listener's playlists to add its tracks to. */
const MENU_VIEWS = { actions: 'actions', playlists: 'playlists' } as const

type MenuView = (typeof MENU_VIEWS)[keyof typeof MENU_VIEWS]

type SheetHead = ComponentProps<typeof BottomSheet>['head']

type TracksMenuProps = {
  /** What the menu is about, at its top: a track, an album, an artist or a playlist. */
  head: SheetHead
  /** The tracks it acts on, read when an action needs them: an artist's are fetched then. */
  tracksOf: () => Promise<readonly Track[]>
  /** Whether Add to playlist shows: a track's and an album's do, an artist's and a playlist's not. */
  canAddToPlaylist: boolean
  /** Where the menu can go from here; `{}` for a menu with nowhere to go. */
  places: MenuPlaces
  /** A song's Like or Unlike; left out of a menu over more than one. */
  like?: MenuLike
  onClose: () => void
}

type MenuBodyProps = TracksMenuProps & {
  /** Shows the listener's playlists in the actions' place. */
  onPlaylists: () => void
}

type TracksAct = (tracks: readonly Track[]) => void

/** Play next, Add to queue and, where it shows, Add to playlist; then where to go from here. */
function MenuActions({
  tracksOf,
  canAddToPlaylist,
  places,
  like,
  onPlaylists,
  onClose,
}: MenuBodyProps) {
  const navigate = useNavigate()
  const playNext = useAudioQueue((store) => store.playNext)
  const addToQueue = useAudioQueue((store) => store.addToQueue)
  const withTracks = (act: TracksAct) => () => {
    onClose()
    tracksOf().then(act, toastFailure)
  }
  const goTo = (path: string) => {
    onClose()
    navigate(path)
  }
  const groups = menuGroupsOf({
    icons: ICONS,
    like,
    canAddToPlaylist,
    places,
    onPlayNext: withTracks(playNext),
    onAddToQueue: withTracks(addToQueue),
    onPlaylists,
    onAlbum: (albumId) => goTo(albumPath(albumId)),
    onArtist: (artistId) => goTo(artistPath(artistId)),
  })
  return <SheetActions groups={groups} />
}

/** Add to playlist, for what the menu is about. */
function MenuPlaylists({ head, tracksOf, onClose }: MenuBodyProps) {
  return <AddToPlaylist name={head.title} onDone={onClose} tracksOf={tracksOf} />
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

type TrackMenuProps = Pick<TracksMenuProps, 'onClose'> & {
  track: Track
  /** The song's Like, from `useTrackLike` where its heart shows too, so both say the same. */
  like: MenuLike
}

/**
 * A track's menu, opened from its row's More: like or unlike it, play it next, add it to the
 * queue or to a playlist, or go to its album or artist.
 */
export function TrackMenu({ track, like, onClose }: TrackMenuProps) {
  const { trackCoverOf } = useCovers()
  const [artist] = track.artists
  return (
    <TracksMenu
      canAddToPlaylist
      head={{
        title: track.title,
        subtitle: factsLineOf([artistNames(track), track.album.title]),
        cover: trackCoverOf(track),
      }}
      like={like}
      onClose={onClose}
      places={{ albumId: track.albumId, artist }}
      tracksOf={async () => [track]}
    />
  )
}
