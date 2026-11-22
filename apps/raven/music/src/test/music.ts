import { jest } from '@jest/globals'
import {
  type AlbumDetails,
  type AlbumSummary,
  type Artist,
  type ArtistDetails,
  type HistoryEntry,
  type Library,
  type LibraryCounts,
  type Lyrics,
  type MusicListOptions,
  NO_LYRICS,
  type PlaylistDetails,
  type PlaylistSummary,
  type PosterEntry,
  type TrackPage,
  createApiClient,
} from '@raven/core'
import {
  AIRBAG,
  AIRBAG_LYRICS,
  FAVOURITES,
  FILMS,
  FINISHED,
  IN_PROGRESS,
  MIXTAPE,
  MIXTAPE_PAGE,
  MUSIC,
  MUSIC_COUNTS,
  OK_COMPUTER,
  OK_COMPUTER_PAGE,
  RADIOHEAD,
  RADIOHEAD_PAGE,
  SONGS,
} from '@raven/wren/testing'

// The library both of Wren's apps' tests read, which `musicApi()` answers with.
export {
  AIRBAG,
  AUDIOBOOKS,
  FAVOURITES,
  LUCKY,
  MIXTAPE,
  MIXTAPE_PAGE,
  MUSIC,
  OK_COMPUTER,
  OK_COMPUTER_PAGE,
  PARANOID,
  RADIOHEAD,
  trackFor,
} from '@raven/wren/testing'

/** The signed-in listener every screen test starts as. */
export const LISTENER = {
  accessToken: 'access',
  refreshToken: 'refresh',
  expiresAt: Date.now() + 3_600_000,
  userId: 'u1',
  email: 'listener@example.com',
}

type ListProps = { libraryId: number } & MusicListOptions

type HistoryProps = { libraryId: number; limit: number; watchedOnly: boolean }

type AppendProps = { id: number; mediaIds: readonly number[] }

type AlbumFavouriteProps = { albumId: number; favourite: boolean }

type ArtistFavouriteProps = { artistId: number; favourite: boolean }

/** raven's own address builders, which ask the network nothing. */
const addresses = createApiClient({
  baseUrl: 'https://raven.example',
  fetch: () => new Promise(() => undefined),
})

/**
 * raven's music as Wren's screens ask for it, each call a mock a test can answer otherwise or
 * look at: a films library and a music library holding OK Computer by Radiohead, and the
 * listener's Mixtape.
 */
export const musicApi = () => ({
  listLibraries: jest.fn(async (): Promise<Library[]> => [FILMS, MUSIC]),
  listAlbums: jest.fn(async (_props: ListProps): Promise<AlbumSummary[]> => [OK_COMPUTER]),
  listArtists: jest.fn(async (_props: ListProps): Promise<Artist[]> => [RADIOHEAD]),
  listTracks: jest.fn(async (_props: ListProps): Promise<TrackPage> => SONGS),
  getAlbum: jest.fn(async (_id: number): Promise<AlbumDetails> => OK_COMPUTER_PAGE),
  getArtist: jest.fn(async (_id: number): Promise<ArtistDetails> => RADIOHEAD_PAGE),
  listPlaylists: jest.fn(async (): Promise<PlaylistSummary[]> => [MIXTAPE]),
  getPlaylist: jest.fn(async (_id: number): Promise<PlaylistDetails> => MIXTAPE_PAGE),
  appendPlaylistTracks: jest.fn(async ({ mediaIds }: AppendProps): Promise<PlaylistDetails> => ({
    playlist: { ...MIXTAPE, trackCount: MIXTAPE.trackCount + mediaIds.length },
    tracks: [...MIXTAPE_PAGE.tracks, AIRBAG],
  })),
  setAlbumFavourite: jest.fn(async ({ favourite }: AlbumFavouriteProps): Promise<AlbumDetails> => ({
    ...OK_COMPUTER_PAGE,
    isFavourite: favourite,
  })),
  setArtistFavourite: jest.fn(
    async ({ favourite }: ArtistFavouriteProps): Promise<ArtistDetails> => ({
      ...RADIOHEAD_PAGE,
      isFavourite: favourite,
    }),
  ),
  getLibraryCounts: jest.fn(async (_id: number): Promise<LibraryCounts> => MUSIC_COUNTS),
  listInProgress: jest.fn(async (_id: number): Promise<PosterEntry[]> => IN_PROGRESS),
  listLibraryFavourites: jest.fn(async (_id: number): Promise<PosterEntry[]> => FAVOURITES),
  listHistory: jest.fn(async (_props: HistoryProps): Promise<HistoryEntry[]> => FINISHED),
  getLyrics: jest.fn(async (id: number): Promise<Lyrics> =>
    id === AIRBAG.id ? AIRBAG_LYRICS : NO_LYRICS,
  ),
  getMarkers: jest.fn(async (_id: number) => ({ intro: null, credits: null, chapters: [] })),
  getMediaOrigins: jest.fn(async () => ({ origins: [], remote: null })),
  getMediaTicket: jest.fn(async () => ({ ticket: 'tkt.wren', expiresAt: 0 })),
  fileUrl: addresses.fileUrl,
  recordPlay: jest.fn(async (_id: number) => undefined),
  startListen: jest.fn(async () => 1),
  reportListen: jest.fn(async () => undefined),
  albumCoverUrl: (): string | null => null,
})
