import type { ArtistCredit } from '@raven/core'
import { TRACK_MENU_COPY } from '@/copy/components'

/** Where the menu can go from what it is about: the album, the artist. */
export type MenuPlaces = { albumId?: number; artist?: ArtistCredit }

/** One of the menu's rows. `Icon` is each app's own drawing. */
type MenuAction<Icon> = { icon: Icon; label: string; onPress: () => void }

/** The drawings the menu's rows wear, which each app's `ICONS` holds under these names. */
type MenuIcons<Icon> = {
  playNext: Icon
  queueAdd: Icon
  playlistAdd: Icon
  album: Icon
  artist: Icon
}

type MenuGroupsOfProps<Icon> = {
  icons: MenuIcons<Icon>
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

/**
 * The menu's actions in their groups: Play next, Add to queue and, where it shows, Add to
 * playlist; then the places it was given, the album before the artist.
 */
export const menuGroupsOf = <Icon>({
  icons,
  canAddToPlaylist,
  places: { albumId, artist },
  onPlayNext,
  onAddToQueue,
  onPlaylists,
  onAlbum,
  onArtist,
}: MenuGroupsOfProps<Icon>): readonly (readonly MenuAction<Icon>[])[] => {
  const isAction = (action: MenuAction<Icon> | null): action is MenuAction<Icon> => action !== null
  const queue: readonly (MenuAction<Icon> | null)[] = [
    { icon: icons.playNext, label: TRACK_MENU_COPY.playNext, onPress: onPlayNext },
    { icon: icons.queueAdd, label: TRACK_MENU_COPY.addToQueue, onPress: onAddToQueue },
    canAddToPlaylist
      ? { icon: icons.playlistAdd, label: TRACK_MENU_COPY.addToPlaylist, onPress: onPlaylists }
      : null,
  ]
  const goes: readonly (MenuAction<Icon> | null)[] = [
    albumId === undefined
      ? null
      : { icon: icons.album, label: TRACK_MENU_COPY.goToAlbum, onPress: () => onAlbum(albumId) },
    artist === undefined
      ? null
      : {
          icon: icons.artist,
          label: TRACK_MENU_COPY.goToArtist,
          onPress: () => onArtist(artist.id),
        },
  ]
  return [queue.filter(isAction), goes.filter(isAction)]
}
