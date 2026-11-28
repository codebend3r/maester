import { type ArtistCredit, MUSIC_LINKS, type MusicLink, musicLinksOf } from '@raven/core'
import { TRACK_MENU_COPY } from '@/copy/components'

/** Where the menu can go from what it is about: the album, and the first of its artists. */
export type MenuPlaces = { albumId?: number; artists?: readonly ArtistCredit[] }

/** One of the menu's rows. `Icon` is each app's own drawing. */
type MenuAction<Icon> = { icon: Icon; label: string; onPress: () => void }

/** The drawings the menu's rows wear, which each app's `ICONS` holds under these names. */
type MenuIcons<Icon> = {
  heart: Icon
  heartFilled: Icon
  playNext: Icon
  queueAdd: Icon
  playlistAdd: Icon
  album: Icon
  artist: Icon
}

/** A song's favourite as the menu turns it: whether it is one, and the press that flips it. */
export type MenuLike = { isLiked: boolean; onToggle: () => void }

/** What the menu shows: its actions, or the listener's playlists to add the tracks to. */
export const MENU_VIEWS = { actions: 'actions', playlists: 'playlists' } as const

export type MenuView = (typeof MENU_VIEWS)[keyof typeof MENU_VIEWS]

/** What a listener does with the playing song from Now Playing itself. */
export type SongActions = {
  /** The song's heart, which its menu's Like shows too. */
  like: MenuLike
  /** Opens the listener's playlists, to add the song to one. */
  onAddToPlaylist: () => void
  /** Opens the song's menu, for everything else. */
  onMore: () => void
}

type MenuGroupsOfProps<Icon> = {
  icons: MenuIcons<Icon>
  /** Like or Unlike, first, on a song's menu; left out where the menu is about more than one. */
  like?: MenuLike
  /** Whether Add to playlist shows. */
  canAddToPlaylist: boolean
  places: MenuPlaces
  onPlayNext: () => void
  onAddToQueue: () => void
  /** Shows the listener's playlists, to add the tracks to one. */
  onPlaylists: () => void
  /** Opens the page of the album with this id. */
  onAlbum: (albumId: number) => void
  /** Opens the page of the artist with this id. */
  onArtist: (artistId: number) => void
}

type PlaceActionsOfProps<Icon> = Pick<
  MenuGroupsOfProps<Icon>,
  'places' | 'onAlbum' | 'onArtist'
> & { icons: Pick<MenuIcons<Icon>, 'album' | 'artist'> }

type PlaceActionOfProps<Icon> = Omit<PlaceActionsOfProps<Icon>, 'places'> & { link: MusicLink }

/** A link as the menu's row: Go to album or Go to artist, opening its page. */
const placeActionOf = <Icon>({
  icons,
  link,
  onAlbum,
  onArtist,
}: PlaceActionOfProps<Icon>): MenuAction<Icon> =>
  link.kind === MUSIC_LINKS.album
    ? { icon: icons.album, label: TRACK_MENU_COPY.goToAlbum, onPress: () => onAlbum(link.albumId) }
    : {
        icon: icons.artist,
        label: TRACK_MENU_COPY.goToArtist,
        onPress: () => onArtist(link.artistId),
      }

/**
 * Go to album and Go to artist, for the places given, the album before the artist: the track
 * menu's last group, and what a held cover's menu offers under its facts.
 */
export const placeActionsOf = <Icon>({
  icons,
  places: { albumId, artists },
  onAlbum,
  onArtist,
}: PlaceActionsOfProps<Icon>): readonly MenuAction<Icon>[] =>
  musicLinksOf({ albumId: albumId ?? null, artists: artists ?? [], isFirstArtistOnly: true }).map(
    (link) => placeActionOf({ icons, link, onAlbum, onArtist }),
  )

type LikingOfProps<Icon> = Pick<MenuGroupsOfProps<Icon>, 'icons' | 'like'>

/** A song's Like, or its Unlike while it is a favourite; none where the menu has no like. */
const likingOf = <Icon>({ icons, like }: LikingOfProps<Icon>): MenuAction<Icon> | null => {
  if (like === undefined) return null
  return like.isLiked
    ? { icon: icons.heartFilled, label: TRACK_MENU_COPY.unlike, onPress: like.onToggle }
    : { icon: icons.heart, label: TRACK_MENU_COPY.like, onPress: like.onToggle }
}

/**
 * The menu's actions in their groups: Like or Unlike on a song's, Play next, Add to queue and,
 * where it shows, Add to playlist; then the places it was given, the album before the artist.
 */
export const menuGroupsOf = <Icon>({
  icons,
  like,
  canAddToPlaylist,
  places,
  onPlayNext,
  onAddToQueue,
  onPlaylists,
  onAlbum,
  onArtist,
}: MenuGroupsOfProps<Icon>): readonly (readonly MenuAction<Icon>[])[] => {
  const isAction = (action: MenuAction<Icon> | null): action is MenuAction<Icon> => action !== null
  const queue: readonly (MenuAction<Icon> | null)[] = [
    likingOf({ icons, like }),
    { icon: icons.playNext, label: TRACK_MENU_COPY.playNext, onPress: onPlayNext },
    { icon: icons.queueAdd, label: TRACK_MENU_COPY.addToQueue, onPress: onAddToQueue },
    canAddToPlaylist
      ? { icon: icons.playlistAdd, label: TRACK_MENU_COPY.addToPlaylist, onPress: onPlaylists }
      : null,
  ]
  return [queue.filter(isAction), placeActionsOf({ icons, places, onAlbum, onArtist })]
}
