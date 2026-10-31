import type { AppPath } from '@raven/core'
import { matchPath, useLocation } from 'react-router-dom'
import { type BackFallback, HOME } from '@/components/BackButton/BackButton'
import { COMMON_COPY } from '@/lib/copy'
import { MUSIC_PATHS, NOW_PLAYING_PATH, albumPath, artistPath, playlistPath } from '@/lib/music'

/** Which shell the page is open in: raven's own, or the music mode under `/music`. */
const MUSIC_MODES = { raven: 'raven', music: 'music' } as const

type MusicMode = (typeof MUSIC_MODES)[keyof typeof MUSIC_MODES]

type LibraryProps = { libraryId: number; name: string }

/** Where the music pages link, in one mode. */
type MusicLinks = {
  album: (albumId: number) => AppPath
  artist: (artistId: number) => AppPath
  playlist: (playlistId: number) => AppPath
  nowPlaying: AppPath
  /** Where a page that hangs off Home goes back to. */
  home: BackFallback
  /** Where an album's page goes back to when nothing is behind it: its library, or the music's. */
  library: (props: LibraryProps) => BackFallback
}

const MODE_LINKS = {
  [MUSIC_MODES.raven]: {
    album: albumPath,
    artist: artistPath,
    playlist: playlistPath,
    nowPlaying: NOW_PLAYING_PATH,
    home: HOME,
    library: ({ libraryId, name }) => ({ to: `/libraries/${libraryId}`, label: name }),
  },
  [MUSIC_MODES.music]: {
    album: (albumId) => `${MUSIC_PATHS.albums}/${albumId}`,
    artist: (artistId) => `${MUSIC_PATHS.artists}/${artistId}`,
    playlist: (playlistId) => `${MUSIC_PATHS.playlists}/${playlistId}`,
    nowPlaying: MUSIC_PATHS.nowPlaying,
    home: { to: MUSIC_PATHS.root, label: COMMON_COPY.home },
    library: () => ({ to: MUSIC_PATHS.albums, label: COMMON_COPY.library }),
  },
} as const satisfies Record<MusicMode, MusicLinks>

/**
 * Where the album, artist, playlist and Now Playing links go from the page
 * open now: raven's own pages, or the music mode's under `/music`, so a page
 * both modes show keeps its viewer in the mode they are in.
 */
export const useMusicLinks = (): MusicLinks => {
  const { pathname } = useLocation()
  const isMusic = matchPath({ path: MUSIC_PATHS.root, end: false }, pathname) !== null
  return MODE_LINKS[isMusic ? MUSIC_MODES.music : MUSIC_MODES.raven]
}
