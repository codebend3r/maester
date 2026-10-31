import { generatePath, useLocation } from 'react-router-dom'
import { type BackFallback, HOME } from '@/components/BackButton/BackButton'
import { COMMON_COPY } from '@/lib/copy'
import {
  MUSIC_PATHS,
  NOW_PLAYING_PATH,
  albumPath,
  artistPath,
  isMusicPath,
  playlistPath,
} from '@/lib/music'

/** Which shell the page is open in: raven's own, or the music mode under `/music`. */
const MUSIC_MODES = { raven: 'raven', music: 'music' } as const

type MusicMode = (typeof MUSIC_MODES)[keyof typeof MUSIC_MODES]

type LibraryProps = { libraryId: number; name: string }

/** Where the music pages link, in one mode. */
type MusicLinks = {
  album: (albumId: number) => string
  artist: (artistId: number) => string
  playlist: (playlistId: number) => string
  nowPlaying: string
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
    album: (albumId) => generatePath(MUSIC_PATHS.album, { id: String(albumId) }),
    artist: (artistId) => generatePath(MUSIC_PATHS.artist, { id: String(artistId) }),
    playlist: (playlistId) => generatePath(MUSIC_PATHS.playlist, { id: String(playlistId) }),
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
  return MODE_LINKS[isMusicPath(pathname) ? MUSIC_MODES.music : MUSIC_MODES.raven]
}
