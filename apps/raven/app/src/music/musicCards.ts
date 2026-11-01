import {
  type AlbumSummary,
  type ApiClient,
  type Artist,
  type PlaylistSummary,
  type Track,
  artistNames,
  plural,
} from '@raven/core'
import { playlistFactsOf } from '@raven/ui/headless'

import { MUSIC_COPY } from '@/layouts/copy'
import {
  CARD_SHAPES,
  type Picture,
  type Pictures,
  type ShelfCard,
  pictureAt,
} from '@/queries/cards'
import type { GridSection } from '@/queries/libraryGrid'
import { ROUTE_TARGETS } from '@/routes'

type AlbumCardProps = Pick<Pictures, 'headersFor'> & {
  api: Pick<ApiClient, 'albumCoverUrl'>
  album: AlbumSummary
}

/** An album as a card: its cover, its title, and its artists under it. */
export const albumCard = ({ api, headersFor, album }: AlbumCardProps): ShelfCard => ({
  key: `album:${album.id}`,
  title: album.title,
  line: artistNames(album),
  shape: CARD_SHAPES.square,
  picture: pictureAt({
    uri: api.albumCoverUrl({ albumId: album.id, coverVersion: album.coverVersion }),
    headersFor,
  }),
  progress: 0,
  target: { kind: ROUTE_TARGETS.album, albumId: album.id },
})

const SECTION_KEYS = {
  albums: 'albums',
  appearsOn: 'appearsOn',
  artists: 'artists',
  playlists: 'playlists',
} as const

type AlbumSectionsOfProps = Pick<AlbumCardProps, 'api' | 'headersFor'> & {
  albums: readonly AlbumSummary[]
}

/** A music library's one run of cards: its albums in the order listed. */
export const albumSectionsOf = ({
  api,
  headersFor,
  albums,
}: AlbumSectionsOfProps): GridSection[] =>
  albums.length === 0
    ? []
    : [
        {
          key: SECTION_KEYS.albums,
          title: null,
          count: null,
          shape: CARD_SHAPES.square,
          cards: albums.map((album) => albumCard({ api, headersFor, album })),
        },
      ]

type ArtistSectionsOfProps = AlbumSectionsOfProps & { appearsOn: readonly AlbumSummary[] }

/**
 * An artist's page as a grid: their own albums open, then the albums of others they appear on,
 * as a bucket folded until opened, as the web's sections are.
 */
export const artistSectionsOf = ({
  api,
  headersFor,
  albums,
  appearsOn,
}: ArtistSectionsOfProps): GridSection[] => [
  ...albumSectionsOf({ api, headersFor, albums }),
  ...(appearsOn.length === 0
    ? []
    : [
        {
          key: SECTION_KEYS.appearsOn,
          title: MUSIC_COPY.appearsOn,
          count: String(appearsOn.length),
          shape: CARD_SHAPES.square,
          cards: appearsOn.map((album) => albumCard({ api, headersFor, album })),
        },
      ]),
]

type TrackCoverOfProps = Pick<AlbumCardProps, 'api' | 'headersFor'> & {
  track: Pick<Track, 'albumId' | 'album'>
}

/** The cover of the album a track is on, as Now Playing and the bar draw it. */
export const trackCoverOf = ({ api, headersFor, track }: TrackCoverOfProps): Picture | null =>
  pictureAt({
    uri: api.albumCoverUrl({ albumId: track.albumId, coverVersion: track.album.coverVersion }),
    headersFor,
  })

type ArtistCardProps = { artist: Artist }

/** An artist as a row of the Artists page: their name, and how many albums and tracks are theirs. */
export const artistCard = ({ artist }: ArtistCardProps): ShelfCard => ({
  key: `artist:${artist.id}`,
  title: artist.name,
  line: MUSIC_COPY.facts([
    plural({ n: artist.albumCount, ...MUSIC_COPY.albums }),
    plural({ n: artist.trackCount, ...MUSIC_COPY.tracks }),
  ]),
  shape: CARD_SHAPES.poster,
  picture: null,
  progress: 0,
  target: { kind: ROUTE_TARGETS.artist, artistId: artist.id },
})

type RowsSectionOfProps = { key: string; cards: ShelfCard[] }

/** A list page's one untitled run of rows, or none for no cards. */
const rowsSectionOf = ({ key, cards }: RowsSectionOfProps): GridSection[] =>
  cards.length === 0 ? [] : [{ key, title: null, count: null, shape: CARD_SHAPES.poster, cards }]

/** A music library's Artists page: one run of rows, by name as the server lists them. */
export const artistListSectionsOf = (artists: readonly Artist[]): GridSection[] =>
  rowsSectionOf({
    key: SECTION_KEYS.artists,
    cards: artists.map((artist) => artistCard({ artist })),
  })

type PlaylistCardProps = { playlist: PlaylistSummary }

/** A playlist as a row of the Playlists page: its name, and its tracks and length. */
export const playlistCard = ({ playlist }: PlaylistCardProps): ShelfCard => ({
  key: `playlist:${playlist.id}`,
  title: playlist.name,
  line: playlistFactsOf({ playlist }),
  shape: CARD_SHAPES.poster,
  picture: null,
  progress: 0,
  target: { kind: ROUTE_TARGETS.playlist, playlistId: playlist.id },
})

/** The account's playlists as one run of rows, most recently changed first, as the server lists them. */
export const playlistSectionsOf = (playlists: readonly PlaylistSummary[]): GridSection[] =>
  rowsSectionOf({
    key: SECTION_KEYS.playlists,
    cards: playlists.map((playlist) => playlistCard({ playlist })),
  })
