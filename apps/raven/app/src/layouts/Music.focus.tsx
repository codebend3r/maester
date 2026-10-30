import { AlbumLayout } from '@/layouts/AlbumLayout.focus'
import type { MusicKit } from '@/layouts/musicKit'
import { FavouriteButton } from '@/layouts/MusicParts.focus'
import { NowPlayingLayout } from '@/layouts/NowPlayingLayout.focus'
import { NowPlayingStrip } from '@/layouts/NowPlayingStrip.focus'
import { NewPlaylistButton, PlaylistLayout } from '@/layouts/PlaylistLayout.focus'

/** The music pages on a TV, each in a module of its own over the shared parts. */
export const focusMusic: MusicKit = {
  AlbumLayout,
  NowPlayingLayout,
  NowPlayingStrip,
  PlaylistLayout,
  NewPlaylistButton,
  FavouriteButton,
}
