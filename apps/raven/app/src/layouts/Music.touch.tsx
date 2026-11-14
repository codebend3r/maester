import { AlbumLayout } from '@/layouts/AlbumLayout.touch'
import { type MusicKit, STRIP_EDGES } from '@/layouts/musicKit'
import { FavouriteButton } from '@/layouts/MusicParts.touch'
import { NowPlayingLayout } from '@/layouts/NowPlayingLayout.touch'
import { NowPlayingStrip } from '@/layouts/NowPlayingStrip.touch'
import { NewPlaylistButton, PlaylistLayout } from '@/layouts/PlaylistLayout.touch'

/** The music pages under the thumb, each in a module of its own over the shared parts. */
export const touchMusic: MusicKit = {
  AlbumLayout,
  NowPlayingLayout,
  NowPlayingStrip,
  stripEdge: STRIP_EDGES.bottom,
  PlaylistLayout,
  NewPlaylistButton,
  FavouriteButton,
}
