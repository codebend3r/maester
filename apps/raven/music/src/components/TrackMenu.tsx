import { type ArtistCredit, type Track, artistNames } from '@raven/core'
import { useAudioQueue } from '@raven/ui/headless'
import { useRouter } from 'expo-router'
import type { ComponentProps, ComponentType } from 'react'

import { AddToPlaylist } from '@/components/AddToPlaylist'
import { TRACK_MENU_COPY } from '@/components/copy'
import { useCovers } from '@/music/useCovers'
import { WREN_PAGES, pageHref } from '@/routes'
import { useToast } from '@/stores/toast'
import { BottomSheet } from '@/ui/BottomSheet'
import { factsLineOf } from '@/ui/counts'
import { type SheetAction, SheetActions } from '@/ui/SheetActions'
import { ICONS } from '@/ui/WrenIcon'
import { type WrenSession, useWren } from '@/useWren'

/** What the menu shows: its actions, or the listener's playlists to add its tracks to. */
export const MENU_VIEWS = { actions: 'actions', playlists: 'playlists' } as const

export type MenuView = (typeof MENU_VIEWS)[keyof typeof MENU_VIEWS]

type SheetHead = ComponentProps<typeof BottomSheet>['head']

/** Where the menu can go from what it is about: the album, the artist. */
type MenuPlaces = { albumId?: number; artist?: ArtistCredit }

type TracksMenuProps = {
  session: WrenSession
  /** What the menu is about, at its top: a track, an album, an artist or a playlist. */
  head: SheetHead
  /** The tracks it acts on, read when an action needs them: an artist's are fetched then. */
  tracksOf: () => Promise<readonly Track[]>
  /** Whether Add to playlist shows: a track's and an album's do, an artist's and a playlist's not. */
  canAddToPlaylist: boolean
  places?: MenuPlaces
  view: MenuView
  /** Shows another of the menu's views, or closes it with null. */
  onView: (view: MenuView | null) => void
}

type MenuBodyProps = Omit<TracksMenuProps, 'view'> & { onClose: () => void }

const NO_PLACES: MenuPlaces = {}

/** Play next, Add to queue and, where it shows, Add to playlist; then where to go from here. */
function MenuActions({ tracksOf, canAddToPlaylist, places, onView, onClose }: MenuBodyProps) {
  const router = useRouter()
  const playNext = useAudioQueue((store) => store.playNext)
  const addToQueue = useAudioQueue((store) => store.addToQueue)
  const toast = useToast((state) => state.show)
  const { albumId, artist } = places ?? NO_PLACES
  const withTracks = (act: (tracks: readonly Track[]) => void) => () => {
    onClose()
    tracksOf().then(act, (error: unknown) => error instanceof Error && toast(error.message))
  }
  const goTo = (href: ReturnType<typeof pageHref>) => () => {
    onClose()
    router.push(href)
  }
  const playlistAction: SheetAction = {
    icon: ICONS.playlistAdd,
    label: TRACK_MENU_COPY.addToPlaylist,
    onPress: () => onView(MENU_VIEWS.playlists),
  }
  const groups: readonly (readonly SheetAction[])[] = [
    [
      { icon: ICONS.playNext, label: TRACK_MENU_COPY.playNext, onPress: withTracks(playNext) },
      { icon: ICONS.queueAdd, label: TRACK_MENU_COPY.addToQueue, onPress: withTracks(addToQueue) },
      ...(canAddToPlaylist ? [playlistAction] : []),
    ],
    [
      ...(albumId === undefined
        ? []
        : [
            {
              icon: ICONS.album,
              label: TRACK_MENU_COPY.goToAlbum,
              onPress: goTo(pageHref({ page: WREN_PAGES.album, id: albumId })),
            },
          ]),
      ...(artist === undefined
        ? []
        : [
            {
              icon: ICONS.artist,
              label: TRACK_MENU_COPY.goToArtist,
              onPress: goTo(pageHref({ page: WREN_PAGES.artist, id: artist.id })),
            },
          ]),
    ],
  ]
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
 * artist's or a playlist's More.
 */
export function TracksMenu({ view, ...props }: TracksMenuProps) {
  const Body = MENU_BODIES[view]
  const close = () => props.onView(null)
  return (
    <BottomSheet head={headOf({ view, head: props.head })} isOpen onClose={close}>
      <Body {...props} onClose={close} />
    </BottomSheet>
  )
}

type TrackMenuProps = Pick<TracksMenuProps, 'view' | 'onView'> & { track: Track }

type TrackMenuOfProps = TrackMenuProps & { session: WrenSession }

function TrackMenuOf({ session, track, view, onView }: TrackMenuOfProps) {
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
      onView={onView}
      places={{ albumId: track.albumId, artist }}
      session={session}
      tracksOf={async () => [track]}
      view={view}
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
