import { jest } from '@jest/globals'
import {
  ARTIST_BACKGROUND_KINDS,
  type Account,
  type AlbumDetails,
  type AlbumSummary,
  type Artist,
  type ArtistAbout,
  type ArtistBackgrounds,
  type ArtistDetails,
  type HistoryEntry,
  type Library,
  type LibraryCounts,
  MEMBER_STATUSES,
  type Lyrics,
  type MediaItem,
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
  mediaOf,
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

type ArtistBackgroundProps = { artistId: number; key: string | null }

type TrackFavouriteProps = { id: number; favourite: boolean }

/** The signed-in listener as raven knows them: approved, and not its owner. */
export const LISTENER_ACCOUNT: Account = {
  id: LISTENER.userId,
  email: LISTENER.email,
  status: MEMBER_STATUSES.approved,
  isOwner: false,
}

/** The pictures an owner may pick from for Radiohead's background, the second one worn. */
export const RADIOHEAD_BACKGROUNDS: ArtistBackgrounds = {
  options: [
    { key: 'a1b2c3d4e5f6', kind: ARTIST_BACKGROUND_KINDS.photo },
    { key: '0f9e8d7c6b5a', kind: ARTIST_BACKGROUND_KINDS.cover },
  ],
  chosen: '0f9e8d7c6b5a',
}

/** What `jest.fn` takes: a function to mock. */
type Mockable = NonNullable<Parameters<typeof jest.fn>[0]>

/*
 * `jest.fn`, typed through `@jest/globals`' own `jest.Mock`, so the built declarations name the
 * mocks without reaching into jest-mock, which this package does not depend on.
 */
const mockOf = <T extends Mockable>(implementation: T): jest.Mock<T> => jest.fn(implementation)

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
  listLibraries: mockOf(async (): Promise<Library[]> => [FILMS, MUSIC]),
  listAlbums: mockOf(async (_props: ListProps): Promise<AlbumSummary[]> => [OK_COMPUTER]),
  listArtists: mockOf(async (_props: ListProps): Promise<Artist[]> => [RADIOHEAD]),
  listTracks: mockOf(async (_props: ListProps): Promise<TrackPage> => SONGS),
  getAlbum: mockOf(async (_id: number): Promise<AlbumDetails> => OK_COMPUTER_PAGE),
  getArtist: mockOf(async (_id: number): Promise<ArtistDetails> => RADIOHEAD_PAGE),
  listPlaylists: mockOf(async (): Promise<PlaylistSummary[]> => [MIXTAPE]),
  getPlaylist: mockOf(async (_id: number): Promise<PlaylistDetails> => MIXTAPE_PAGE),
  appendPlaylistTracks: mockOf(async ({ mediaIds }: AppendProps): Promise<PlaylistDetails> => ({
    playlist: { ...MIXTAPE, trackCount: MIXTAPE.trackCount + mediaIds.length },
    tracks: [...MIXTAPE_PAGE.tracks, AIRBAG],
  })),
  setAlbumFavourite: mockOf(async ({ favourite }: AlbumFavouriteProps): Promise<AlbumDetails> => ({
    ...OK_COMPUTER_PAGE,
    isFavourite: favourite,
  })),
  setArtistFavourite: mockOf(
    async ({ favourite }: ArtistFavouriteProps): Promise<ArtistDetails> => ({
      ...RADIOHEAD_PAGE,
      isFavourite: favourite,
    }),
  ),
  getMe: mockOf(async (): Promise<Account> => LISTENER_ACCOUNT),
  getArtistAbout: mockOf(async (_artistId: number): Promise<ArtistAbout> => ({
    bio: null,
    birthName: null,
    born: null,
    birthplace: null,
    nationality: [],
    awards: [],
  })),
  listArtistBackgrounds: mockOf(
    async (_artistId: number): Promise<ArtistBackgrounds> => RADIOHEAD_BACKGROUNDS,
  ),
  setArtistBackground: mockOf(
    async (_props: ArtistBackgroundProps): Promise<ArtistDetails> => RADIOHEAD_PAGE,
  ),
  getLibraryCounts: mockOf(async (_id: number): Promise<LibraryCounts> => MUSIC_COUNTS),
  listInProgress: mockOf(async (_id: number): Promise<PosterEntry[]> => IN_PROGRESS),
  setFavourite: mockOf(async ({ id }: TrackFavouriteProps): Promise<MediaItem> =>
    mediaOf({ ...AIRBAG, id }),
  ),
  listFavouriteArtists: mockOf(async (): Promise<Artist[]> => []),
  listFavouriteAlbums: mockOf(async (): Promise<AlbumSummary[]> => []),
  listLibraryFavourites: mockOf(async (_id: number): Promise<PosterEntry[]> => FAVOURITES),
  listHistory: mockOf(async (_props: HistoryProps): Promise<HistoryEntry[]> => FINISHED),
  getLyrics: mockOf(async (id: number): Promise<Lyrics> =>
    id === AIRBAG.id ? AIRBAG_LYRICS : NO_LYRICS,
  ),
  getMarkers: mockOf(async (_id: number) => ({ intro: null, credits: null, chapters: [] })),
  getMediaOrigins: mockOf(async () => ({ origins: [], remote: null })),
  getMediaTicket: mockOf(async () => ({ ticket: 'tkt.wren', expiresAt: 0 })),
  fileUrl: addresses.fileUrl,
  recordPlay: mockOf(async (_id: number) => undefined),
  startListen: mockOf(async () => 1),
  reportListen: mockOf(async () => undefined),
  albumCoverUrl: (): string | null => null,
  artistBackgroundUrl: addresses.artistBackgroundUrl,
})
