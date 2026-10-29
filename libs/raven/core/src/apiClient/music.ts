import type { Transport } from '@/apiClient/transport'
import {
  type AlbumDetails,
  type AlbumMatchCandidate,
  type AlbumMatchChoice,
  type AlbumSummary,
  type Artist,
  type ArtistDetails,
  type TrackPage,
  isAlbumDetails,
  isAlbumList,
  isAlbumMatchCandidateList,
  isArtistDetails,
  isArtistList,
  isTrackPage,
} from '@/contract'
import { type MusicListOptions, musicListQuery } from '@/musicListQuery'
import { toQueryString } from '@/query'

type ListMusicProps = { libraryId: number } & MusicListOptions

type SearchAlbumMatchesProps = {
  albumId: number
  /** What to search MusicBrainz for; the album's own title and artist when left out. */
  query?: string
}

type SetAlbumMatchProps = { albumId: number } & AlbumMatchChoice

/** A music library's artists, albums and tracks, and the pages of one album or artist. */
export const musicCalls = ({ send, expect }: Transport) => ({
  /** The artists credited in a music library, by name; `sort` other than title sorts by name too. */
  listArtists: ({ libraryId, ...options }: ListMusicProps): Promise<Artist[]> =>
    expect({
      request: send({
        path: `/api/libraries/${libraryId}/artists?${musicListQuery.encode(options)}`,
      }),
      guard: isArtistList,
    }),

  /** A music library's albums in `sort` order; search matches the album's title and its artists. */
  listAlbums: ({ libraryId, ...options }: ListMusicProps): Promise<AlbumSummary[]> =>
    expect({
      request: send({
        path: `/api/libraries/${libraryId}/albums?${musicListQuery.encode(options)}`,
      }),
      guard: isAlbumList,
    }),

  /** One page of a music library's tracks, `limit` long from `offset`, with the whole count. */
  listTracks: ({ libraryId, ...options }: ListMusicProps): Promise<TrackPage> =>
    expect({
      request: send({
        path: `/api/libraries/${libraryId}/tracks?${musicListQuery.encode(options)}`,
      }),
      guard: isTrackPage,
    }),

  /** An album with its tracks in disc and number order. */
  getAlbum: (id: number): Promise<AlbumDetails> =>
    expect({ request: send({ path: `/api/albums/${id}` }), guard: isAlbumDetails }),

  /** An artist with their albums, and the albums of others they appear on. */
  getArtist: (id: number): Promise<ArtistDetails> =>
    expect({ request: send({ path: `/api/artists/${id}` }), guard: isArtistDetails }),

  /** MusicBrainz's releases for an album's Fix match, each with how sure raven is of it, best first. */
  searchAlbumMatches: ({
    albumId,
    query,
  }: SearchAlbumMatchesProps): Promise<AlbumMatchCandidate[]> =>
    expect({
      request: send({
        path: `/api/albums/${albumId}/match/search${query === undefined ? '' : `?${toQueryString({ query })}`}`,
      }),
      guard: isAlbumMatchCandidateList,
    }),

  /** Points an album at a MusicBrainz release, or at none, and answers with its page. */
  setAlbumMatch: ({ albumId, mbid }: SetAlbumMatchProps): Promise<AlbumDetails> =>
    expect({
      request: send({
        path: `/api/albums/${albumId}/match`,
        method: 'PUT',
        body: { mbid } satisfies AlbumMatchChoice,
      }),
      guard: isAlbumDetails,
    }),
})
