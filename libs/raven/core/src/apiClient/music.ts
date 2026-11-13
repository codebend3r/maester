import type { Transport } from '@/apiClient/transport'
import { ROUTES } from '@/routes'
import {
  type AlbumDetails,
  type AlbumMatchCandidate,
  type AlbumMatchChoice,
  type AlbumSummary,
  type Artist,
  type ArtistDetails,
  type FavouriteChange,
  type Lyrics,
  type TrackPage,
} from '@/contract'
import { type MusicListOptions, musicListQuery } from '@/musicListQuery'

type ListMusicProps = { libraryId: number } & MusicListOptions

type SearchAlbumMatchesProps = {
  albumId: number
  /** What to search MusicBrainz for; the album's own title and artist when left out. */
  query?: string
}

type SetAlbumMatchProps = { albumId: number } & AlbumMatchChoice

type SetAlbumFavouriteProps = { albumId: number } & FavouriteChange

type SetArtistFavouriteProps = { artistId: number } & FavouriteChange

/** A music library's artists, albums and tracks, and the pages of one album or artist. */
export const musicCalls = ({ ask }: Transport) => ({
  /** The artists credited in a music library, by name; `sort` other than title sorts by name too. */
  listArtists: ({ libraryId, ...options }: ListMusicProps): Promise<Artist[]> =>
    ask({
      route: ROUTES.listArtists,
      params: { id: libraryId },
      query: musicListQuery.params(options),
    }),

  /** A music library's albums in `sort` order; search matches the album's title and its artists. */
  listAlbums: ({ libraryId, ...options }: ListMusicProps): Promise<AlbumSummary[]> =>
    ask({
      route: ROUTES.listAlbums,
      params: { id: libraryId },
      query: musicListQuery.params(options),
    }),

  /** One page of a music library's tracks, `limit` long from `offset`, with the whole count. */
  listTracks: ({ libraryId, ...options }: ListMusicProps): Promise<TrackPage> =>
    ask({
      route: ROUTES.listTracks,
      params: { id: libraryId },
      query: musicListQuery.params(options),
    }),

  /** An album with its tracks in disc and number order. */
  getAlbum: (id: number): Promise<AlbumDetails> => ask({ route: ROUTES.getAlbum, params: { id } }),

  /** An artist with their albums, and the albums of others they appear on. */
  getArtist: (id: number): Promise<ArtistDetails> =>
    ask({ route: ROUTES.getArtist, params: { id } }),

  /** MusicBrainz's releases for an album's Fix match, each with how sure raven is of it, best first. */
  searchAlbumMatches: ({
    albumId,
    query,
  }: SearchAlbumMatchesProps): Promise<AlbumMatchCandidate[]> =>
    ask({
      route: ROUTES.searchAlbumMatches,
      params: { id: albumId },
      query: query === undefined ? {} : { query },
    }),

  /** Points an album at a MusicBrainz release, or at none, and answers with its page. */
  setAlbumMatch: ({ albumId, mbid }: SetAlbumMatchProps): Promise<AlbumDetails> =>
    ask({
      route: ROUTES.setAlbumMatch,
      params: { id: albumId },
      body: { mbid } satisfies AlbumMatchChoice,
    }),

  /** Marks an album the account's favourite, or not, and answers with its page. */
  setAlbumFavourite: ({ albumId, favourite }: SetAlbumFavouriteProps): Promise<AlbumDetails> =>
    ask({
      route: ROUTES.setAlbumFavourite,
      params: { id: albumId },
      body: { favourite } satisfies FavouriteChange,
    }),

  /** Marks an artist the account's favourite, or not, and answers with their page. */
  setArtistFavourite: ({ artistId, favourite }: SetArtistFavouriteProps): Promise<ArtistDetails> =>
    ask({
      route: ROUTES.setArtistFavourite,
      params: { id: artistId },
      body: { favourite } satisfies FavouriteChange,
    }),

  /** The account's favourite albums across every library it may see, most recently marked first. */
  listFavouriteAlbums: (): Promise<AlbumSummary[]> => ask({ route: ROUTES.listFavouriteAlbums }),

  /** The account's favourite artists, most recently marked first. */
  listFavouriteArtists: (): Promise<Artist[]> => ask({ route: ROUTES.listFavouriteArtists }),

  /** A track's lyrics: synced lines, plain text, or none, from its tags, a sidecar `.lrc` or LRCLIB. */
  getLyrics: (id: number): Promise<Lyrics> => ask({ route: ROUTES.getLyrics, params: { id } }),
})
